const MAX_BIGINT=9223372036854775807n;
function amount(value,{positive=true}={}){
  if(typeof value==='number' && !Number.isSafeInteger(value))throw new TypeError('Use integer strings for large amounts');
  let a;try{a=BigInt(value)}catch{throw new TypeError('Invalid microunit amount')}
  if((positive?a<=0n:a<0n)||a>MAX_BIGINT)throw new TypeError('Microunit amount outside supported range');
  return a;
}
function key(s){if(typeof s!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(s))throw new TypeError('Invalid idempotency key');return s;}
async function transactional(pool,fn){
  const db=await pool.connect();try{await db.query('BEGIN');try{const result=await fn(db);await db.query('COMMIT');return result}catch(error){await db.query('ROLLBACK');throw error}}finally{db.release()}
}
async function lockBudget(db,tenantId){
  const global=await db.query('SELECT * FROM budget_global WHERE singleton=1 FOR UPDATE');
  const user=await db.query('SELECT * FROM budget_accounts WHERE tenant_id=$1 FOR UPDATE',[tenantId]);
  if(global.rows.length!==1||user.rows.length!==1)throw new Error('Budget unavailable: account or global cap not provisioned');
  return {global:global.rows[0],tenant:user.rows[0]};
}
const b=x=>BigInt(x);
const summarize=r=>({id:r.id,tenantId:r.tenant_id,reservedMicrounits:String(r.reserved_micro),chargedMicrounits:String(r.charged_micro),refundedMicrounits:String(r.refunded_micro),status:r.status});
export class BudgetError extends Error {constructor(code,message){super(message);this.name='BudgetError';this.code=code;}}
export class BudgetLedger{
  constructor({pool}={}){if(!pool||typeof pool.connect!=='function')throw new TypeError('PostgreSQL pool required');this.pool=pool;}
  async reserve({tenantId,idempotencyKey,maximumMicrounits}){
    const maximum=amount(maximumMicrounits);key(idempotencyKey);
    return transactional(this.pool,async db=>{
      const limits=await lockBudget(db,tenantId);
      const existing=await db.query('SELECT * FROM budget_reservations WHERE tenant_id=$1 AND idempotency_key=$2',[tenantId,idempotencyKey]);
      if(existing.rows.length){
        const prev=existing.rows[0];
        if(b(prev.reserved_micro)!==maximum)throw new BudgetError('idempotency_conflict','A different amount used this reservation key');
        return summarize(prev);
      }
      for(const {label,row,limit,funded} of [{label:'global',row:limits.global,limit:'hard_limit_micro'},{label:'tenant',row:limits.tenant,limit:'hard_limit_micro',funded:'funded_micro'}]){
        const projected=b(row.spent_micro)+b(row.reserved_micro)+maximum;
        if(projected>b(row[limit])||(funded&&projected>b(row[funded])))throw new BudgetError(label+'_limit_exceeded',label+' budget limit would be exceeded');
      }
      const r=await db.query('INSERT INTO budget_reservations(tenant_id,idempotency_key,reserved_micro) VALUES($1,$2,$3) RETURNING *',[tenantId,idempotencyKey,maximum.toString()]);
      await db.query('UPDATE budget_global SET reserved_micro=reserved_micro+$1 WHERE singleton=1',[maximum.toString()]);
      await db.query('UPDATE budget_accounts SET reserved_micro=reserved_micro+$1,updated_at=now() WHERE tenant_id=$2',[maximum.toString(),tenantId]);
      await db.query("INSERT INTO budget_events(tenant_id,reservation_id,event_key,event_type,delta_reserved_micro) VALUES($1,$2,$3,'reserve',$4)",[tenantId,r.rows[0].id,'reserve:'+idempotencyKey,maximum.toString()]);
      return summarize(r.rows[0]);
    });
  }
  async settle({tenantId,reservationId,actualMicrounits,providerTaskId}){
    const actual=amount(actualMicrounits,{positive:false});
    return transactional(this.pool,async db=>{
      await lockBudget(db,tenantId);
      const rows=await db.query('SELECT * FROM budget_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,reservationId]);
      if(rows.rows.length!==1)throw new BudgetError('not_found','Reservation not found');const record=rows.rows[0];
      if(record.status==='settled'){
        if(b(record.charged_micro)!==actual||(providerTaskId&&record.provider_task_id!==providerTaskId))throw new BudgetError('replay_conflict','Settlement replay does not match');
        return summarize(record);
      }
      if(record.status!=='reserved')throw new BudgetError('inactive_reservation','Cannot settle a released reservation');
      if(actual>b(record.reserved_micro))throw new BudgetError('reservation_limit_exceeded','Actual provider usage exceeds authorized reservation');
      const reserved=b(record.reserved_micro);
      await db.query('UPDATE budget_global SET reserved_micro=reserved_micro-$1,spent_micro=spent_micro+$2 WHERE singleton=1',[reserved.toString(),actual.toString()]);
      await db.query('UPDATE budget_accounts SET reserved_micro=reserved_micro-$1,spent_micro=spent_micro+$2,updated_at=now() WHERE tenant_id=$3',[reserved.toString(),actual.toString(),tenantId]);
      const updated=await db.query("UPDATE budget_reservations SET status='settled',charged_micro=$1,provider_task_id=$2,settled_at=now() WHERE id=$3 RETURNING *",[actual.toString(),providerTaskId||null,reservationId]);
      await db.query("INSERT INTO budget_events(tenant_id,reservation_id,event_key,event_type,delta_reserved_micro,delta_spent_micro) VALUES($1,$2,$3,'settle',$4,$5)",[tenantId,reservationId,'settle:'+reservationId,(-reserved).toString(),actual.toString()]);
      return summarize(updated.rows[0]);
    });
  }
  async release({tenantId,reservationId}){
    return transactional(this.pool,async db=>{
      await lockBudget(db,tenantId);
      const r=await db.query('SELECT * FROM budget_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,reservationId]);
      if(!r.rows.length)throw new BudgetError('not_found','Reservation not found');
      if(r.rows[0].status==='released')return summarize(r.rows[0]);
      if(r.rows[0].status!=='reserved')throw new BudgetError('already_settled','Cannot release a settled charge');
      const reserved=r.rows[0].reserved_micro;
      await db.query('UPDATE budget_global SET reserved_micro=reserved_micro-$1 WHERE singleton=1',[reserved]);
      await db.query('UPDATE budget_accounts SET reserved_micro=reserved_micro-$1,updated_at=now() WHERE tenant_id=$2',[reserved,tenantId]);
      const updated=await db.query("UPDATE budget_reservations SET status='released',settled_at=now() WHERE id=$1 RETURNING *",[reservationId]);
      await db.query("INSERT INTO budget_events(tenant_id,reservation_id,event_key,event_type,delta_reserved_micro) VALUES($1,$2,$3,'release',$4)",[tenantId,reservationId,'release:'+reservationId,(-b(reserved)).toString()]);
      return summarize(updated.rows[0]);
    });
  }
  async refund({tenantId,reservationId,amountMicrounits,eventKey}){
    const amountValue=amount(amountMicrounits);key(eventKey);
    return transactional(this.pool,async db=>{
      await lockBudget(db,tenantId);
      const r=await db.query('SELECT * FROM budget_reservations WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,reservationId]);
      if(!r.rows.length||r.rows[0].status!=='settled')throw new BudgetError('not_settled','Charge not settled');
      const existing=await db.query('SELECT delta_spent_micro FROM budget_events WHERE tenant_id=$1 AND event_key=$2',[tenantId,'refund:'+eventKey]);
      if(existing.rows.length){if(b(existing.rows[0].delta_spent_micro)!==-amountValue)throw new BudgetError('replay_conflict','Refund replay differs');return summarize(r.rows[0]);}
      if(amountValue>b(r.rows[0].charged_micro)-b(r.rows[0].refunded_micro))throw new BudgetError('refund_exceeds_charge','Refund greater than remaining net charge');
      await db.query('UPDATE budget_global SET spent_micro=spent_micro-$1 WHERE singleton=1',[amountValue.toString()]);
      await db.query('UPDATE budget_accounts SET spent_micro=spent_micro-$1,updated_at=now() WHERE tenant_id=$2',[amountValue.toString(),tenantId]);
      const updated=await db.query('UPDATE budget_reservations SET refunded_micro=refunded_micro+$1 WHERE id=$2 RETURNING *',[amountValue.toString(),reservationId]);
      await db.query("INSERT INTO budget_events(tenant_id,reservation_id,event_key,event_type,delta_spent_micro) VALUES($1,$2,$3,'refund',$4)",[tenantId,reservationId,'refund:'+eventKey,(-amountValue).toString()]);
      return summarize(updated.rows[0]);
    });
  }
}
