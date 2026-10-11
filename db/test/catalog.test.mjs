import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {CapabilityCatalog} from '../../packages/catalog/src/index.mjs';import {makeServer} from '../../apps/api/src/server.mjs';
const url=process.env.TEST_DATABASE_URL;
test('Postgres model record remains unapproved and API reports truthful status', {skip:!url?'requires TEST_DATABASE_URL':false},async()=>{
const client=new pg.Client({connectionString:url});await client.connect();try{
 const r=await client.query("INSERT INTO provider_models(provider,model,revision,operations,modalities,regions,license_scope,price_status,price_microunits,health_status,health_observed_at,adapter_configured,enabled) VALUES('fixture','qa','r1',ARRAY['text.reason'],ARRAY['text'],ARRAY['us'],'commercial','known',100,'healthy',now(),false,true) RETURNING id");
 const catalog=new CapabilityCatalog({db:client});
 const server=makeServer({catalog});await new Promise(ok=>server.listen(0,'127.0.0.1',ok));try{
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/models?capability=text.reason&region=us');
  assert.equal(response.status,200);const data=await response.json();
  const model=data.items.find(x=>x.id===r.rows[0].id);assert.ok(model);assert.equal(model.available,false);assert.ok(model.reasons.includes('provider_not_configured'));
 }finally{await new Promise(ok=>server.close(ok));}
}finally{await client.end();}
});
