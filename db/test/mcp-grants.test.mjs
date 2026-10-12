import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';
import {McpGrantStore} from '../../packages/mcp/src/index.mjs';
const url=process.env.TEST_DATABASE_URL;
test('PostgreSQL MCP consent: scoped, renewable, revocable and audited without raw secrets',{skip:!url},async()=>{
 const pool=new pg.Pool({connectionString:url,max:6});const store=new McpGrantStore({pool});
 try{
  const tenant=(await pool.query("INSERT INTO tenants(name) VALUES('mcp tenant') RETURNING id")).rows[0].id;
  const identity=(await pool.query("INSERT INTO identities(issuer,subject) VALUES('mcp',gen_random_uuid()::text) RETURNING id")).rows[0].id;
  await pool.query("INSERT INTO memberships(tenant_id,identity_id,role) VALUES($1,$2,'member')",[tenant,identity]);
  const principal={tenantId:tenant,identityId:identity},scope='tool:search';
  await assert.rejects(store.grant({principal,connectionId:'trusted-docs',scope,approvedByUser:false,expiresAt:new Date(Date.now()+100000)}),e=>e.code==='consent_required');
  const grantId=await store.grant({principal,connectionId:'trusted-docs',scope,approvedByUser:true,expiresAt:new Date(Date.now()+100000)});
  assert.equal(await store.authorize({principal,connectionId:'trusted-docs',scope}),true);
  await assert.rejects(store.authorize({principal,connectionId:'trusted-docs',scope:'tool:transfer'}),e=>e.code==='grant_denied');
  const first=await store.audit({principal,connectionId:'trusted-docs',scope,decision:'allowed',inputSha256:'1'.repeat(64),outputSha256:'2'.repeat(64)});
  const second=await store.audit({principal,connectionId:'trusted-docs',scope,decision:'denied',inputSha256:'3'.repeat(64)});
  assert.notEqual(first,second);
  const rows=(await pool.query('SELECT previous_sha256,event_sha256 FROM mcp_tool_audit WHERE tenant_id=$1 ORDER BY id',[tenant])).rows;
  assert.equal(rows[0].previous_sha256,'0'.repeat(64));assert.equal(rows[1].previous_sha256,first);
  assert.equal(await store.revoke({principal,grantId}),true);
  await assert.rejects(store.authorize({principal,connectionId:'trusted-docs',scope}),e=>e.code==='grant_denied');
 }finally{await pool.end()}
});
