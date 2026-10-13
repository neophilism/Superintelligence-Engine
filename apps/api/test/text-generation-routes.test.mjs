import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {textGenerationRoute} from '../src/text-generation-routes.mjs';
const tenant='00000000-0000-4000-8000-000000000001',project='00000000-0000-4000-8000-000000000002';
async function serve(t,options){const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(!textGenerationRoute(req,res,path,options)){res.writeHead(404);res.end()}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());return `http://127.0.0.1:${server.address().port}`}
const headers=(origin)=>({'content-type':'application/json','x-sie-product':'academy','x-tenant-id':tenant,origin,cookie:'sie=ok'});
test('streams bounded token and durable result events through authenticated tenant context',async t=>{
 let received;const auth={session:async()=>({identityId:'00000000-0000-4000-8000-000000000003'})};
 const service={generate:async input=>{received=input;await input.onToken('one');await input.onToken(' two');return {state:'completed',artifactId:'artifact-1'}}};
 const placeholder='http://127.0.0.1';let origin;const routeOptions={auth,service,authorizedOrigins:[]};const base=await serve(t,routeOptions);origin=new URL(base).origin;routeOptions.authorizedOrigins.push(origin);
 const response=await fetch(`${base}/v1/projects/${project}/text-generations`,{method:'POST',headers:headers(origin),body:JSON.stringify({reservationId:'r',providerId:'p'})});
 assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/event-stream/);const stream=await response.text();
 assert.match(stream,/event: token\ndata: {"text":"one"}/);assert.match(stream,/event: result\ndata: {"state":"completed","artifactId":"artifact-1"}/);
 assert.equal(received.projectId,project);assert.equal(received.context.tenantId,tenant);assert.equal(received.context.session.identityId,'00000000-0000-4000-8000-000000000003');assert.equal(typeof received.onToken,'function');assert.ok(received.signal instanceof AbortSignal);
});
test('fails closed before provider dispatch for unconfigured, cross-origin and unauthenticated requests',async t=>{
 const unconfigured=await serve(t,{});let response=await fetch(`${unconfigured}/v1/projects/${project}/text-generations`,{method:'POST'});assert.equal(response.status,503);
 let calls=0;const options={auth:{session:async()=>null},service:{generate:async()=>{calls++}},authorizedOrigins:[]};const base=await serve(t,options);const origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 response=await fetch(`${base}/v1/projects/${project}/text-generations`,{method:'POST',headers:headers('https://attacker.invalid'),body:'{}'});assert.equal(response.status,403);
 response=await fetch(`${base}/v1/projects/${project}/text-generations`,{method:'POST',headers:headers(origin),body:'{}'});assert.equal(response.status,401);assert.equal(calls,0);
});
test('does not expose internal provider failures before or during a stream',async t=>{
 const auth={session:async()=>({identityId:'00000000-0000-4000-8000-000000000003'})};
 let mode='early';const service={generate:async input=>{if(mode==='early')throw Object.assign(new Error('private secret'),{code:'upstream_error'});await input.onToken('safe');throw Object.assign(new Error('private secret'),{code:'upstream_error'})}};
 const options={auth,service,authorizedOrigins:[]};const base=await serve(t,options);const origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 let response=await fetch(`${base}/v1/projects/${project}/text-generations`,{method:'POST',headers:headers(origin),body:'{}'});assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'generation_unavailable'});
 mode='late';response=await fetch(`${base}/v1/projects/${project}/text-generations`,{method:'POST',headers:headers(origin),body:'{}'});const output=await response.text();assert.equal(response.status,200);assert.match(output,/event: error\ndata: {"code":"generation_unavailable"}/);assert.equal(output.includes('private secret'),false);
});
