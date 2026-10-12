import test from 'node:test';
import assert from 'node:assert/strict';
import {makeServer} from '../src/server.mjs';
import {normalizeProductOrigins} from '../src/product-cors.mjs';

const origins=normalizeProductOrigins({academy:'https://academy.platform.example',command:'https://command.platform.example'});
const person='00000000-0000-4000-8000-000000000010';
async function withServer(options,fn){
 const server=makeServer(options);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{return await fn('http://127.0.0.1:'+server.address().port)}
 finally{await new Promise(resolve=>server.close(resolve))}
}
test('safe explicit origins: never wildcard, duplicate or invalid app origins',()=>{
 assert.equal(origins.academy,'https://academy.platform.example');
 assert.equal(origins.command,'https://command.platform.example');
 assert.throws(()=>normalizeProductOrigins({academy:'https://same.example',command:'https://same.example'}),/separate origins/);
 assert.equal(normalizeProductOrigins({academy:'https://academy.platform.example/path'}).academy,null);
 assert.equal(normalizeProductOrigins({academy:'http://public.example'}).academy,null);
});
test('browser origin is bound to product, and preflight allows only necessary headers',async()=>{
 let calls=0;
 await withServer({originConfig:origins,tenantAuth:{session:async({product,cookieHeader})=>{calls++;return cookieHeader.includes('valid-session')?{identityId:person,product}:null}},
 tenantDb:{query:async()=>({rows:[{id:'00000000-0000-4000-8000-000000000011',name:'Owner Workspace',role:'owner'}]})}},
 async root=>{
  const preflight=await fetch(root+'/v1/tenants',{method:'OPTIONS',headers:{Origin:origins.academy,'X-SIE-Product':'academy','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'X-SIE-Product'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),origins.academy);
  assert.equal(preflight.headers.get('access-control-allow-credentials'),'true');
  const wrong=await fetch(root+'/v1/tenants',{headers:{Origin:origins.command,'X-SIE-Product':'academy',Cookie:'valid-session'}});
  assert.equal(wrong.status,403);assert.equal(calls,0);
  const evil=await fetch(root+'/v1/tenants',{headers:{Origin:'https://attacker.example','X-SIE-Product':'academy',Cookie:'valid-session'}});
  assert.equal(evil.status,403);assert.equal(calls,0);
  const forbidden=await fetch(root+'/v1/tenants',{method:'OPTIONS',headers:{Origin:origins.academy,'X-SIE-Product':'academy','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'Authorization,X-Secret'}});
  assert.equal(forbidden.status,403);
  const authorized=await fetch(root+'/v1/tenants',{headers:{Origin:origins.academy,'X-SIE-Product':'academy',Cookie:'valid-session'}});
  assert.equal(authorized.status,200);
  assert.equal((await authorized.json()).items[0].role,'owner');
  assert.equal(calls,1);
 });
});
test('unauthenticated session and unconfigured backends fail closed',async()=>{
 await withServer({originConfig:origins,tenantAuth:{session:async()=>null},tenantDb:{query:async()=>{throw Error('must not query')}}},async root=>{
  const x=await fetch(root+'/v1/tenants',{headers:{Origin:origins.command,'X-SIE-Product':'command'}});
  assert.equal(x.status,401);assert.equal((await x.json()).code,'authentication_required');
 });
 await withServer({originConfig:origins,tenantAuth:{session:async()=>({identityId:person})},tenantDb:null},async root=>{
  const x=await fetch(root+'/v1/tenants',{headers:{Origin:origins.academy,'X-SIE-Product':'academy'}});
  assert.equal(x.status,503);
 });
});
