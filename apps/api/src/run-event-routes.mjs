const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_EVENTS=new Set(['run.completed','run.failed','run.cancelled']);
function reply(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))}
function status(error){if(error?.code==='not_found')return 404;if(['invalid_cursor','invalid_limit'].includes(error?.code))return 400;return 503}
function cursor(req){
 const value=req.headers['last-event-id']??new URL(req.url||'/', 'http://localhost').searchParams.get('after')??'0';
 if(typeof value!=='string'||!/^\d+$/.test(value))throw Object.assign(new Error('invalid_cursor'),{code:'invalid_cursor'});
 const parsed=Number(value);if(!Number.isSafeInteger(parsed))throw Object.assign(new Error('invalid_cursor'),{code:'invalid_cursor'});return parsed;
}
function eventName(value){return typeof value==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(value)?value:'run.event'}
function pause(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
/** Authenticated SIE-017 cursor replay with optional bounded live follow. */
export function runEventRoute(req,res,pathname,{auth,service,authorizedOrigins=[],pollIntervalMs=1000,maxFollowMs=25000,wait=pause,clock=Date.now}={}){
 const match=/^\/v1\/runs\/([0-9a-f-]{36})\/events$/.exec(pathname);if(!match)return false;
 if(req.method!=='GET'){reply(res,405,{code:'method_not_allowed'});return true}
 if(!auth||!service||typeof service.events!=='function'){reply(res,503,{code:'run_events_unconfigured'});return true}
 const product=req.headers['x-sie-product'],tenantId=req.headers['x-tenant-id'],origin=req.headers.origin;
 if(!['academy','command'].includes(product)||typeof tenantId!=='string'||!UUID.test(tenantId)){reply(res,401,{code:'identity_scope_required'});return true}
 if(!origin||!authorizedOrigins.includes(origin)){reply(res,403,{code:'origin_not_allowed'});return true}
 (async()=>{
  const session=await auth.session({product,cookieHeader:req.headers.cookie||''});if(!session)throw Object.assign(new Error('authentication_required'),{code:'authentication_required'});
  const after=cursor(req),follow=new URL(req.url||'/', 'http://localhost').searchParams.get('follow')==='1';
  const deadline=clock()+maxFollowMs;let next=after,closed=false;
  res.on('close',()=>{closed=true});
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff','Connection':'keep-alive'});
  do{
   const events=await service.events({tenantId,runId:match[1],identityId:session.identityId,after:next,limit:200});
   for(const entry of events){next=entry.id;res.write(`id: ${entry.id}\nevent: ${eventName(entry.type)}\ndata: ${JSON.stringify({payload:entry.payload,createdAt:entry.createdAt})}\n\n`)}
   if(!follow||closed||events.some(entry=>TERMINAL_EVENTS.has(entry.type))||clock()>=deadline)break;
   if(events.length===0)res.write(': keep-alive\n\n');
   await wait(pollIntervalMs);
  }while(!closed);
  if(!closed)res.end(`event: replay-end\ndata: ${JSON.stringify({cursor:next})}\n\n`);
 })().catch(error=>{if(res.headersSent){if(!res.destroyed)res.end('event: error\ndata: {"code":"run_events_unavailable"}\n\n')}else if(error?.code==='authentication_required')reply(res,401,{code:'authentication_required'});else reply(res,status(error),{code:['not_found','invalid_cursor','invalid_limit'].includes(error?.code)?error.code:'run_events_unavailable'})});
 return true;
}
