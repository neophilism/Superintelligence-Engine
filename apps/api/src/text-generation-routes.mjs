import {brokerFromEnvironment} from '../../../packages/auth/src/index.mjs';
import {textGenerationFromEnvironment} from './text-generation-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS=new Set(['projectId','reservationId','providerId','operation','prompt','region','commercial','maxOutputTokens']);
let defaultService=null;
try{defaultService=textGenerationFromEnvironment()}catch{defaultService=null}
const defaultAuth=brokerFromEnvironment();
function send(res,status,code){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify({code}))}
async function parseBody(req){
 const chunks=[];let bytes=0;
 for await(const chunk of req){
  bytes+=chunk.byteLength;
  if(bytes>100000)throw Object.assign(new Error('Payload exceeds size limit'),{code:'request_too_large',status:413});
  chunks.push(chunk);
 }
 let data;
 try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Object.assign(new Error('Invalid JSON'),{code:'invalid_json',status:400})}
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!FIELDS.has(key)))
  throw Object.assign(new Error('Unsupported fields'),{code:'invalid_request',status:400});
 if(!UUID.test(data.projectId||'')||!UUID.test(data.reservationId||'')||typeof data.prompt!=='string'||data.prompt.length>64000||!data.prompt.trim())
  throw Object.assign(new Error('Invalid project or prompt'),{code:'invalid_request',status:400});
 if(typeof data.providerId!=='string'||!['text.generate','reason.generate'].includes(data.operation))
  throw Object.assign(new Error('Provider operation missing'),{code:'invalid_request',status:400});
 if(typeof data.region!=='string'||typeof data.commercial!=='boolean'||!Number.isInteger(data.maxOutputTokens)||data.maxOutputTokens<16||data.maxOutputTokens>4096)
  throw Object.assign(new Error('Invalid generation bounds'),{code:'invalid_request',status:400});
 return data;
}
function frame(res,type,data){
 if(res.writableEnded||res.destroyed)return;
 res.write('event: '+type+'\ndata: '+JSON.stringify(data)+'\n\n');
}
export function textGenerationRoute(req,res,pathname,{
  auth=defaultAuth,service=defaultService,
  authorizedOrigins=(process.env.AUTHORIZED_PRODUCT_ORIGINS||'').split(',').filter(Boolean)
}={}){
 if(pathname!=='/v1/text-generation/stream')return false;
 if(req.method!=='POST'){send(res,405,'method_not_allowed');return true}
 if(!auth||!service){send(res,503,'generation_unconfigured');return true}
 if(!req.headers['content-type']?.startsWith('application/json')){send(res,415,'unsupported_content_type');return true}
 const origin=req.headers.origin;
 if(!origin||!authorizedOrigins.includes(origin)){send(res,403,'origin_not_allowed');return true}
 const product=req.headers['x-sie-product'],tenantId=req.headers['x-tenant-id'];
 if(!['academy','command'].includes(product)||typeof tenantId!=='string'||!UUID.test(tenantId)){send(res,401,'identity_scope_required');return true}
 (async()=>{
  const session=await auth.session({product,cookieHeader:req.headers.cookie||''});
  if(!session?.identityId){send(res,401,'authentication_required');return}
  const body=await parseBody(req);
  const controller=new AbortController();
  res.on('close',()=>{if(!res.writableEnded)controller.abort()});
  res.writeHead(200,{
   'Content-Type':'text/event-stream; charset=utf-8',
   'Cache-Control':'no-store,no-transform',
   'Connection':'keep-alive',
   'X-Content-Type-Options':'nosniff',
   'X-Accel-Buffering':'no'
  });
  frame(res,'started',{status:'authorized',projectId:body.projectId});
  try{
   const receipt=await service.generate({
    context:{tenantId,session},...body,signal:controller.signal,
    onToken:async text=>frame(res,'token',{text})
   });
   frame(res,'completed',{status:receipt.state,projectId:receipt.projectId,artifactId:receipt.artifactId,
    providerResponseId:receipt.providerResponseId,modelRevision:receipt.modelRevision,
    usage:{inputTokens:receipt.inputTokens,outputTokens:receipt.outputTokens},
    settledMicrounits:receipt.settledMicrounits,replayed:receipt.replayed===true});
  }catch(error){
   const code=typeof error?.code==='string'&&/^[a-z_]{2,64}$/.test(error.code)?error.code:'generation_failed';
   frame(res,'error',{code,retryAllowed:false,mayRequireReconciliation:true});
  }finally{if(!res.writableEnded)res.end()}
 })().catch(error=>{if(!res.headersSent)send(res,error?.status||503,error?.code||'generation_unavailable');else{frame(res,'error',{code:'generation_unavailable',retryAllowed:false});res.end()}});
 return true;
}
