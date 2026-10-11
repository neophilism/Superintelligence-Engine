import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {withTenantScope,TenantPermissionError} from '../../packages/permissions/src/index.mjs';
const url=process.env.TEST_DATABASE_URL;
test('forced RLS denies foreign tenant, revoked membership, viewer writes and anonymous query', {skip:!url?'requires disposable database':false},async()=>{
 const superuser=new pg.Client({connectionString:url});await superuser.connect();
 const tenant1=(await superuser.query("INSERT INTO tenants(name) VALUES('tenant1') RETURNING id")).rows[0].id;
 const tenant2=(await superuser.query("INSERT INTO tenants(name) VALUES('tenant2') RETURNING id")).rows[0].id;
 const id1=(await superuser.query("INSERT INTO identities(issuer,subject) VALUES('test',gen_random_uuid()::text) RETURNING id")).rows[0].id;
 const id2=(await superuser.query("INSERT INTO identities(issuer,subject) VALUES('test',gen_random_uuid()::text) RETURNING id")).rows[0].id;
 await superuser.query("INSERT INTO memberships(tenant_id,identity_id,role) VALUES($1,$2,'owner'),($3,$4,'viewer')",[tenant1,id1,tenant2,id2]);
 await superuser.query("INSERT INTO projects(tenant_id,owner_id,title,kind) VALUES($1,$2,'private','code'),($3,$4,'foreign','music')",[tenant1,id1,tenant2,id2]);
 // This role is a real non-owner database principal without BYPASSRLS.
 await superuser.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='sie_rls_tester') THEN CREATE ROLE sie_rls_tester NOLOGIN; END IF; END $$");
 await superuser.query('GRANT USAGE ON SCHEMA public,sie TO sie_rls_tester');
 await superuser.query('GRANT SELECT ON tenants,identities,memberships,projects,asset_metadata,budget_accounts TO sie_rls_tester');
 await superuser.query('GRANT INSERT(title,kind,tenant_id,owner_id) ON projects TO sie_rls_tester');
 await superuser.query('GRANT UPDATE(title,updated_at) ON projects TO sie_rls_tester');
 const client=new pg.Client({connectionString:url});await client.connect();
 async function queryAs(identity,tenant,sql){
  await client.query('BEGIN');
  try{await client.query('SET LOCAL ROLE sie_rls_tester');if(identity)await client.query("SELECT set_config('sie.identity_id',$1,true)",[identity]);if(tenant)await client.query("SELECT set_config('sie.tenant_id',$1,true)",[tenant]);return (await client.query(sql)).rows;}
  finally{await client.query('ROLLBACK');}
 }
 try{
  assert.equal((await queryAs(id1,tenant1,'SELECT title FROM projects')).length,1);
  assert.equal((await queryAs(id1,tenant2,'SELECT title FROM projects')).length,0);
  assert.equal((await queryAs(null,null,'SELECT title FROM projects')).length,0);
  assert.equal((await queryAs(id2,tenant2,'SELECT title FROM projects')).length,1);
  // Viewer role cannot update project fields despite SELECT authorization.
  await client.query('BEGIN');try{
   await client.query('SET LOCAL ROLE sie_rls_tester');
   await client.query("SELECT set_config('sie.identity_id',$1,true),set_config('sie.tenant_id',$2,true)",[id2,tenant2]);
   const changed=await client.query("UPDATE projects SET title='forbidden' WHERE tenant_id=$1 RETURNING id",[tenant2]);assert.equal(changed.rowCount,0);
  }finally{await client.query('ROLLBACK');}
  // Revocation takes effect on the next statement without a refresh cache.
  await superuser.query('DELETE FROM memberships WHERE tenant_id=$1 AND identity_id=$2',[tenant1,id1]);
  assert.equal((await queryAs(id1,tenant1,'SELECT title FROM projects')).length,0);
 }finally{await client.end();await superuser.end();}
});
test('scope gateway never accepts unauthenticated input or fabricated role',async()=>{await assert.rejects(withTenantScope({pool:{connect:()=>{}},session:{},tenantId:'bad'},async()=>{}),TenantPermissionError);});
