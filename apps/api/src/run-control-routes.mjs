const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpBoundaryError extends Error{constructor(code){super(code);this.code=code}}
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
async function body(req){
 if(req.headers['content-type']!=='application/json')throw new HttpBoundaryError('json_required');
 let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw new HttpBoundaryError('request_too_large');chunks.push(chunk)}
 try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(value===null||typeof value!=='object'||Array.isArray(value))throw new Error();return value}catch{throw new HttpBoundaryError('invalid_json')}
}
function status(error){
 if(error?.code==='request_too_large')return 413;
 if(['json_required','invalid_json','invalid_key'].includes(error?.code))return 400;
 if(error?.code==='authentication_required')return 401;
 if(error?.code==='not_found')return 404;
 if(['invalid_state','provider_cancel_unavailable','retry_unsafe'].includes(error?.code))return 409;
 return 503;
}
function publicCode(error){
 const allowed=new Set(['json_required','request_too_large','invalid_json','invalid_key','authentication_required','not_found','invalid_state','provider_cancel_unavailable','retry_unsafe']);
 return allowed.has(error?.code)?error.code:'run_control_unavailable';
}
/** Authenticated SIE-017 cancellation/retry boundary over an injected durable queue service. */
export function runControlRoute(req,res,pathname,{auth,service,authorizedOrigins=[]}={}){
 const match=/^\/v1\/runs\/([0-9a-f-]{36})\/(cancel|retry)$/.exec(pathname);if(!match)return false;
 if(req.method!=='POST'){reply(res,405,{code:'method_not_allowed'});return true}
 if(!auth||!service||typeof service[match[2]]!=='function'){reply(res,503,{code:'run_controls_unconfigured'});return true}
 const product=req.headers['x-sie-product'],tenantId=req.headers['x-tenant-id'],origin=req.headers.origin;
 if(!['academy','command'].includes(product)||typeof tenantId!=='string'||!UUID.test(tenantId)){reply(res,401,{code:'identity_scope_required'});return true}
 if(!origin||!authorizedOrigins.includes(origin)){reply(res,403,{code:'origin_not_allowed'});return true}
 (async()=>{
  const session=await auth.session({product,cookieHeader:req.headers.cookie||''});if(!session)throw new HttpBoundaryError('authentication_required');
  const args={tenantId,runId:match[1],identityId:session.identityId};
  if(match[2]==='retry'){const input=await body(req);if(typeof input.idempotencyKey!=='string')throw new HttpBoundaryError('invalid_key');args.idempotencyKey=input.idempotencyKey}
  const result=await service[match[2]](args);reply(res,200,result);
 })().catch(error=>reply(res,status(error),{code:publicCode(error)}));
 return true;
}
