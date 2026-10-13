import pg from 'pg';
import {brokerFromEnvironment} from '../../../packages/auth/src/index.mjs';
import {ProjectService,ProjectError} from '../../../packages/projects/src/index.mjs';
import {TenantPermissionError} from '../../../packages/permissions/src/index.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultAuth=brokerFromEnvironment();
const defaultPool=process.env.PROJECT_DATABASE_URL?new pg.Pool({connectionString:process.env.PROJECT_DATABASE_URL,max:8}):null;
const defaultProjects=defaultPool?new ProjectService({pool:defaultPool}):null;
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function parseBody(req){
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>524288)throw new ProjectError('request_too_large',413);chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new ProjectError('invalid_json',400)}
}
export function projectRoute(req,res,pathname,{auth=defaultAuth,projects=defaultProjects,authorizedOrigins=(process.env.AUTHORIZED_PRODUCT_ORIGINS||'').split(',').filter(Boolean)}={}){
 if(!/^\/v1\/projects(?:\/|$)/.test(pathname))return false;
 const routes=[
 {method:'GET',regex:/^\/v1\/projects$/,run:(c)=>projects.list(c)},
 {method:'POST',regex:/^\/v1\/projects$/,run:(c,b)=>projects.create(c,b),status:201},
 {method:'GET',regex:/^\/v1\/projects\/([0-9a-f-]{36})$/,run:(c,b,m)=>projects.get(c,m[1])},
 {method:'PATCH',regex:/^\/v1\/projects\/([0-9a-f-]{36})$/,run:(c,b,m)=>projects.update(c,m[1],b)},
 {method:'GET',regex:/^\/v1\/projects\/([0-9a-f-]{36})\/artifacts$/,run:(c,b,m)=>projects.listArtifacts(c,m[1])},
 {method:'POST',regex:/^\/v1\/projects\/([0-9a-f-]{36})\/artifacts$/,run:(c,b,m)=>projects.createArtifact(c,m[1],b),status:201},
 {method:'POST',regex:/^\/v1\/projects\/([0-9a-f-]{36})\/artifacts\/([0-9a-f-]{36})\/revisions$/,run:(c,b,m)=>projects.reviseArtifact(c,m[1],m[2],b),status:201},
 {method:'GET',regex:/^\/v1\/projects\/([0-9a-f-]{36})\/artifacts\/([0-9a-f-]{36})\/revisions$/,run:(c,b,m)=>projects.history(c,m[1],m[2])},
 {method:'POST',regex:/^\/v1\/projects\/([0-9a-f-]{36})\/artifacts\/([0-9a-f-]{36})\/restore$/,run:(c,b,m)=>projects.restore(c,m[1],m[2],b.targetRevision,b.expectedRevision),status:201},
 {method:'GET',regex:/^\/v1\/projects\/([0-9a-f-]{36})\/export$/,run:(c,b,m)=>projects.export(c,m[1])}
 ];
 const route=routes.find(x=>x.method===req.method&&x.regex.test(pathname));
 if(!route){send(res,404,{code:'not_found'});return true;}
 if(!auth||!projects){send(res,503,{code:'project_backend_unconfigured'});return true;}
 const product=req.headers['x-sie-product'],tenantId=req.headers['x-tenant-id'];
 if(!['academy','command'].includes(product)||typeof tenantId!=='string'||!UUID.test(tenantId)){send(res,401,{code:'identity_scope_required'});return true;}
 const isWrite=req.method!=='GET';
 if(isWrite){
  const origin=req.headers.origin;
  if(!origin||!authorizedOrigins.includes(origin)){send(res,403,{code:'origin_not_allowed'});return true;}
 }
 (async()=>{
   const session=await auth.session({product,cookieHeader:req.headers.cookie||''});
   if(!session)throw new ProjectError('authentication_required',401);
   const body=isWrite?await parseBody(req):undefined;
   const result=await route.run({tenantId,session},body,route.regex.exec(pathname));
   send(res,route.status||200,result);
 })().catch(err=>{
   const status=err instanceof ProjectError?err.status:err instanceof TenantPermissionError?403:500;
   send(res,status,{code:err instanceof ProjectError||err instanceof TenantPermissionError?err.code:'server_error'});
 });
 return true;
}
