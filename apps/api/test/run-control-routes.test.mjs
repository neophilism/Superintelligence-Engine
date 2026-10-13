import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {runControlRoute} from '../src/run-control-routes.mjs';
const tenant='00000000-0000-4000-8000-000000000001',run='00000000-0000-4000-8000-000000000002',identity='00000000-0000-4000-8000-000000000003',project='00000000-0000-4000-8000-000000000004';
async function serve(t,options){const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(!runControlRoute(req,res,path,options)){res.writeHead(404);res.end()}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());return `http://127.0.0.1:${server.address().port}`}
const headers=origin=>({'x-sie-product':'command','x-tenant-id':tenant,origin,cookie:'sie=ok'});
const record=extra=>({id:run,tenantId:tenant,projectId:project,status:'queued',createdAt:'2026-10-13T09:00:00.000Z',...extra});
test('inspects, cancels and idempotently retries an authorized run',async t=>{
 const calls=[];const service={inspect:async input=>(calls.push(['inspect',input]),record()),cancel:async input=>(calls.push(['cancel',input]),record({status:'cancelled',replayed:false})),retry:async input=>(calls.push(['retry',input]),record({replayed:false}))};
 const options={auth:{session:async()=>({identityId:identity})},service,authorizedOrigins:[]};const base=await serve(t,options),origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 let response=await fetch(`${base}/v1/runs/${run}`,{headers:headers(origin)});assert.equal(response.status,200);assert.equal((await response.json()).status,'queued');
 response=await fetch(`${base}/v1/runs/${run}/cancel`,{method:'POST',headers:headers(origin)});assert.equal(response.status,200);assert.equal((await response.json()).status,'cancelled');
 response=await fetch(`${base}/v1/runs/${run}/retry`,{method:'POST',headers:{...headers(origin),'content-type':'application/json'},body:JSON.stringify({idempotencyKey:'retry-1'})});assert.equal(response.status,200);
 assert.deepEqual(calls,[['inspect',{tenantId:tenant,runId:run,identityId:identity}],['cancel',{tenantId:tenant,runId:run,identityId:identity}],['retry',{tenantId:tenant,runId:run,identityId:identity,idempotencyKey:'retry-1'}]]);
});
test('fails closed for origin, session, unsafe retry and provider cancellation limits',async t=>{
 let calls=0;const options={auth:{session:async()=>null},service:{inspect:async()=>{calls++},cancel:async()=>{throw Object.assign(new Error(),{code:'provider_cancel_unavailable'})},retry:async()=>{calls++}},authorizedOrigins:[]};const base=await serve(t,options),origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 let response=await fetch(`${base}/v1/runs/${run}`,{headers:headers(origin)});assert.equal(response.status,401);
 options.auth={session:async()=>({identityId:identity})};
 response=await fetch(`${base}/v1/runs/${run}/retry`,{method:'POST',headers:{...headers(origin),'content-type':'application/json'},body:'{"idempotencyKey":"unsafe key"}'});assert.equal(response.status,400);
 response=await fetch(`${base}/v1/runs/${run}/cancel`,{method:'POST',headers:headers(origin)});assert.equal(response.status,409);assert.equal((await response.json()).code,'provider_cancel_unavailable');
 response=await fetch(`${base}/v1/runs/${run}`,{headers:headers('https://attacker.invalid')});assert.equal(response.status,403);assert.equal(calls,0);
});
