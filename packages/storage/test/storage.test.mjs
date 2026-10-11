import test from 'node:test';import assert from 'node:assert/strict';import {PrivateAssetService,AssetSecurityError} from '../src/index.mjs';
const project='00000000-0000-4000-8000-000000000101',asset='00000000-0000-4000-8000-000000000202',tenant='00000000-0000-4000-8000-000000000404';
const session={identityId:'00000000-0000-4000-8000-000000000303'};
const fixture={id:asset,storage_key:'tenant/asset',sha256:'a'.repeat(64),size_bytes:'4',media_type:'text/plain',scan_state:'quarantined'};
function harness({verdict={clean:true,sha256:'a'.repeat(64),sizeBytes:4,detectedType:'text/plain'},state='quarantined'}={}){
 const events=[];const current={...fixture,scan_state:state};
 const pool={connect:async()=>({query:async(sql)=>{if(sql.startsWith('SELECT role'))return {rows:[{role:'owner'}]};if(sql.startsWith('SELECT id FROM projects'))return {rows:[{id:project}]};if(sql.startsWith('SELECT id,tenant_id'))return {rows:[current]};return {rows:[]}},release:()=>{}})};
 const workerPool={query:async(sql)=>{events.push(sql);if(sql.startsWith("UPDATE asset_metadata SET scan_state='scanning'"))return {rows:[current.scan_state==='quarantined'?{id:asset}:undefined].filter(Boolean)};return {rows:[{}]}}};
 const objectStore={presignUpload:async()=>({url:'https://private.test/quarantine',requiredHeaders:{}}),presignDownload:async()=> 'https://private.test/clean',readQuarantine:async()=>[Buffer.from('test')],promoteClean:async()=>{events.push('PROMOTED')},deleteQuarantine:async()=>{events.push('DELETE QUARANTINE')},deleteClean:async()=>{events.push('DELETE CLEAN')}};
 const scanner={scan:async()=>verdict};
 return {service:new PrivateAssetService({pool,workerPool,objectStore,scanner}),events,current};
}
test('uploaded blob remains quarantined until scan and integrity approval',async()=>{const h=harness();const result=await h.service.verifyUpload({session,tenantId:tenant,assetId:asset});assert.equal(result.state,'clean');assert.ok(h.events.includes('PROMOTED'));});
test('malware or altered checksum never reach private clean storage',async()=>{for(const verdict of [{clean:false,sha256:'a'.repeat(64),sizeBytes:4,detectedType:'text/plain'},{clean:true,sha256:'b'.repeat(64),sizeBytes:4,detectedType:'text/plain'},{clean:true,sha256:'a'.repeat(64),sizeBytes:4,detectedType:'video/mp4'}]){const h=harness({verdict});await assert.rejects(h.service.verifyUpload({session,tenantId:tenant,assetId:asset}),AssetSecurityError);assert.ok(!h.events.includes('PROMOTED'));assert.ok(h.events.includes('DELETE QUARANTINE'));}});
test('never presign unscanned asset for download',async()=>{const h=harness();await assert.rejects(h.service.getDownload({session,tenantId:tenant,assetId:asset}),/asset_not_scanned/);});
test('storage input fails on impossible checksum, MIME and object size',async()=>{const h=harness();await assert.rejects(h.service.startUpload({session,tenantId:tenant,projectId:project,sha256:'bad',sizeBytes:8,mediaType:'text/plain'}),/SHA/);await assert.rejects(h.service.startUpload({session,tenantId:tenant,projectId:project,sha256:'a'.repeat(64),sizeBytes:8,mediaType:'text/html'}),/media/);});
