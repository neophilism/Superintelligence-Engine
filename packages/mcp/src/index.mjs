import {createHash,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';

const VERSION='2026-07-28';
const ID=/^[a-z][a-z0-9_.-]{1,99}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REQUEST=32768,MAX_RESPONSE=262144;
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export class McpGatewayError extends Error{
 constructor(code,detail){super(detail||code);this.name='McpGatewayError';this.code=code}
}
function guard(condition,code,detail){if(!condition)throw new McpGatewayError(code,detail)}
function principalScope(value){guard(value&&UUID.test(value.tenantId||'')&&UUID.test(value.identityId||''),'invalid_principal');return value}
function id(value){guard(typeof value==='string'&&ID.test(value),'invalid_identifier');return value}
function validateEndpoint(input,allowedHosts){
 let endpoint;try{endpoint=new URL(input)}catch{throw new McpGatewayError('invalid_endpoint')}
 guard(endpoint.protocol==='https:'&&!endpoint.username&&!endpoint.password&&!endpoint.hash,'unsafe_endpoint');
 guard(!isIP(endpoint.hostname)&&!['localhost'].includes(endpoint.hostname)&&!/\.(local|internal|localhost)$/i.test(endpoint.hostname),'unsafe_endpoint');
 guard(allowedHosts.includes(endpoint.hostname),'egress_not_allowlisted');
 return endpoint;
}
function requireJSON(value,label='arguments'){
 let text;try{text=JSON.stringify(value)}catch{throw new McpGatewayError('invalid_json',label)}
 guard(typeof text==='string'&&text.length<=MAX_REQUEST,'invalid_json',label+' exceeds size limit');
 return text;
}
export function validateArguments(input,schema){
 guard(schema&&schema.type==='object'&&schema.properties&&typeof schema.properties==='object','invalid_schema');
 guard(input&&typeof input==='object'&&!Array.isArray(input),'invalid_arguments');
 for(const name of schema.required||[])guard(Object.hasOwn(input,name),'missing_required_argument',name);
 const props=schema.properties;
 for(const [name,value] of Object.entries(input)){
   guard(name!=='__proto__'&&name!=='constructor'&&name!=='prototype','invalid_arguments');
   const field=props[name];guard(Boolean(field)||schema.additionalProperties!==false,'unknown_argument',name);
   if(!field)continue;
   const type=field.type;
   if(type==='string')guard(typeof value==='string'&&value.length<=16384,'invalid_argument_type',name);
   else if(type==='boolean')guard(typeof value==='boolean','invalid_argument_type',name);
   else if(type==='integer')guard(Number.isSafeInteger(value),'invalid_argument_type',name);
   else if(type==='number')guard(typeof value==='number'&&Number.isFinite(value),'invalid_argument_type',name);
   else if(type==='array')guard(Array.isArray(value)&&value.length<=200,'invalid_argument_type',name);
   else if(type==='object')guard(value&&typeof value==='object'&&!Array.isArray(value),'invalid_argument_type',name);
   else guard(false,'unsupported_argument_schema',name);
   if(field.enum)guard(field.enum.includes(value),'invalid_argument_enum',name);
 }
 requireJSON(input);return input;
}
function headerMetadata(schema,args){
 const headers={};
 for(const [field,rule] of Object.entries(schema.properties||{})){
   if(!rule['x-mcp-header']||!Object.hasOwn(args,field))continue;
   const label=rule['x-mcp-header'];
   guard(typeof label==='string'&&/^[A-Za-z0-9-]{1,90}$/.test(label),'unsafe_header_schema');
   guard(typeof args[field]==='string'&&/^[\x20-\x7e]{1,256}$/.test(args[field]),'unsafe_header_value');
   headers['Mcp-Param-'+label]=args[field];
 }
 return headers;
}
async function boundedText(response){
 const reader=response.body?.getReader?.();
 if(!reader){const value=await response.text();guard(value.length<=MAX_RESPONSE,'response_too_large');return value}
 const decoder=new TextDecoder(),parts=[];let bytes=0;
 try{while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;guard(bytes<=MAX_RESPONSE,'response_too_large');parts.push(decoder.decode(chunk.value,{stream:true}));}parts.push(decoder.decode());return parts.join('')}
 finally{await reader.cancel().catch(()=>{})}
}
function unwrapResponse(text,contentType,requestId){
 let messages;
 if(contentType.includes('text/event-stream')){
   messages=text.split(/\r?\n\r?\n/).map(entry=>entry.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n')).filter(Boolean);
 }else messages=[text];
 for(let i=messages.length-1;i>=0;i--){
   let parsed;try{parsed=JSON.parse(messages[i])}catch{throw new McpGatewayError('invalid_rpc_response')}
   if(parsed.id!==requestId)continue;
   guard(parsed.jsonrpc==='2.0'&&!Object.hasOwn(parsed,'method'),'invalid_rpc_response');
   if(parsed.error)throw new McpGatewayError('remote_error','Remote MCP tool failed');
   guard(Object.hasOwn(parsed,'result'),'invalid_rpc_response');
   return parsed.result;
 }
 throw new McpGatewayError('missing_rpc_result','No matching MCP JSON-RPC response');
}
async function transaction(pool,fn){
 const db=await pool.connect();
 try{await db.query('BEGIN');try{const value=await fn(db);await db.query('COMMIT');return value}catch(error){await db.query('ROLLBACK');throw error}}
 finally{db.release()}
}
export class McpGrantStore {
 constructor({pool}={}){if(!pool||typeof pool.connect!=='function')throw new TypeError('Trusted PostgreSQL pool required');this.pool=pool}
 async grant({principal,connectionId,scope,expiresAt,approvedByUser}){
   principalScope(principal);id(connectionId);
   guard(approvedByUser===true,'consent_required','Explicit user consent is required');
   guard(typeof scope==='string'&&scope.length>0&&scope.length<=512,'invalid_scope');
   const expiry=new Date(expiresAt).getTime();
   guard(Number.isFinite(expiry)&&expiry>Date.now()&&expiry<=Date.now()+30*86400000,'invalid_expiration');
   return transaction(this.pool,async db=>{
     const member=await db.query('SELECT 1 FROM memberships WHERE tenant_id=$1 AND identity_id=$2',[principal.tenantId,principal.identityId]);
     guard(member.rowCount===1,'membership_required');
     const row=await db.query("INSERT INTO mcp_tool_grants(tenant_id,identity_id,connection_id,resource_scope,expires_at,approval_source) VALUES($1,$2,$3,$4,$5,'direct-user-consent') RETURNING id",
       [principal.tenantId,principal.identityId,connectionId,scope,new Date(expiry).toISOString()]);
     return row.rows[0].id;
   });
 }
 async revoke({principal,grantId}){
   principalScope(principal);guard(UUID.test(grantId||''),'invalid_grant');
   const result=await this.pool.query('UPDATE mcp_tool_grants SET revoked_at=now() WHERE id=$1 AND tenant_id=$2 AND identity_id=$3 AND revoked_at IS NULL RETURNING id',[grantId,principal.tenantId,principal.identityId]);
   return result.rowCount>0;
 }
 async authorize({principal,connectionId,scope}){
   principalScope(principal);id(connectionId);
   const result=await this.pool.query("SELECT g.id FROM mcp_tool_grants g JOIN memberships m ON m.tenant_id=g.tenant_id AND m.identity_id=g.identity_id WHERE g.tenant_id=$1 AND g.identity_id=$2 AND g.connection_id=$3 AND g.resource_scope=$4 AND g.expires_at>now() AND g.revoked_at IS NULL ORDER BY g.expires_at DESC LIMIT 1",[principal.tenantId,principal.identityId,connectionId,scope]);
   guard(result.rowCount>0,'grant_denied','No current user-approved tool permission');
   return true;
 }
 async audit({principal,connectionId,scope,decision,input,output=null}){
   principalScope(principal);id(connectionId);
   guard(['allowed','denied','failed'].includes(decision),'invalid_audit_decision');
   return transaction(this.pool,async db=>{
     await db.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[principal.tenantId]);
     const previous=(await db.query('SELECT event_sha256 FROM mcp_tool_audit WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1',[principal.tenantId])).rows[0]?.event_sha256||'0'.repeat(64);
     const inputDigest=hash(input),resultDigest=output===null?null:hash(output);
     const digest=hash([previous,principal.tenantId,principal.identityId,connectionId,scope,decision,inputDigest,resultDigest]);
     await db.query('INSERT INTO mcp_tool_audit(tenant_id,identity_id,connection_id,resource_scope,decision,input_sha256,output_sha256,previous_sha256,event_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
       [principal.tenantId,principal.identityId,connectionId,scope,decision,inputDigest,resultDigest,previous,digest]);
     return digest;
   });
 }
}
export class ScopedMcpGateway {
 constructor({connections=[],allowedHosts=[],grantStore,fetchImpl=fetch,egressGuard,secretResolver=()=>{}}={}){
   guard(grantStore&&typeof grantStore.authorize==='function'&&typeof grantStore.audit==='function','grant_store_required');
   guard(typeof egressGuard==='function','egress_gate_required','An independently controlled outbound network policy is required');
   this.grants=grantStore;this.fetchImpl=fetchImpl;this.egressGuard=egressGuard;this.secrets=secretResolver;this.connections=new Map();
   for(const conn of connections){
     id(conn.id);const url=validateEndpoint(conn.endpoint,allowedHosts);guard(!this.connections.has(conn.id),'duplicate_connection');
     const tools=new Map();
     for(const tool of conn.tools||[]){
       id(tool.name);guard(['read','external'].includes(tool.effects),'invalid_tool_effect');
       guard(tool.inputSchema?.type==='object'&&tool.inputSchema.properties,'invalid_schema');
       guard(!tools.has(tool.name),'duplicate_tool');
       tools.set(tool.name,tool);
     }
     for(const uri of conn.resources||[])guard(typeof uri==='string'&&uri.length<=300&&/^[\x20-\x7e]+$/.test(uri),'invalid_resource');
     if(conn.tokenEnvRef!==undefined)guard(/^MCP_[A-Z0-9_]{3,100}$/.test(conn.tokenEnvRef),'invalid_secret_ref');
     this.connections.set(conn.id,{...conn,endpoint:url,tools,resources:new Set(conn.resources||[])});
   }
 }
 async invoke({principal,connectionId,method,name,args={}}){
   principalScope(principal);id(connectionId);
   const conn=this.connections.get(connectionId);
   guard(Boolean(conn),'unknown_connection');
   guard(method==='tools/call'||method==='resources/read','operation_not_allowed');
   guard(typeof name==='string'&&name.length<=512,'invalid_name');
   const scope=method==='tools/call'?'tool:'+name:'resource:'+name;
   let decision='denied',response=null;
   try{
     if(method==='tools/call'){
       const tool=conn.tools.get(name);guard(Boolean(tool),'tool_not_allowlisted');
       guard(tool.effects==='read','external_action_requires_separate_approval');
       validateArguments(args,tool.inputSchema);
     }else guard(conn.resources.has(name),'resource_not_allowlisted');
     await this.grants.authorize({principal,connectionId,scope});
     guard(await this.egressGuard(conn.endpoint),'egress_denied');
     const requestId=randomUUID();
     const parameters=method==='tools/call'?{name,arguments:args}:{uri:name};
     parameters._meta={
       'io.modelcontextprotocol/protocolVersion':VERSION,
       'io.modelcontextprotocol/clientInfo':{name:'Superintelligence-Engine',version:'0.1.0'},
       'io.modelcontextprotocol/clientCapabilities':{}
     };
     const body={jsonrpc:'2.0',id:requestId,method,params:parameters};
     const headers={
       'Content-Type':'application/json',
       'Accept':'application/json, text/event-stream',
       'MCP-Protocol-Version':VERSION,
       'Mcp-Method':method,
       'Mcp-Name':name
     };
     guard(/^[\x20-\x7e]+$/.test(name),'unsafe_header_value');
     if(method==='tools/call')Object.assign(headers,headerMetadata(conn.tools.get(name).inputSchema,args));
     if(conn.tokenEnvRef){
       const token=await this.secrets(conn.tokenEnvRef);
       guard(typeof token==='string'&&token.length>0,'credential_unavailable');
       headers.Authorization='Bearer '+token;
     }
     const reply=await this.fetchImpl(conn.endpoint,{method:'POST',headers,redirect:'error',body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
     guard(reply.ok,'remote_http_error','MCP server did not return success');
     const payload=await boundedText(reply);
     response=unwrapResponse(payload,reply.headers?.get('content-type')||'',requestId);
     decision='allowed';
     return {untrusted:true,connectionId,method,source:String(conn.endpoint.origin),result:response};
   }catch(error){decision=error.code==='grant_denied'||error.code==='egress_denied'||error.code==='tool_not_allowlisted'?'denied':'failed';throw error}
   finally{await this.grants.audit({principal,connectionId,scope,decision,input:method==='tools/call'?{tool:name,args}:{uri:name},output:response});}
 }
 async callTool({principal,connectionId,toolName,args}){return this.invoke({principal,connectionId,method:'tools/call',name:toolName,args})}
 async readResource({principal,connectionId,uri}){return this.invoke({principal,connectionId,method:'resources/read',name:uri})}
}
export const MCP_PROTOCOL_VERSION=VERSION;
