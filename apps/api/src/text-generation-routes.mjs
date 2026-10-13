const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class HttpBoundaryError extends Error {constructor(code){super(code);this.code=code}}

function json(res,status,data){
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(data));
}
async function body(req){
 if(req.headers['content-type']!=='application/json')throw new HttpBoundaryError('json_required');
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>131072)throw new HttpBoundaryError('request_too_large');chunks.push(chunk)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new HttpBoundaryError('invalid_json')}
}
function status(error){
 if(error?.code==='request_too_large')return 413;
 if(['json_required','invalid_json','invalid_scope','invalid_provider','invalid_operation','invalid_prompt','invalid_region','invalid_usage','invalid_pricing','invalid_callback','input_ceiling','output_limit'].includes(error?.code))return 400;
 if(error?.code==='authentication_required')return 401;
 if(['project_forbidden','budget_denied'].includes(error?.code))return 403;
 if(['not_found','reservation_missing'].includes(error?.code))return 404;
 if(['reservation_inactive','reservation_insufficient','idempotency_conflict','dispatch_uncertain'].includes(error?.code))return 409;
 return 503;
}
function publicCode(error){
 const allowed=new Set(['json_required','request_too_large','invalid_json','invalid_scope','invalid_provider','invalid_operation','invalid_prompt','invalid_region','invalid_usage','input_ceiling','output_limit','authentication_required','project_forbidden','budget_denied','not_found','reservation_missing','reservation_inactive','reservation_insufficient','idempotency_conflict','dispatch_uncertain','cancelled']);
 return allowed.has(error?.code)?error.code:'generation_unavailable';
}

/** Authenticated SIE-012 streaming boundary. A trusted server must inject the disabled-by-default service. */
export function textGenerationRoute(req,res,pathname,{auth,service,authorizedOrigins=[]}={}){
 const match=/^\/v1\/projects\/([0-9a-f-]{36})\/text-generations$/.exec(pathname);
 if(!match)return false;
 if(req.method!=='POST'){json(res,405,{code:'method_not_allowed'});return true}
 if(!auth||!service){json(res,503,{code:'generation_unconfigured'});return true}
 const product=req.headers['x-sie-product'],tenantId=req.headers['x-tenant-id'],origin=req.headers.origin;
 if(!['academy','command'].includes(product)||typeof tenantId!=='string'||!UUID.test(tenantId)){json(res,401,{code:'identity_scope_required'});return true}
 if(!origin||!authorizedOrigins.includes(origin)){json(res,403,{code:'origin_not_allowed'});return true}
 const controller=new AbortController();let finished=false,streaming=false;
 const abort=()=>{if(!finished)controller.abort()};req.once('aborted',abort);res.once('close',abort);
 const open=()=>{if(streaming)return;streaming=true;res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff','Connection':'keep-alive'})};
 const event=(name,data)=>{open();res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)};
 (async()=>{
  const session=await auth.session({product,cookieHeader:req.headers.cookie||''});
  if(!session)throw new HttpBoundaryError('authentication_required');
  const input=await body(req);
  const result=await service.generate({...input,projectId:match[1],context:{tenantId,session},signal:controller.signal,onToken:(text)=>event('token',{text})});
  event('result',result);finished=true;res.end();
 })().catch(error=>{
  finished=true;const code=publicCode(error);
  if(streaming){event('error',{code});res.end()}else json(res,status(error),{code});
 });
 return true;
}
