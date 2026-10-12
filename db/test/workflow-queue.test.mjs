import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {DurableJobQueue,QueueError} from '../../packages/jobs/src/index.mjs';
import {processOne} from '../../apps/worker/src/worker.mjs';
const url=process.env.TEST_DATABASE_URL;
function recipe(key='test'){
 return {schemaVersion:1,id:key,version:1,budgetMicros:0,nodes:[
  {id:'collect',operation:'research.collect',effects:'read',dependsOn:[],inputs:{},outputs:{result:'application/json'},maxCostMicros:0},
  {id:'validate',operation:'research.validate',effects:'read',dependsOn:['collect'],inputs:{source:{from:{node:'collect',port:'result'},mimeType:'application/json'}},outputs:{result:'application/json'},maxCostMicros:0}
 ],deliverables:[{id:'validated',from:{node:'validate',port:'result'},mimeType:'application/json'}]};
}
test('durable queue: idempotent submit, concurrent lease, dependent release, checkpoint and complete',{skip:!url},async()=>{
 const pool=new pg.Pool({connectionString:url,max:12}),q=new DurableJobQueue({pool});
 try{
  const tenant=(await pool.query("INSERT INTO tenants(name) VALUES('queue test') RETURNING id")).rows[0].id;
  const identity=(await pool.query("INSERT INTO identities(issuer,subject) VALUES('queue',gen_random_uuid()::text) RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO memberships(tenant_id,identity_id,role) VALUES($1,$2,'owner')",[tenant,identity]);
  const project=(await pool.query("INSERT INTO projects(tenant_id,owner_id,title,kind) VALUES($1,$2,'Queue Test','research') RETURNING id",[tenant,identity])).rows[0].id;
  const args={tenantId:tenant,identityId:identity,projectId:project,idempotencyKey:'run-one',recipe:recipe()};
  const first=await q.enqueue(args),replay=await q.enqueue(args);
  assert.equal(first.id,replay.id);
  await assert.rejects(q.enqueue({...args,recipe:recipe('different')}),e=>e.code==='idempotency_conflict');
  const [lease,other]=await Promise.all([q.claim({workerId:'first'}),q.claim({workerId:'second'})]);
  assert.ok(lease);assert.equal(other,null);
  assert.equal(lease.node_id,'collect');
  await q.checkpoint({jobId:lease.id,workerId:'first',leaseToken:lease.lease_token,data:{cursor:5}});
  await assert.rejects(q.complete({jobId:lease.id,workerId:'second',leaseToken:lease.lease_token,result:{}}),e=>e.code==='stale_lease');
  await q.complete({jobId:lease.id,workerId:'first',leaseToken:lease.lease_token,result:{ok:true}});
  const next=await q.claim({workerId:'second'});assert.equal(next.node_id,'validate');
  await q.complete({jobId:next.id,workerId:'second',leaseToken:next.lease_token,result:{ok:true}});
  assert.equal((await q.get(first.id,tenant)).status,'completed');
  const events=await q.claimOutbox({workerId:'notifier',limit:50});assert.ok(events.length>=4);
  await q.acknowledgeOutbox({workerId:'notifier',eventId:Number(events[0].id)});
  await assert.rejects(q.acknowledgeOutbox({workerId:'different',eventId:Number(events[1].id)}),e=>e.code==='stale_outbox');
  await assert.rejects(q.enqueue({...args,identityId:'00000000-0000-4000-8000-000000000001',idempotencyKey:'forbidden'}),e=>e.code==='forbidden');
 }finally{await pool.end()}
});
test('expired leases retry only before dispatch; post-dispatch requires reconciliation',{skip:!url},async()=>{
 const pool=new pg.Pool({connectionString:url,max:6}),q=new DurableJobQueue({pool});
 try{
  const tenant=(await pool.query("INSERT INTO tenants(name) VALUES('lease test') RETURNING id")).rows[0].id;
  const identity=(await pool.query("INSERT INTO identities(issuer,subject) VALUES('lease',gen_random_uuid()::text) RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO memberships(tenant_id,identity_id,role) VALUES($1,$2,'owner')",[tenant,identity]);
  const project=(await pool.query("INSERT INTO projects(tenant_id,owner_id,title,kind) VALUES($1,$2,'Lease Test','research') RETURNING id",[tenant,identity])).rows[0].id;
  await q.enqueue({tenantId:tenant,identityId:identity,projectId:project,idempotencyKey:'lease-one',recipe:recipe('lease')});
  const before=await q.claim({workerId:'lease-worker'});assert.ok(before);
  await pool.query("UPDATE workflow_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[before.id]);
  assert.deepEqual((await q.recoverExpired()).map(x=>x.state),['ready']);
  await assert.rejects(q.checkpoint({jobId:before.id,workerId:'lease-worker',leaseToken:before.lease_token,data:{cursor:1}}),e=>e.code==='stale_lease');
  const again=await q.claim({workerId:'lease-worker'});assert.equal(again.id,before.id);
  const dispatched=await q.markDispatchStarted({jobId:again.id,workerId:'lease-worker',leaseToken:again.lease_token,providerTaskId:'provider-task'});
  assert.equal(dispatched.state,'dispatched');assert.ok(dispatched.providerDispatchKey);
  await pool.query("UPDATE workflow_jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[before.id]);
  assert.deepEqual((await q.recoverExpired()).map(x=>x.state),['needs_reconciliation']);
  assert.equal(await q.claim({workerId:'another-worker'}),null);
  const row=(await pool.query('SELECT state FROM workflow_jobs WHERE id=$1',[before.id])).rows[0];
  assert.equal(row.state,'needs_reconciliation');
 }finally{await pool.end()}
});
test('generation cannot dispatch without authorizations and worker stays read-only',{skip:!url},async()=>{
 const pool=new pg.Pool({connectionString:url,max:6}),q=new DurableJobQueue({pool});
 try{
  const tenant=(await pool.query("INSERT INTO tenants(name) VALUES('blocked queue test') RETURNING id")).rows[0].id;
  const identity=(await pool.query("INSERT INTO identities(issuer,subject) VALUES('blocked',gen_random_uuid()::text) RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO memberships(tenant_id,identity_id,role) VALUES($1,$2,'owner')",[tenant,identity]);
  const project=(await pool.query("INSERT INTO projects(tenant_id,owner_id,title,kind) VALUES($1,$2,'Block Test','music') RETURNING id",[tenant,identity])).rows[0].id;
  const blocked=recipe('blocked');blocked.nodes[0].effects='generation';
  const run=await q.enqueue({tenantId:tenant,identityId:identity,projectId:project,idempotencyKey:'blocked-run',recipe:blocked});
  assert.equal(run.status,'blocked');
  assert.equal(await q.claim({workerId:'worker'}),null);
  assert.deepEqual(await processOne(q,{workerId:'worker',handlers:{'research.collect':()=>{throw Error('should not run')}}}),{status:'idle'});
 }finally{await pool.end()}
});
test('unconfigured worker is not advertised as billable generation',async()=>{
 const {workerStatus}=await import('../../apps/worker/src/worker.mjs');
 assert.equal(workerStatus().paidProviderDispatchEnabled,false);
});
