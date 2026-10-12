import pg from 'pg';
import {brokerFromEnvironment} from '../../../packages/auth/src/index.mjs';
const broker=brokerFromEnvironment();
const pool=process.env.AUTH_DATABASE_URL?new pg.Pool({connectionString:process.env.AUTH_DATABASE_URL,max:5}):null;
export function tenantRoute(req,res,pathname,{auth=broker,db=pool}={}){
 if(pathname!=='/v1/tenants')return false;
 const reply=(status,payload)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload))};
 if(req.method!=='GET'){reply(405,{code:'method_not_allowed'});return true}
 const product=req.headers['x-sie-product'];
 if(!['academy','command'].includes(product)){reply(401,{code:'product_required'});return true}
 if(!auth||!db){reply(503,{code:'tenant_backend_unconfigured'});return true}
 (async()=>{
  const session=await auth.session({product,cookieHeader:req.headers.cookie||''});
  if(!session?.identityId){reply(401,{code:'authentication_required'});return}
  const record=await db.query(
   'SELECT m.tenant_id AS id,t.name,m.role FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.identity_id=$1 ORDER BY t.name,m.tenant_id LIMIT 100',
   [session.identityId]);
  reply(200,{items:record.rows.map(x=>({id:x.id,name:x.name,role:x.role}))});
 })().catch(()=>reply(503,{code:'tenant_backend_unavailable'}));
 return true;
}
