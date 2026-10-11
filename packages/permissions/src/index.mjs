const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class TenantPermissionError extends Error {constructor(code){super(code);this.name='TenantPermissionError';this.code=code;}}
export async function withTenantScope({pool,session,tenantId,requiredRole}={},fn){
 if(!pool||typeof pool.connect!=='function'||typeof fn!=='function')throw new TypeError('Postgres pool and callback required');
 if(!UUID.test(session?.identityId||'')||!UUID.test(tenantId||''))throw new TenantPermissionError('verified_identity_and_tenant_required');
 const allowed=['owner','admin','member','viewer'];
 if(requiredRole&&!allowed.includes(requiredRole))throw new TenantPermissionError('invalid_required_role');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  try{
   await client.query("SELECT set_config('sie.identity_id',$1,true),set_config('sie.tenant_id',$2,true)",[session.identityId,tenantId]);
   const membership=await client.query('SELECT role FROM memberships WHERE tenant_id=$1 AND identity_id=$2',[tenantId,session.identityId]);
   const role=membership.rows[0]?.role;
   if(!role)throw new TenantPermissionError('membership_revoked_or_missing');
   if(requiredRole&&allowed.indexOf(role)>allowed.indexOf(requiredRole))throw new TenantPermissionError('insufficient_role');
   const result=await fn(client,Object.freeze({identityId:session.identityId,tenantId,role}));
   await client.query('COMMIT');return result;
  }catch(err){await client.query('ROLLBACK');throw err;}
 }finally{client.release();}
}
