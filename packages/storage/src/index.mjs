import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {createConnection} from 'node:net';
import {withTenantScope} from '@superintelligence/permissions';
const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const acceptedMime=/^(text\/plain|text\/markdown|application\/json|application\/pdf|image\/(png|jpeg|webp|gif)|audio\/(mpeg|wav|ogg)|video\/mp4|application\/zip)$/;
function assertDetails({projectId,sha256,sizeBytes,mediaType}){
 if(!UUID.test(projectId||''))throw new TypeError('Project UUID required');
 if(!SHA.test(sha256||''))throw new TypeError('Expected lowercase SHA256 required');
 if(!Number.isSafeInteger(sizeBytes)||sizeBytes<=0||sizeBytes>1073741824)throw new TypeError('Upload must be 1 byte to 1 GiB');
 if(typeof mediaType!=='string'||!acceptedMime.test(mediaType))throw new TypeError('Unsupported media type');
}
export class AssetSecurityError extends Error{constructor(code){super(code);this.name='AssetSecurityError';this.code=code;}}
export class PrivateAssetService {
 constructor({pool,workerPool,objectStore,scanner,maxPresignSeconds=300}={}){
  if(!pool||!workerPool||!objectStore||!scanner)throw new TypeError('Database, isolated worker database, object storage and malware scanner required');
  this.pool=pool;this.workerPool=workerPool;this.objectStore=objectStore;this.scanner=scanner;
  this.maxPresignSeconds=Math.min(Math.max(maxPresignSeconds,1),300);
 }
 async startUpload({session,tenantId,projectId,sha256,sizeBytes,mediaType}){
  assertDetails({projectId,sha256,sizeBytes,mediaType});
  const id=randomUUID(),storageKey=tenantId+'/'+id;
  await withTenantScope({pool:this.pool,session,tenantId,requiredRole:'member'},async db=>{
   const project=await db.query('SELECT id FROM projects WHERE id=$1 AND tenant_id=$2',[projectId,tenantId]);
   if(!project.rows.length)throw new AssetSecurityError('project_not_authorized');
   await db.query('INSERT INTO asset_metadata(id,tenant_id,project_id,storage_key,media_type,sha256,size_bytes,scan_state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval \'1 day\')',[id,tenantId,projectId,storageKey,mediaType,sha256,sizeBytes,'quarantined']);
  });
  const upload=await this.objectStore.presignUpload({storageKey,sha256,sizeBytes,mediaType,expiresSeconds:this.maxPresignSeconds});
  return {assetId:id,upload,expiresSeconds:this.maxPresignSeconds,state:'quarantined'};
 }
 async authorizeAsset({session,tenantId,assetId}){
  return withTenantScope({pool:this.pool,session,tenantId,requiredRole:'member'},async db=>{
   const r=await db.query('SELECT id,tenant_id,project_id,storage_key,media_type,sha256,size_bytes,scan_state FROM asset_metadata WHERE tenant_id=$1 AND id=$2',[tenantId,assetId]);
   if(!r.rows.length)throw new AssetSecurityError('asset_not_authorized');return r.rows[0];
  });
 }
 async verifyUpload({session,tenantId,assetId}){
  const asset=await this.authorizeAsset({session,tenantId,assetId});
  // The worker role has limited access to this single transition; it is not a user-provided SQL principal.
  const claimed=await this.workerPool.query("UPDATE asset_metadata SET scan_state='scanning' WHERE tenant_id=$1 AND id=$2 AND scan_state='quarantined' RETURNING id",[tenantId,assetId]);
  if(!claimed.rows.length)throw new AssetSecurityError('asset_not_pending');
  try{
   const stream=await this.objectStore.readQuarantine(asset.storage_key);
   const result=await this.scanner.scan(stream);
   if(result.clean!==true)throw new AssetSecurityError('malware_detected_or_scanner_unavailable');
   if(result.sha256!==asset.sha256||BigInt(result.sizeBytes)!==BigInt(asset.size_bytes))throw new AssetSecurityError('content_integrity_mismatch');
   if(result.detectedType!==asset.media_type)throw new AssetSecurityError('mime_mismatch');
   await this.objectStore.promoteClean(asset.storage_key,asset.media_type);
   await this.workerPool.query("UPDATE asset_metadata SET scan_state='clean',verified_at=now(),expires_at=NULL WHERE tenant_id=$1 AND id=$2 AND scan_state='scanning'",[tenantId,assetId]);
   await this.objectStore.deleteQuarantine(asset.storage_key).catch(()=>{});
   return {assetId,state:'clean',sha256:asset.sha256};
  }catch(error){
   await this.workerPool.query("UPDATE asset_metadata SET scan_state='rejected',rejected_reason=$3 WHERE tenant_id=$1 AND id=$2 AND scan_state='scanning'",[tenantId,assetId,error instanceof AssetSecurityError?error.code:'verification_failed']);
   await this.objectStore.deleteQuarantine(asset.storage_key).catch(()=>{});
   throw error;
  }
 }
 async getDownload({session,tenantId,assetId}){
  const asset=await this.authorizeAsset({session,tenantId,assetId});
  if(asset.scan_state!=='clean')throw new AssetSecurityError('asset_not_scanned');
  const url=await this.objectStore.presignDownload({storageKey:asset.storage_key,expiresSeconds:this.maxPresignSeconds});
  return {url,expiresSeconds:this.maxPresignSeconds,mediaType:asset.media_type};
 }
 async deleteAsset({session,tenantId,assetId}){
  const asset=await this.authorizeAsset({session,tenantId,assetId});
  await this.workerPool.query("UPDATE asset_metadata SET scan_state='deleted',expires_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,assetId]);
  await Promise.allSettled([this.objectStore.deleteQuarantine(asset.storage_key),this.objectStore.deleteClean(asset.storage_key)]);
  return {assetId,state:'deleted'};
 }
}
