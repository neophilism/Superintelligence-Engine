import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProjectPortal,ProjectPortalClient,parseProjectTransfer,buildProjectTransfer} from '../src/index.mjs';

const tenant='00000000-0000-4000-8000-000000000011',project='00000000-0000-4000-8000-000000000022';
test('both products share exactly the same canonical project identifiers and transfer links',()=>{
 const url=buildProjectTransfer('https://academy.example',tenant,project);
 assert.deepEqual(parseProjectTransfer(url),{tenantId:tenant,projectId:project});
 assert.equal(parseProjectTransfer('https://academy.example?tenant=not-valid&project='+project),null);
 assert.throws(()=>buildProjectTransfer('https://command.example/evil',tenant,project),/trusted origin/);
 assert.throws(()=>buildProjectTransfer('http://remote.example',tenant,project),/HTTPS/);
});
test('credentialed project API sends product audience and tenant scope, never a provider key',async()=>{
 const requests=[];
 const client=new ProjectPortalClient({engineOrigin:'https://engine.platform.example',product:'academy',
  fetchImpl:async(url,init)=>{
   requests.push({url:String(url),init});
   return Response.json({items:[{id:project,title:'Story',kind:'video',revision:2}]});
  }
 });
 assert.deepEqual((await client.projects(tenant)).items[0].id,project);
 assert.equal(requests[0].url,'https://engine.platform.example/v1/projects');
 assert.equal(requests[0].init.credentials,'include');
 assert.equal(requests[0].init.headers['X-SIE-Product'],'academy');
 assert.equal(requests[0].init.headers['X-Tenant-Id'],tenant);
 assert.equal(requests[0].init.headers.Authorization,undefined);
 assert.equal(client.signInUrl(),'https://engine.platform.example/auth/academy/start');
});
test('project creation requires a tenant and is a real authenticated POST',async()=>{
 const requests=[];
 const client=new ProjectPortalClient({engineOrigin:'https://engine.platform.example',product:'command',fetchImpl:async(u,i)=>{requests.push(i);return Response.json({id:project,title:'Bill',kind:'legislation',revision:1})}});
 assert.equal((await client.createProject(tenant,{title:'Bill',kind:'legislation'})).id,project);
 assert.equal(requests[0].method,'POST');
 assert.equal(requests[0].headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(requests[0].body),{title:'Bill',kind:'legislation'});
 await assert.rejects(client.projects('wrong tenant'),/Invalid tenantId/);
});
test('portfolio has truthful empty configuration and identical semantics across themes',()=>{
 const a=renderToStaticMarkup(React.createElement(ProjectPortal,{product:'academy',domain:'music',engineOrigin:''}));
 const c=renderToStaticMarkup(React.createElement(ProjectPortal,{product:'command',domain:'music',engineOrigin:''}));
 assert.match(a,/data-product="academy"/);assert.match(c,/data-product="command"/);
 for(const html of [a,c]){assert.match(html,/Shared project storage is not configured/);assert.doesNotMatch(html,/fake|sample|lesson|AI generation enabled/);}
});
