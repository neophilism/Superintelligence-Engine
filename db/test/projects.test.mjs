import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import pg from 'pg';
import {ProjectService,ProjectError} from '../../packages/projects/src/index.mjs';
const url=process.env.TEST_DATABASE_URL;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('durable project and artifact version graph supports create, revise, conflict, restore and export', {skip:!url?'requires PostgreSQL':false},async()=>{
 const pool=new pg.Pool({connectionString:url,max:8});
 const id=(await pool.query("INSERT INTO identities(issuer,subject) VALUES('test',gen_random_uuid()::text) RETURNING id")).rows[0].id;
 const tenantId=(await pool.query("INSERT INTO tenants(name) VALUES('version project') RETURNING id")).rows[0].id;
 await pool.query("INSERT INTO memberships(tenant_id,identity_id,role) VALUES($1,$2,'owner')",[tenantId,id]);
 const context={session:{identityId:id},tenantId},service=new ProjectService({pool});
 try{
  const project=await service.create(context,{title:'Film pitch',kind:'video'});
  assert.equal(project.revision,1);assert.equal((await service.list(context)).items.some(x=>x.id===project.id),true);
  const renamed=await service.update(context,project.id,{title:'Film pitch revised',expectedRevision:1});
  assert.deepEqual(renamed,{...project,title:'Film pitch revised',revision:2});
  await assert.rejects(service.update(context,project.id,{title:'Stale overwrite',expectedRevision:1}),e=>e.code==='revision_conflict'&&e.status===409);
  assert.equal((await service.get(context,project.id)).title,'Film pitch revised');
  const first={scene:'opening',length:30},second={scene:'revised',length:15};
  const artifact=await service.createArtifact(context,project.id,{title:'Storyboard',mediaType:'application/json',checksum:sha(first),body:first,rights:{commercial:true},provenance:{source:'editor'}});
  assert.equal(artifact.revision,1);
  const revised=await service.reviseArtifact(context,project.id,artifact.id,{expectedRevision:1,mediaType:'application/json',checksum:sha(second),body:second});
  assert.equal(revised.revision,2);
  await assert.rejects(service.reviseArtifact(context,project.id,artifact.id,{expectedRevision:1,mediaType:'application/json',checksum:sha(second),body:second}),e=>e.code==='revision_conflict');
  const restored=await service.restore(context,project.id,artifact.id,1,2);assert.equal(restored.revision,3);
  const history=await service.history(context,project.id,artifact.id);assert.deepEqual(history.items.map(x=>x.revision),[1,2,3]);assert.deepEqual(history.items[0].body,first);assert.deepEqual(history.items[2].body,first);
  const manifest=await service.export(context,project.id);assert.equal(manifest.artifacts.length,1);assert.equal(manifest.artifacts[0].revisions.length,3);assert.match(manifest.sha256,/^[a-f0-9]{64}$/);
  const foreign=(await pool.query("INSERT INTO tenants(name) VALUES('another tenant') RETURNING id")).rows[0].id;
  await assert.rejects(service.get({session:{identityId:id},tenantId:foreign},project.id),/membership/);
 }finally{await pool.end();}
});
test('checksum mismatch and unsupported workspace kind fail without writing',async()=>{
 const service=new ProjectService({pool:{connect:()=>{throw new Error('Should not reach DB')}}});
 await assert.rejects(service.create({}, {title:'Invalid',kind:'nonsense'}),/unsupported/);
 await assert.rejects(service.createArtifact({},'00000000-0000-4000-8000-000000000000',{mediaType:'application/json',checksum:'a'.repeat(64),body:{a:1}}),/checksum/);
});
