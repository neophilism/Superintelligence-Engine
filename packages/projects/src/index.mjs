import {createHash} from 'node:crypto';
import {WORKSPACE_KINDS} from '@superintelligence/core';
import {withTenantScope} from '@superintelligence/permissions';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const secureId=x=>{if(typeof x!=='string'||!UUID.test(x))throw new ProjectError('invalid_id',400);return x;};
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
export class ProjectError extends Error{constructor(code,status=400){super(code);this.name='ProjectError';this.code=code;this.status=status;}}
function assertTitle(title){if(typeof title!=='string'||!title.trim()||title.length>256)throw new ProjectError('invalid_title');return title.trim();}
function serializeProject(row){return {id:row.id,title:row.title,kind:row.kind,revision:Number(row.current_revision)};}
function serializeArtifact(row){return {id:row.id,projectId:row.project_id,mediaType:row.media_type,checksum:row.sha256,revision:Number(row.current_revision||row.revision)};}
function verifyArtifact(input){
 if(!object(input)||!input.mediaType||typeof input.mediaType!=='string'||input.mediaType.length>160||!HASH.test(input.checksum||''))throw new ProjectError('invalid_artifact');
 if(input.body!==undefined && input.assetId!==undefined)throw new ProjectError('ambiguous_artifact_source');
 if(input.body===undefined && input.assetId===undefined)throw new ProjectError('artifact_content_required');
 if(input.body!==undefined){
  if(!object(input.body)&&!Array.isArray(input.body)&&typeof input.body!=='string')throw new ProjectError('invalid_structured_content');
  const json=JSON.stringify(input.body);
  if(Buffer.byteLength(json)>262144)throw new ProjectError('inline_content_too_large',413);
  if(createHash('sha256').update(json).digest('hex')!==input.checksum)throw new ProjectError('artifact_checksum_mismatch',422);
 }
 if(input.assetId!==undefined)secureId(input.assetId);
 if(input.rights!==undefined&&!object(input.rights))throw new ProjectError('invalid_rights');
 if(input.provenance!==undefined&&!object(input.provenance))throw new ProjectError('invalid_provenance');
 return {...input,rights:input.rights||{},provenance:input.provenance||{}};
}
export class ProjectService {
 constructor({pool}={}){if(!pool||typeof pool.connect!=='function')throw new TypeError('PostgreSQL pool required');this.pool=pool;}
 scope(context,role,fn){return withTenantScope({pool:this.pool,session:context.session,tenantId:context.tenantId,requiredRole:role},fn);}
 async list(context){return this.scope(context,'viewer',async db=>{const result=await db.query('SELECT id,title,kind,current_revision FROM projects WHERE tenant_id=$1 ORDER BY updated_at DESC,id LIMIT 200',[context.tenantId]);return {items:result.rows.map(serializeProject)};});}
 async get(context,projectId){secureId(projectId);return this.scope(context,'viewer',async db=>{const r=await db.query('SELECT id,title,kind,current_revision FROM projects WHERE tenant_id=$1 AND id=$2',[context.tenantId,projectId]);if(!r.rows.length)throw new ProjectError('project_not_found',404);return serializeProject(r.rows[0]);});}
 async create(context,{title,kind}={}){
  assertTitle(title);if(!WORKSPACE_KINDS.includes(kind))throw new ProjectError('unsupported_workspace_kind');
  return this.scope(context,'member',async db=>{
   const r=await db.query('INSERT INTO projects(tenant_id,owner_id,title,kind) VALUES($1,$2,$3,$4) RETURNING id,title,kind,current_revision',[context.tenantId,context.session.identityId,title.trim(),kind]);
   return serializeProject(r.rows[0]);
  });
 }
 async update(context,projectId,{title,kind,expectedRevision}={}){
  secureId(projectId);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new ProjectError('expected_revision_required');
  if(title===undefined&&kind===undefined)throw new ProjectError('project_update_required');
  const nextTitle=title===undefined?undefined:assertTitle(title);
  if(kind!==undefined&&!WORKSPACE_KINDS.includes(kind))throw new ProjectError('unsupported_workspace_kind');
  return this.scope(context,'member',async db=>{
   const selected=await db.query('SELECT title,kind,current_revision FROM projects WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[context.tenantId,projectId]);
   if(!selected.rows.length)throw new ProjectError('project_not_found',404);
   if(Number(selected.rows[0].current_revision)!==expectedRevision)throw new ProjectError('revision_conflict',409);
   const r=await db.query('UPDATE projects SET title=$3,kind=$4,current_revision=current_revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id,title,kind,current_revision',[context.tenantId,projectId,nextTitle??selected.rows[0].title,kind??selected.rows[0].kind]);
   return serializeProject(r.rows[0]);
  });
 }
 async listArtifacts(context,projectId){secureId(projectId);return this.scope(context,'viewer',async db=>{
  const project=await db.query('SELECT id FROM projects WHERE tenant_id=$1 AND id=$2',[context.tenantId,projectId]);
  if(!project.rows.length)throw new ProjectError('project_not_found',404);
  const r=await db.query('SELECT a.id,a.project_id,a.current_revision,v.media_type,v.sha256 FROM project_artifacts a JOIN artifact_revisions v ON v.tenant_id=a.tenant_id AND v.artifact_id=a.id AND v.revision=a.current_revision WHERE a.tenant_id=$1 AND a.project_id=$2 ORDER BY a.created_at,a.id',[context.tenantId,projectId]);
  return {items:r.rows.map(serializeArtifact)};
 });}
 async createArtifact(context,projectId,data){secureId(projectId);const item=verifyArtifact(data);return this.scope(context,'member',async db=>{
  const project=await db.query('SELECT id FROM projects WHERE id=$1 AND tenant_id=$2',[projectId,context.tenantId]);
  if(!project.rows.length)throw new ProjectError('project_not_found',404);
  if(item.assetId!==undefined){
   const asset=await db.query("SELECT sha256,media_type FROM asset_metadata WHERE tenant_id=$1 AND id=$2 AND scan_state='clean' AND project_id=$3",[context.tenantId,item.assetId,projectId]);
   if(!asset.rows.length||asset.rows[0].sha256!==item.checksum||asset.rows[0].media_type!==item.mediaType)throw new ProjectError('asset_unverified_or_wrong_project',422);
  }
  const art=await db.query('INSERT INTO project_artifacts(tenant_id,project_id,title) VALUES($1,$2,$3) RETURNING id,current_revision',[context.tenantId,projectId,item.title?assertTitle(item.title):item.mediaType]);
  await db.query('INSERT INTO artifact_revisions(tenant_id,artifact_id,revision,media_type,sha256,body,asset_id,rights,provenance,created_by) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9)',[context.tenantId,art.rows[0].id,item.mediaType,item.checksum,item.body===undefined?null:JSON.stringify(item.body),item.assetId||null,JSON.stringify(item.rights),JSON.stringify(item.provenance),context.session.identityId]);
  return {id:art.rows[0].id,projectId,mediaType:item.mediaType,checksum:item.checksum,revision:1};
 });}
 async reviseArtifact(context,projectId,artifactId,{expectedRevision,...data}){
  secureId(projectId);secureId(artifactId);if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)throw new ProjectError('expected_revision_required');const item=verifyArtifact(data);
  return this.scope(context,'member',async db=>{
   const selected=await db.query('SELECT current_revision FROM project_artifacts WHERE tenant_id=$1 AND project_id=$2 AND id=$3 FOR UPDATE',[context.tenantId,projectId,artifactId]);
   if(!selected.rows.length)throw new ProjectError('artifact_not_found',404);
   if(Number(selected.rows[0].current_revision)!==expectedRevision)throw new ProjectError('revision_conflict',409);
   if(item.assetId!==undefined){
    const a=await db.query("SELECT sha256,media_type FROM asset_metadata WHERE tenant_id=$1 AND id=$2 AND scan_state='clean' AND project_id=$3",[context.tenantId,item.assetId,projectId]);
    if(!a.rows.length||a.rows[0].sha256!==item.checksum||a.rows[0].media_type!==item.mediaType)throw new ProjectError('asset_unverified_or_wrong_project',422);
   }
   const updated=await db.query('UPDATE project_artifacts SET current_revision=current_revision+1,updated_at=now() WHERE id=$1 RETURNING current_revision',[artifactId]);
   const revision=Number(updated.rows[0].current_revision);
   await db.query('INSERT INTO artifact_revisions(tenant_id,artifact_id,revision,media_type,sha256,body,asset_id,rights,provenance,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[context.tenantId,artifactId,revision,item.mediaType,item.checksum,item.body===undefined?null:JSON.stringify(item.body),item.assetId||null,JSON.stringify(item.rights),JSON.stringify(item.provenance),context.session.identityId]);
   return {id:artifactId,projectId,mediaType:item.mediaType,checksum:item.checksum,revision};
  });
 }
 async history(context,projectId,artifactId){secureId(projectId);secureId(artifactId);return this.scope(context,'viewer',async db=>{
   const a=await db.query('SELECT id FROM project_artifacts WHERE id=$1 AND project_id=$2 AND tenant_id=$3',[artifactId,projectId,context.tenantId]);if(!a.rows.length)throw new ProjectError('artifact_not_found',404);
   const q=await db.query('SELECT revision,media_type,sha256,body,asset_id,rights,provenance,created_by,created_at FROM artifact_revisions WHERE tenant_id=$1 AND artifact_id=$2 ORDER BY revision',[context.tenantId,artifactId]);
   return {items:q.rows.map(x=>({revision:Number(x.revision),mediaType:x.media_type,checksum:x.sha256,body:x.body,assetId:x.asset_id,rights:x.rights,provenance:x.provenance,createdBy:x.created_by,createdAt:x.created_at}))};
 });}
 async restore(context,projectId,artifactId,targetRevision,expectedRevision){
  if(!Number.isSafeInteger(targetRevision)||targetRevision<1)throw new ProjectError('invalid_target_revision');
  const history=await this.history(context,projectId,artifactId),record=history.items.find(x=>x.revision===targetRevision);
  if(!record)throw new ProjectError('version_not_found',404);
  return this.reviseArtifact(context,projectId,artifactId,{expectedRevision,mediaType:record.mediaType,checksum:record.checksum,...(record.assetId?{assetId:record.assetId}:{body:record.body}),rights:record.rights,provenance:{...record.provenance,restoredFromRevision:targetRevision}});
 }
 async export(context,projectId){
  const project=await this.get(context,projectId);const artifacts=await this.listArtifacts(context,projectId);const records=[];
  for(const a of artifacts.items)records.push({...a,revisions:(await this.history(context,projectId,a.id)).items});
  const manifest={schemaVersion:1,project,artifacts:records,exportedAt:new Date().toISOString(),binaryAssetsEmbedded:false};
  const sha256=createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return {...manifest,sha256};
 }
}
