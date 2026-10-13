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


test('SDK exposes explicit authenticated run controls without hidden retries',async()=>{
 const requests=[],project='00000000-0000-4000-8000-000000000004',createdAt='2026-10-13T09:00:00.000Z';
 const client=new EngineClient({
  baseUrl:'https://engine.test',
  fetchImpl:async(url,options)=>{
   requests.push({url:new URL(url),options});
   const status=options.method==='POST'&&new URL(url).pathname.endsWith('/cancel')?'cancelled':'queued';
   return {ok:true,json:async()=>({id:replayRun,tenantId:replayTenant,projectId:project,status,createdAt,replayed:false})};
  }
 });
 assert.equal((await client.inspectRun(replayRun,{tenantId:replayTenant,product:'command'})).status,'queued');
 assert.equal((await client.cancelRun(replayRun,{tenantId:replayTenant,product:'command'})).status,'cancelled');
 await client.retryRun(replayRun,{tenantId:replayTenant,product:'command',idempotencyKey:'retry-1'});
 assert.deepEqual(requests.map(x=>[x.options.method,x.url.pathname]),[['GET','/v1/runs/'+replayRun],['POST','/v1/runs/'+replayRun+'/cancel'],['POST','/v1/runs/'+replayRun+'/retry']]);
 assert.equal(JSON.parse(requests[2].options.body).idempotencyKey,'retry-1');assert.equal(requests[2].options.headers['X-Tenant-ID'],replayTenant);
});
test('SDK rejects invalid run controls and malformed run records',async()=>{
 const malformed=new EngineClient({baseUrl:'https://engine.test',fetchImpl:async()=>({ok:true,json:async()=>({status:'queued'})})});
 await assert.rejects(malformed.inspectRun(replayRun,{tenantId:replayTenant,product:'command'}),ApiContractError);
 await assert.rejects(malformed.cancelRun('unsafe',{tenantId:replayTenant,product:'command'}),TypeError);
 await assert.rejects(malformed.retryRun(replayRun,{tenantId:replayTenant,product:'command',idempotencyKey:'unsafe key'}),TypeError);
});

test('SDK opts into bounded live event follow with cursor continuity',async()=>{
 let request;const client=new EngineClient({baseUrl:'https://engine.test',fetchImpl:async(url,options)=>{request={url:new URL(url),options};return {ok:true,headers:{get:()=> 'text/event-stream'},text:async()=> 'id: 43\nevent: run.completed\ndata: {"payload":{"status":"completed"},"createdAt":"2026-10-13T09:45:00.000Z"}\n\nevent: replay-end\ndata: {"cursor":43}\n\n'};}});
 const result=await client.followRunEvents(replayRun,{tenantId:replayTenant,product:'command',after:42});
 assert.equal(request.url.searchParams.get('follow'),'1');assert.equal(request.options.headers['Last-Event-ID'],'42');assert.equal(result.cursor,43);assert.equal(result.events[0].type,'run.completed');
 await assert.rejects(client.replayRunEvents(replayRun,{tenantId:replayTenant,product:'command',follow:'yes'}),TypeError);
});
