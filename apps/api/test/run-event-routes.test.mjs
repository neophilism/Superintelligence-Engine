import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {runEventRoute} from '../src/run-event-routes.mjs';
const tenant='00000000-0000-4000-8000-000000000001',run='00000000-0000-4000-8000-000000000002',identity='00000000-0000-4000-8000-000000000003';
async function serve(t,options){const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(!runEventRoute(req,res,path,options)){res.writeHead(404);res.end()}});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());return `http://127.0.0.1:${server.address().port}`}
const headers=origin=>({'x-sie-product':'command','x-tenant-id':tenant,origin,cookie:'sie=ok'});
test('replays tenant-authorized events after a durable cursor',async t=>{
 let input;const options={auth:{session:async()=>({identityId:identity})},service:{events:async value=>{input=value;return [{id:42,type:'job.succeeded',payload:{nodeId:'collect'},createdAt:'2026-10-13T08:00:00.000Z'}]}},authorizedOrigins:[]};
 const base=await serve(t,options),origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 const response=await fetch(`${base}/v1/runs/${run}/events`,{headers:{...headers(origin),'last-event-id':'41'}});assert.equal(response.status,200);
 const body=await response.text();assert.match(body,/id: 42\nevent: job.succeeded/);assert.match(body,/event: replay-end\ndata: {"cursor":42}/);
 assert.deepEqual(input,{tenantId:tenant,runId:run,identityId:identity,after:41,limit:200});
});
test('fails closed for invalid cursors, origins and sessions',async t=>{
 let calls=0;const options={auth:{session:async()=>null},service:{events:async()=>{calls++;return []}},authorizedOrigins:[]};const base=await serve(t,options),origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 let response=await fetch(`${base}/v1/runs/${run}/events?after=unsafe`,{headers:headers(origin)});assert.equal(response.status,401);
 options.auth={session:async()=>({identityId:identity})};response=await fetch(`${base}/v1/runs/${run}/events?after=unsafe`,{headers:headers(origin)});assert.equal(response.status,400);
 response=await fetch(`${base}/v1/runs/${run}/events`,{headers:headers('https://attacker.invalid')});assert.equal(response.status,403);assert.equal(calls,0);
});

test('follows delayed durable events and closes on terminal state',async t=>{
 let calls=0;const observed=[];
 const options={auth:{session:async()=>({identityId:identity})},service:{events:async value=>{observed.push(value.after);calls++;return calls===1?[]:[{id:43,type:'run.completed',payload:{status:'completed'},createdAt:'2026-10-13T09:45:00.000Z'}]}},authorizedOrigins:[],pollIntervalMs:0,maxFollowMs:100,wait:async()=>{}};
 const base=await serve(t,options),origin=new URL(base).origin;options.authorizedOrigins.push(origin);
 const response=await fetch(`${base}/v1/runs/${run}/events?follow=1`,{headers:{...headers(origin),'last-event-id':'42'}});
 assert.equal(response.status,200);const body=await response.text();
 assert.match(body,/: keep-alive/);assert.match(body,/id: 43\nevent: run.completed/);assert.match(body,/event: replay-end\ndata: {"cursor":43}/);
 assert.deepEqual(observed,[42,42]);
});
