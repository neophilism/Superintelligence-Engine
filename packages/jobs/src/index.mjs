import {createHash} from 'node:crypto';
import {validateWorkflowRecipe} from '../../workflows/src/index.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_PAYLOAD=65536;
export class QueueError extends Error{constructor(code,message){super(message);this.name='QueueError';this.code=code;}}
function requireUUID(value,label){if(typeof value!=='string'||!UUID.test(value))throw new QueueError('invalid_scope',label+' must be a UUID')}
function requireKey(value,label){if(typeof value!=='string'||!SAFE_KEY.test(value))throw new QueueError('invalid_key','Invalid '+label)}
function encode(value){let text;try{text=JSON.stringify(value)}catch{throw new QueueError('invalid_json','Payload is not JSON serializable')}if(text===undefined||text.length>MAX_PAYLOAD)throw new QueueError('payload_limit','Payload missing or too large');return text}
function safeNode(n){return n.effects==='read'&&n.maxCostMicros===0&&n.approvalRequired!==true}
function output(r){return {id:r.id,tenantId:r.tenant_id,projectId:r.project_id,status:r.status,createdAt:r.created_at}}
async function transaction(pool,fn){
 const db=await pool.connect();
 try{await db.query('BEGIN');try{const out=await fn(db);await db.query('COMMIT');return out}catch(error){await db.query('ROLLBACK');throw error}}
 finally{db.release()}
}
async function event(db,tenantId,runId,key,type,payload={}){
 await db.query('INSERT INTO workflow_outbox(tenant_id,run_id,event_key,event_type,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(event_key) DO NOTHING',
  [tenantId,runId,key,type,JSON.stringify(payload)]);
}
export class DurableJobQueue {
 constructor({pool}={}){if(!pool||typeof pool.connect!=='function')throw new TypeError('Trusted PostgreSQL pool is required');this.pool=pool;}
 async enqueue({tenantId,projectId,identityId,idempotencyKey,recipe}){
   requireUUID(tenantId,'tenantId');requireUUID(projectId,'projectId');requireUUID(identityId,'identityId');requireKey(idempotencyKey,'idempotencyKey');
   validateWorkflowRecipe(recipe);const json=encode(recipe),checksum=createHash('sha256').update(json).digest('hex');
   return transaction(this.pool,async db=>{
     const allowed=await db.query("SELECT 1 FROM projects p JOIN memberships m ON m.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.id=$2 AND m.identity_id=$3 AND m.role IN ('owner','admin','member')",[tenantId,projectId,identityId]);
     if(!allowed.rowCount)throw new QueueError('forbidden','Project membership with write privileges is required');
     const created=await db.query("INSERT INTO workflow_runs(tenant_id,project_id,created_by,request_key,recipe_sha256,recipe) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(tenant_id,request_key) DO NOTHING RETURNING *",[tenantId,projectId,identityId,idempotencyKey,checksum,json]);
     if(!created.rowCount){
       const previous=(await db.query('SELECT * FROM workflow_runs WHERE tenant_id=$1 AND request_key=$2',[tenantId,idempotencyKey])).rows[0];
       if(!previous||previous.recipe_sha256!==checksum||previous.project_id!==projectId||previous.created_by!==identityId)throw new QueueError('idempotency_conflict','Existing run key has different content or owner');
       return output(previous);
     }
     const run=created.rows[0];
     for(const node of recipe.nodes){
       const ready=node.dependsOn.length===0&&safeNode(node);
       const state=node.dependsOn.length?(safeNode(node)?'pending':'blocked_policy'):(ready?'ready':'blocked_policy');
       const key=createHash('sha256').update(tenantId+':'+run.id+':'+node.id).digest('hex');
       const job=await db.query(
         "INSERT INTO workflow_jobs(tenant_id,run_id,node_id,operation,effects,dependencies,state,cost_ceiling_micro,approval_required,provider_dispatch_key) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING id",
         [tenantId,run.id,node.id,node.operation,node.effects,JSON.stringify(node.dependsOn),state,String(node.maxCostMicros),node.approvalRequired===true,key]);
       await event(db,tenantId,run.id,'node:'+run.id+':'+node.id+':'+state,state==='ready'?'job.ready':'job.blocked',{jobId:job.rows[0].id,nodeId:node.id,state});
     }
     const anyReady=recipe.nodes.some(n=>n.dependsOn.length===0&&safeNode(n));
     if(!anyReady)await db.query("UPDATE workflow_runs SET status='blocked',updated_at=now() WHERE id=$1",[run.id]);
     await event(db,tenantId,run.id,'run:'+run.id+':created','run.created',{projectId});
     return {...output(run),status:anyReady?'queued':'blocked'};
   });
 }
 async get(runId,tenantId){
   requireUUID(runId,'runId');requireUUID(tenantId,'tenantId');
   const found=await this.pool.query('SELECT * FROM workflow_runs WHERE tenant_id=$1 AND id=$2',[tenantId,runId]);
   if(!found.rowCount)throw new QueueError('not_found','Workflow run not found');
   return output(found.rows[0]);
 }
 async events({tenantId,runId,identityId,after=0,limit=100}={}){
   requireUUID(tenantId,'tenantId');requireUUID(runId,'runId');requireUUID(identityId,'identityId');
   if(!Number.isSafeInteger(after)||after<0)throw new QueueError('invalid_cursor','Event cursor must be a non-negative safe integer');
   if(!Number.isInteger(limit)||limit<1||limit>500)throw new QueueError('invalid_limit','Event limit must be 1 to 500');
   const allowed=await this.pool.query("SELECT 1 FROM workflow_runs r JOIN memberships m ON m.tenant_id=r.tenant_id WHERE r.tenant_id=$1 AND r.id=$2 AND m.identity_id=$3",[tenantId,runId,identityId]);
   if(!allowed.rowCount)throw new QueueError('not_found','Workflow run not found');
   const result=await this.pool.query('SELECT id,event_type,payload,created_at FROM workflow_outbox WHERE tenant_id=$1 AND run_id=$2 AND id>$3 ORDER BY id LIMIT $4',[tenantId,runId,after,limit]);
   return result.rows.map(row=>({id:Number(row.id),type:row.event_type,payload:row.payload,createdAt:row.created_at}));
 }
 async claim({workerId,leaseSeconds=60}={}){
   requireKey(workerId,'workerId');
   if(!Number.isInteger(leaseSeconds)||leaseSeconds<5||leaseSeconds>300)throw new QueueError('invalid_lease','Lease TTL must be 5 to 300 seconds');
   const result=await this.pool.query(
     "WITH selected AS (SELECT id FROM workflow_jobs WHERE state='ready' AND next_attempt_at<=now() ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1) "+
     "UPDATE workflow_jobs j SET state='leased',lease_owner=$1,lease_token=gen_random_uuid(),lease_expires_at=now()+($2::integer * interval '1 second'),attempt=j.attempt+1,updated_at=now() FROM selected WHERE j.id=selected.id RETURNING j.*",
     [workerId,leaseSeconds]);
   return result.rows[0]||null;
 }
 async checkpoint({jobId,workerId,leaseToken,data}){
   requireUUID(jobId,'jobId');requireUUID(leaseToken,'leaseToken');requireKey(workerId,'workerId');
   const result=await this.pool.query("UPDATE workflow_jobs SET checkpoint=$4::jsonb,updated_at=now() WHERE id=$1 AND lease_owner=$2 AND lease_token=$3 AND state='leased' AND lease_expires_at>now() RETURNING id",[jobId,workerId,leaseToken,encode(data)]);
   if(!result.rowCount)throw new QueueError('stale_lease','Checkpoint lease expired or does not belong to worker');
   return true;
 }
 async markDispatchStarted({jobId,workerId,leaseToken,providerTaskId=null}){
   requireUUID(jobId,'jobId');requireUUID(leaseToken,'leaseToken');requireKey(workerId,'workerId');
   if(providerTaskId!==null)requireKey(providerTaskId,'providerTaskId');
   const result=await this.pool.query(
     "UPDATE workflow_jobs SET state='dispatched',provider_task_id=$4,updated_at=now() WHERE id=$1 AND lease_owner=$2 AND lease_token=$3 AND state='leased' AND lease_expires_at>now() RETURNING *",
     [jobId,workerId,leaseToken,providerTaskId]);
   if(!result.rowCount)throw new QueueError('stale_lease','Dispatch requires a currently owned lease');
   return {providerDispatchKey:result.rows[0].provider_dispatch_key,state:'dispatched'};
 }
 async complete({jobId,workerId,leaseToken,result}){
   requireUUID(jobId,'jobId');requireUUID(leaseToken,'leaseToken');requireKey(workerId,'workerId');const json=encode(result);
   return transaction(this.pool,async db=>{
     const row=(await db.query('SELECT * FROM workflow_jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];
     if(!row||row.lease_owner!==workerId||row.lease_token!==leaseToken)throw new QueueError('stale_lease','Lease does not match worker');
     if(row.state==='succeeded')return {id:jobId,state:'succeeded',replayed:true};
     if(!['leased','dispatched'].includes(row.state))throw new QueueError('invalid_state','Job is not active');
     await db.query("UPDATE workflow_jobs SET state='succeeded',result=$2::jsonb,lease_expires_at=NULL,updated_at=now() WHERE id=$1",[jobId,json]);
     await event(db,row.tenant_id,row.run_id,'job:'+jobId+':succeeded','job.succeeded',{nodeId:row.node_id});
     const siblings=(await db.query('SELECT * FROM workflow_jobs WHERE run_id=$1 FOR UPDATE',[row.run_id])).rows;
     const statuses=new Map(siblings.map(x=>[x.node_id,x.state]));
     for(const child of siblings.filter(x=>x.state==='pending')){
       if(child.dependencies.every(id=>statuses.get(id)==='succeeded')){
         await db.query("UPDATE workflow_jobs SET state='ready',next_attempt_at=now(),updated_at=now() WHERE id=$1",[child.id]);
         await event(db,row.tenant_id,row.run_id,'job:'+child.id+':ready','job.ready',{nodeId:child.node_id});
         statuses.set(child.node_id,'ready');
       }
     }
     const stateList=[...statuses.values()];
     const newStatus=stateList.every(s=>s==='succeeded')?'completed':stateList.some(s=>['ready','leased','dispatched','pending'].includes(s))?'queued':stateList.some(s=>s==='failed')?'failed':'blocked';
     await db.query("UPDATE workflow_runs SET status=$2,updated_at=now() WHERE id=$1",[row.run_id,newStatus]);
     if(newStatus==='completed')await event(db,row.tenant_id,row.run_id,'run:'+row.run_id+':completed','run.completed',{});
     return {id:jobId,state:'succeeded',replayed:false};
   });
 }
 async fail({jobId,workerId,leaseToken,code='handler_error',retryDelaySeconds=5}){
   requireUUID(jobId,'jobId');requireUUID(leaseToken,'leaseToken');requireKey(workerId,'workerId');requireKey(code,'code');
   if(!Number.isInteger(retryDelaySeconds)||retryDelaySeconds<1||retryDelaySeconds>3600)throw new QueueError('invalid_retry','Retry delay must be 1 to 3600 seconds');
   return transaction(this.pool,async db=>{
     const job=(await db.query('SELECT * FROM workflow_jobs WHERE id=$1 FOR UPDATE',[jobId])).rows[0];
     if(!job||job.lease_owner!==workerId||job.lease_token!==leaseToken||!['leased','dispatched'].includes(job.state))throw new QueueError('stale_lease','Failed job is not leased by worker');
     const state=job.state==='dispatched'?'needs_reconciliation':job.attempt>=job.max_attempts?'failed':'ready';
     await db.query("UPDATE workflow_jobs SET state=$2,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=now()+($3::integer*interval '1 second'),failure_code=$4,updated_at=now() WHERE id=$1",[jobId,state,retryDelaySeconds,code]);
     await event(db,job.tenant_id,job.run_id,'job:'+jobId+':failure:'+job.attempt,state==='ready'?'job.retry':'job.'+state,{nodeId:job.node_id,attempt:job.attempt});
     if(state==='failed'||state==='needs_reconciliation')await db.query("UPDATE workflow_runs SET status='blocked',updated_at=now() WHERE id=$1",[job.run_id]);
     return {id:jobId,state};
   });
 }
 async recoverExpired(){
   return transaction(this.pool,async db=>{
     const rows=(await db.query(
       "UPDATE workflow_jobs SET state=CASE WHEN state='dispatched' THEN 'needs_reconciliation' ELSE 'ready' END,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,next_attempt_at=now(),updated_at=now() WHERE state IN ('leased','dispatched') AND lease_expires_at<now() RETURNING *")).rows;
     for(const job of rows){
       await event(db,job.tenant_id,job.run_id,'job:'+job.id+':recover:'+job.attempt,job.state==='ready'?'job.retry':'job.needs_reconciliation',{nodeId:job.node_id,attempt:job.attempt});
       if(job.state==='needs_reconciliation')await db.query("UPDATE workflow_runs SET status='blocked',updated_at=now() WHERE id=$1",[job.run_id]);
     }
     return rows.map(x=>({id:x.id,state:x.state}));
   });
 }
 async claimOutbox({workerId,limit=10,leaseSeconds=45}){
   requireKey(workerId,'workerId');
   if(!Number.isInteger(limit)||limit<1||limit>100||!Number.isInteger(leaseSeconds)||leaseSeconds<5||leaseSeconds>300)throw new QueueError('invalid_outbox','Invalid claim bounds');
   const result=await this.pool.query(
     "WITH candidate AS (SELECT id FROM workflow_outbox WHERE delivered_at IS NULL AND (claimed_until IS NULL OR claimed_until<now()) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $2) "+
     "UPDATE workflow_outbox o SET claimed_by=$1,claimed_until=now()+($3::integer * interval '1 second') FROM candidate WHERE o.id=candidate.id RETURNING o.*",
     [workerId,limit,leaseSeconds]);
   return result.rows;
 }
 async acknowledgeOutbox({workerId,eventId}){
   requireKey(workerId,'workerId');
   if(!Number.isSafeInteger(eventId)||eventId<1)throw new QueueError('invalid_event','Invalid event ID');
   const result=await this.pool.query('UPDATE workflow_outbox SET delivered_at=now() WHERE id=$1 AND claimed_by=$2 AND claimed_until>now() AND delivered_at IS NULL RETURNING id',[eventId,workerId]);
   if(!result.rowCount)throw new QueueError('stale_outbox','Outbox event not owned or already acknowledged');
   return true;
 }
}
