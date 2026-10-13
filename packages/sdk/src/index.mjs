import {SCHEMAS} from './schemas.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class ApiContractError extends Error {constructor(message){super(message);this.name='ApiContractError';}}
function check(value,schema,refPath='$'){
  if(schema?.$ref){const key=schema.$ref.split('/').at(-1);if(!SCHEMAS[key])throw new ApiContractError('Unknown schema: '+key);return check(value,SCHEMAS[key],refPath);}
  if(schema?.enum && !schema.enum.includes(value))throw new ApiContractError(refPath+': invalid enum value');
  if(schema?.type==='object'){if(value===null||typeof value!=='object'||Array.isArray(value))throw new ApiContractError(refPath+': expected object');for(const field of schema.required||[]){if(!Object.prototype.hasOwnProperty.call(value,field))throw new ApiContractError(refPath+'.'+field+': required');}for(const [k,child] of Object.entries(schema.properties||{})){if(value[k]!==undefined)check(value[k],child,refPath+'.'+k);}return value;}
  if(schema?.type==='array'){if(!Array.isArray(value))throw new ApiContractError(refPath+': expected array');value.forEach((x,i)=>check(x,schema.items,refPath+'['+i+']'));return value;}
  if(schema?.type==='string' && typeof value!=='string')throw new ApiContractError(refPath+': expected string');
  if(schema?.type==='number' && (typeof value!=='number'||!Number.isFinite(value)))throw new ApiContractError(refPath+': expected number');
  if(schema?.type==='integer' && !Number.isSafeInteger(value))throw new ApiContractError(refPath+': expected integer');
  if(schema?.type==='boolean' && typeof value!=='boolean')throw new ApiContractError(refPath+': expected boolean');
  return value;
}
function parseRunEventReplay(text){
  if(typeof text!=='string')throw new ApiContractError('Run event replay must be text');
  const events=[];let cursor=null;
  for(const block of text.split(/\r?\n\r?\n/)){
    if(!block.trim())continue;
    let id=null,type='message';const data=[];
    for(const line of block.split(/\r?\n/)){
      if(line.startsWith(':'))continue;
      const separator=line.indexOf(':'),field=separator===-1?line:line.slice(0,separator);
      const value=separator===-1?'':line.slice(separator+1).replace(/^ /,'');
      if(field==='id')id=value;else if(field==='event')type=value;else if(field==='data')data.push(value);
    }
    let payload;try{payload=JSON.parse(data.join('\n'))}catch{throw new ApiContractError('Malformed run event data')}
    if(type==='replay-end'){
      if(!Number.isSafeInteger(payload?.cursor)||payload.cursor<0)throw new ApiContractError('Malformed replay cursor');
      cursor=payload.cursor;continue;
    }
    const eventId=Number(id);
    if(!Number.isSafeInteger(eventId)||eventId<1||!type)throw new ApiContractError('Malformed run event');
    if(payload===null||typeof payload!=='object'||Array.isArray(payload)||!Object.prototype.hasOwnProperty.call(payload,'payload'))throw new ApiContractError('Malformed run event payload');
    events.push({id:eventId,type,payload:payload.payload,createdAt:payload.createdAt});
  }
  if(cursor===null)throw new ApiContractError('Run event replay is incomplete');
  if(events.some(event=>event.id>cursor))throw new ApiContractError('Replay cursor precedes an event');
  return {events,cursor};
}
function runScope(runId,{tenantId,product}={}){
  if(typeof runId!=='string'||!UUID.test(runId))throw new TypeError('runId must be a UUID');
  if(typeof tenantId!=='string'||!UUID.test(tenantId))throw new TypeError('tenantId must be a UUID');
  if(!['academy','command'].includes(product))throw new TypeError('product must be academy or command');
  return {tenantId,product};
}
function runRecord(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new ApiContractError('Run response must be an object');
  for(const field of ['id','tenantId','projectId'])if(typeof value[field]!=='string'||!UUID.test(value[field]))throw new ApiContractError('Malformed run '+field);
  if(!['queued','blocked','completed','failed','cancelled'].includes(value.status))throw new ApiContractError('Malformed run status');
  if(typeof value.createdAt!=='string')throw new ApiContractError('Malformed run timestamp');
  if(value.replayed!==undefined&&typeof value.replayed!=='boolean')throw new ApiContractError('Malformed replay flag');
  return value;
}
export function validateResponse(schemaName,value){if(!SCHEMAS[schemaName])throw new ApiContractError('Unknown contract '+schemaName);return check(value,SCHEMAS[schemaName]);}
export class EngineClient {
  constructor({baseUrl,fetchImpl=fetch}={}) {if(!baseUrl)throw new TypeError('baseUrl required');const url=new URL(baseUrl);if(!['https:','http:'].includes(url.protocol))throw new TypeError('Unsupported URL');this.baseUrl=url.toString();this.fetchImpl=fetchImpl;}
  async requestValidated(method,path,body,responseSchema,signal){
    const response=await this.fetchImpl(new URL(path,this.baseUrl),{method,credentials:'include',headers:{'Accept':'application/json',...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
    if(!response.ok) {let code='http_error';try {const error=await response.json();code=typeof error.code==='string'?error.code:code;}catch{};const error=new Error('Engine API '+response.status+': '+code);error.status=response.status;throw error;}
    const result=await response.json();return responseSchema?validateResponse(responseSchema,result):result;
  }
  async health(){return this.requestValidated('GET','/health',undefined,'HealthResponse');}
  async capabilities(){return this.requestValidated('GET','/v1/capabilities',undefined,'CapabilitiesResponse');}
  async runControl(method,runId,{tenantId,product,action='',body,signal}={}){
    runScope(runId,{tenantId,product});
    const response=await this.fetchImpl(new URL('/v1/runs/'+encodeURIComponent(runId)+(action?'/'+action:''),this.baseUrl),{method,credentials:'include',headers:{'Accept':'application/json','X-SIE-Product':product,'X-Tenant-ID':tenantId,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
    if(!response.ok){let code='http_error';try{const error=await response.json();code=typeof error.code==='string'?error.code:code}catch{}const error=new Error('Engine API '+response.status+': '+code);error.status=response.status;throw error}
    return runRecord(await response.json());
  }
  async inspectRun(runId,options={}){return this.runControl('GET',runId,options)}
  async cancelRun(runId,options={}){return this.runControl('POST',runId,{...options,action:'cancel'})}
  async retryRun(runId,{idempotencyKey,...options}={}){
    if(typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(idempotencyKey))throw new TypeError('idempotencyKey is invalid');
    return this.runControl('POST',runId,{...options,action:'retry',body:{idempotencyKey}});
  }
  async replayRunEvents(runId,{tenantId,product,after=0,follow=false,signal}={}){
    if(typeof runId!=='string'||!UUID.test(runId))throw new TypeError('runId must be a UUID');
    if(typeof tenantId!=='string'||!UUID.test(tenantId))throw new TypeError('tenantId must be a UUID');
    if(!['academy','command'].includes(product))throw new TypeError('product must be academy or command');
    if(!Number.isSafeInteger(after)||after<0)throw new TypeError('after must be a non-negative safe integer');
    if(typeof follow!=='boolean')throw new TypeError('follow must be a boolean');
    const url=new URL('/v1/runs/'+encodeURIComponent(runId)+'/events',this.baseUrl);if(follow)url.searchParams.set('follow','1');
    const response=await this.fetchImpl(url,{method:'GET',credentials:'include',headers:{'Accept':'text/event-stream','X-SIE-Product':product,'X-Tenant-ID':tenantId,'Last-Event-ID':String(after)},signal});
    if(!response.ok){let code='http_error';try{const error=await response.json();code=typeof error.code==='string'?error.code:code}catch{}const error=new Error('Engine API '+response.status+': '+code);error.status=response.status;throw error}
    if(!response.headers?.get('content-type')?.toLowerCase().startsWith('text/event-stream'))throw new ApiContractError('Expected run event stream');
    return parseRunEventReplay(await response.text());
  }
  async followRunEvents(runId,options={}){return this.replayRunEvents(runId,{...options,follow:true})}
}
