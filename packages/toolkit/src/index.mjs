import {verify,createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import manifestSchema from '../contracts/tool-manifest.schema.json' with {type:'json'};
import {WORKSPACE_DOMAINS,toolAnchor} from '@superintelligence/ui';
const ajv=new Ajv2020({allErrors:true,strict:false});
const validateManifest=ajv.compile(manifestSchema);
function canonical(value){
 if(value===null || typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export function canonicalManifest(manifest){return canonical(manifest);}
export function manifestDigest(manifest){return createHash('sha256').update(canonical(manifest)).digest('hex');}
function parseVersion(v){if(!/^\d+\.\d+\.\d+$/.test(v))throw new Error('Invalid engine version');return v.split('.').map(Number);}
function atLeast(current,minimum){const a=parseVersion(current),b=parseVersion(minimum);for(let i=0;i<3;i++){if(a[i]>b[i])return true;if(a[i]<b[i])return false;}return true;}
function safeInputSchema(s){return s && typeof s==='object' && !Array.isArray(s) && !JSON.stringify(s).includes('http://') && !JSON.stringify(s).includes('https://');}
export class DomainToolRegistry {
 constructor({trustedPublisherKeys, trustedModules,engineVersion='0.1.0'}={}){
  this.keys=new Map(Object.entries(trustedPublisherKeys||{}));
  this.modules=new Map(Object.entries(trustedModules||{}));
  this.engineVersion=engineVersion;
  this.tools=new Map();
 }
 register({manifest,signature}){
  if(!validateManifest(manifest))throw new Error('Invalid tool manifest: '+ajv.errorsText(validateManifest.errors));
  if(!WORKSPACE_DOMAINS.includes(manifest.domain))throw new Error('Unknown domain');
  if(!atLeast(this.engineVersion,manifest.minEngineVersion))throw new Error('Incompatible engine version');
  const publicKey=this.keys.get(manifest.publisherKeyId);
  if(!publicKey)throw new Error('Untrusted publisher');
  if(typeof signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))throw new Error('Signature missing or malformed');
  if(!verify(null,Buffer.from(canonical(manifest)),publicKey,Buffer.from(signature,'base64')))throw new Error('Invalid publisher signature');
  const provider=this.modules.get(manifest.id);
  if(!provider)throw new Error('No trusted local implementation');
  for(const anchor of manifest.uiAnchors){const prefix=manifest.domain+'.';if(!anchor.startsWith(prefix))throw new Error('Anchor domain mismatch');toolAnchor(manifest.domain,anchor.slice(prefix.length));}
  const ids=new Set(),compiled=new Map();
  for(const op of manifest.operations){
    if(ids.has(op.id))throw new Error('Duplicate operation id');ids.add(op.id);
    if(typeof provider[op.handler]!=='function')throw new Error('Missing trusted handler '+op.handler);
    if(!safeInputSchema(op.inputSchema)||!safeInputSchema(op.outputSchema))throw new Error('Remote schemas forbidden');
    let input,output;try{input=ajv.compile(op.inputSchema);output=ajv.compile(op.outputSchema);}catch{throw new Error('Invalid operation JSON Schema');}
    compiled.set(op.id,{op,input,output});
  }
  if(this.tools.has(manifest.id))throw new Error('Tool already registered');
  this.tools.set(manifest.id,Object.freeze({manifest:Object.freeze(structuredClone(manifest)),digest:manifestDigest(manifest),compiled,provider}));
  return this.describe(manifest.id);
 }
 describe(id){const record=this.tools.get(id);if(!record)throw new Error('Unknown tool');return {id,domain:record.manifest.domain,uiAnchors:[...record.manifest.uiAnchors],operations:record.manifest.operations.map(x=>({id:x.id,requiredScopes:[...x.requiredScopes]})),digest:record.digest};}
 list(){return [...this.tools.keys()].map(id=>this.describe(id));}
 async invoke({toolId,operationId,input,grantedScopes=[]}){
  const entry=this.tools.get(toolId);if(!entry)throw new Error('Unknown tool');
  const bound=entry.compiled.get(operationId);if(!bound)throw new Error('Unknown operation');
  if(!Array.isArray(grantedScopes)||bound.op.requiredScopes.some(scope=>!grantedScopes.includes(scope)))throw new Error('Unauthorized operation scope');
  if(!bound.input(input))throw new Error('Invalid operation input: '+ajv.errorsText(bound.input.errors));
  const result=await entry.provider[bound.op.handler](structuredClone(input));
  if(!bound.output(result))throw new Error('Trusted plugin returned invalid output: '+ajv.errorsText(bound.output.errors));
  return structuredClone(result);
 }
}
