import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {runControlRoute} from '../src/run-control-routes.mjs';
const tenant='00000000-0000-4000-8000-000000000001',run='00000000-0000-4000-8000-000000000002',identity='00000000-0000-4000-8000-000000000003';
async function serve(t,options){const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(!runControlRoute(req,res,path,options)){res.writeHead(404);res.end()}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());return `http://127.0.0.1:${server.address().port}`}
const headers=origin=>({'x-sie-product':'command','x-tenant-id':tenant,origin,cookie:'sie=ok'});
test('routes authenticated cancellation and caller-keyed retry to the durable service',async t=>{
 const calls=[];const options={auth:{session:async()=>({identityId:identity})},service:{cancel:async value=>{calls.push(['cancel',value]);return {id:run,status:'cancelled',replayed:false}},retry:async value=>{calls.push(['retry',value]);return {id:run,status:'queued',replayed:false}}},authorizedOrigins:[]};
 const base=await serve(t,options),origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 let response=await fetch(`${base}/v1/runs/${run}/cancel`,{method:'POST',headers:headers(origin)});assert.equal(response.status,200);assert.equal((await response.json()).status,'cancelled');
 response=await fetch(`${base}/v1/runs/${run}/retry`,{method:'POST',headers:{...headers(origin),'content-type':'application/json'},body:JSON.stringify({idempotencyKey:'retry-one'})});assert.equal(response.status,200);
 assert.deepEqual(calls,[['cancel',{tenantId:tenant,runId:run,identityId:identity}],['retry',{tenantId:tenant,runId:run,identityId:identity,idempotencyKey:'retry-one'}]]);
});
test('fails closed for bad origins, sessions, bodies and provider ambiguity',async t=>{
 let calls=0;const options={auth:{session:async()=>null},service:{cancel:async()=>{calls++},retry:async()=>{calls++;throw Object.assign(new Error(),{code:'provider_cancel_unavailable'})}},authorizedOrigins:[]};
 const base=await serve(t,options),origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 let response=await fetch(`${base}/v1/runs/${run}/cancel`,{method:'POST',headers:headers('https://attacker.invalid')});assert.equal(response.status,403);assert.equal(calls,0);
 response=await fetch(`${base}/v1/runs/${run}/cancel`,{method:'POST',headers:headers(origin)});assert.equal(response.status,401);
 options.auth={session:async()=>({identityId:identity})};
 response=await fetch(`${base}/v1/runs/${run}/retry`,{method:'POST',headers:{...headers(origin),'content-type':'text/plain'},body:'retry-one'});assert.equal(response.status,400);
 response=await fetch(`${base}/v1/runs/${run}/retry`,{method:'POST',headers:{...headers(origin),'content-type':'application/json'},body:'{}'});assert.equal(response.status,409);assert.equal((await response.json()).code,'provider_cancel_unavailable');
});
