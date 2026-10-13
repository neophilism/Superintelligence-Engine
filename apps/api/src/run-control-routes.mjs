const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
function errorStatus(error){
 if(error?.code==='not_found')return 404;
 if(['invalid_key','invalid_json','payload_limit'].includes(error?.code))return 400;
 if(['invalid_state','provider_cancel_unavailable','retry_unsafe'].includes(error?.code))return 409;
 return 503;
}
async function body(req){
 const chunks=[];let size=0;
 for await(const chunk of req){size+=chunk.length;if(size>4096)throw Object.assign(new Error('payload_limit'),{code:'payload_limit'});chunks.push(chunk)}
 try{return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{}}
 catch{throw Object.assign(new Error('invalid_json'),{code:'invalid_json'})}
}
/** Authenticated SIE-017 inspection and explicit local cancel/retry controls. */
export function runControlRoute(req,res,pathname,{auth,service,authorizedOrigins=[]}={}){
 const match=/^\/v1\/runs\/([0-9a-f-]{36})(?:\/(cancel|retry))?$/.exec(pathname);if(!match)return false;
 const action=match[2]||'inspect',allowed=(action==='inspect'&&req.method==='GET')||(action!=='inspect'&&req.method==='POST');
 if(!allowed){reply(res,405,{code:'method_not_allowed'});return true}
 if(!auth||!service||typeof service.inspect!=='function'||typeof service.cancel!=='function'||typeof service.retry!=='function'){reply(res,503,{code:'run_controls_unconfigured'});return true}
 const product=req.headers['x-sie-product'],tenantId=req.headers['x-tenant-id'],origin=req.headers.origin;
 if(!['academy','command'].includes(product)||typeof tenantId!=='string'||!UUID.test(tenantId)){reply(res,401,{code:'identity_scope_required'});return true}
 if(!origin||!authorizedOrigins.includes(origin)){reply(res,403,{code:'origin_not_allowed'});return true}
 (async()=>{
  const session=await auth.session({product,cookieHeader:req.headers.cookie||''});if(!session)throw Object.assign(new Error('authentication_required'),{code:'authentication_required'});
  const scope={tenantId,runId:match[1],identityId:session.identityId};
  let result;
  if(action==='inspect')result=await service.inspect(scope);
  else if(action==='cancel')result=await service.cancel(scope);
  else{const input=await body(req);if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.idempotencyKey!=='string'||!SAFE_KEY.test(input.idempotencyKey))throw Object.assign(new Error('invalid_key'),{code:'invalid_key'});result=await service.retry({...scope,idempotencyKey:input.idempotencyKey})}
  reply(res,200,result);
 })().catch(error=>{if(error?.code==='authentication_required')reply(res,401,{code:'authentication_required'});else reply(res,errorStatus(error),{code:['not_found','invalid_key','invalid_json','payload_limit','invalid_state','provider_cancel_unavailable','retry_unsafe'].includes(error?.code)?error.code:'run_controls_unavailable'})});
 return true;
}
