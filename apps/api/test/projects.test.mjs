import test from 'node:test';import assert from 'node:assert/strict';import {makeServer} from '../src/server.mjs';
test('project endpoints reject unconfigured auth and unauthorized clients, never advertise mock persistence',async()=>{
 const server=makeServer();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const p=await fetch(base+'/v1/projects');assert.equal(p.status,503);assert.equal((await p.json()).code,'project_backend_unconfigured');
  const d=await fetch(base+'/v1/capabilities');assert.equal((await d.json()).generationEnabled,false);
 }finally{await new Promise(ok=>server.close(ok));}
});
