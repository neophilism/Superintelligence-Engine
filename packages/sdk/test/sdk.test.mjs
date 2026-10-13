import test from 'node:test';import assert from 'node:assert/strict';import {EngineClient,ApiContractError} from '../src/index.mjs';
test('SDK routes typed operations without hidden provider calls',async()=>{const paths=[];const client=new EngineClient({baseUrl:'https://example.test',fetchImpl:async url=>{paths.push(new URL(url).pathname);return {ok:true,json:async()=>new URL(url).pathname==='/health'?({status:'ok',version:'0.1.0'}):({workspaceKinds:['code'],availableProviders:[],generationEnabled:false})}}});assert.equal((await client.health()).status,'ok');await client.capabilities();assert.deepEqual(paths,['/health','/v1/capabilities']);});
test('SDK propagates failure',async()=>{const client=new EngineClient({baseUrl:'https://example.test',fetchImpl:async()=>({ok:false,status:503})});await assert.rejects(client.health(),/503/);});

const replayTenant='00000000-0000-4000-8000-000000000001',replayRun='00000000-0000-4000-8000-000000000002';
test('SDK replays durable run events from an explicit cursor',async()=>{
 let request;const signal=new AbortController().signal;
 const client=new EngineClient({baseUrl:'https://engine.test',fetchImpl:async(url,options)=>{request={url,options};return {ok:true,headers:{get:()=> 'text/event-stream; charset=utf-8'},text:async()=> 'id: 42\nevent: job.succeeded\ndata: {"payload":{"nodeId":"collect"},"createdAt":"2026-10-13T08:00:00.000Z"}\n\nevent: replay-end\ndata: {"cursor":42}\n\n'};}});
 assert.deepEqual(await client.replayRunEvents(replayRun,{tenantId:replayTenant,product:'command',after:41,signal}),{events:[{id:42,type:'job.succeeded',payload:{nodeId:'collect'},createdAt:'2026-10-13T08:00:00.000Z'}],cursor:42});
 assert.equal(new URL(request.url).pathname,'/v1/runs/'+replayRun+'/events');assert.equal(request.options.headers['Last-Event-ID'],'41');assert.equal(request.options.headers['X-Tenant-ID'],replayTenant);assert.equal(request.options.signal,signal);
});
test('SDK rejects unsafe scopes and malformed or incomplete replay',async()=>{
 const client=new EngineClient({baseUrl:'https://engine.test',fetchImpl:async()=>({ok:true,headers:{get:()=> 'text/event-stream'},text:async()=> 'data: {}\n\n'})});
 await assert.rejects(client.replayRunEvents('unsafe',{tenantId:replayTenant,product:'academy'}),TypeError);
 await assert.rejects(client.replayRunEvents(replayRun,{tenantId:replayTenant,product:'other'}),TypeError);
 await assert.rejects(client.replayRunEvents(replayRun,{tenantId:replayTenant,product:'academy',after:-1}),TypeError);
 await assert.rejects(client.replayRunEvents(replayRun,{tenantId:replayTenant,product:'academy'}),ApiContractError);
});
