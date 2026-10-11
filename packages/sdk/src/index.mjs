import {SCHEMAS} from './schemas.mjs';
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
}
