"use client";
import React,{useEffect,useMemo,useRef,useState} from 'react';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTS=new Set(['academy','command']);
function assertUUID(value,label){
 if(typeof value!=='string'||!UUID.test(value))throw new TypeError('Invalid '+label);
 return value;
}
function origin(value){
 if(typeof value!=='string'||!value)throw new TypeError('Engine origin must be explicitly configured');
 const url=new URL(value);
 if(url.origin!==value||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new TypeError('Engine API must be a trusted origin, not a URL path');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new TypeError('HTTPS engine origin required');
 return url.origin;
}
export class ProjectPortalError extends Error {
 constructor(code,status=0){super(code);this.name='ProjectPortalError';this.code=code;this.status=status}
}
export function parseProjectTransfer(url){
 try{
  const u=new URL(url),tenantId=u.searchParams.get('tenant'),projectId=u.searchParams.get('project');
  if(!UUID.test(tenantId||'')||!UUID.test(projectId||''))return null;
  return {tenantId,projectId};
 }catch{return null}
}
export function buildProjectTransfer(base,tenantId,projectId){
 assertUUID(tenantId,'tenantId');assertUUID(projectId,'projectId');
 const target=origin(base),u=new URL(target);
 u.searchParams.set('tenant',tenantId);u.searchParams.set('project',projectId);
 return u.href;
}
export class ProjectPortalClient{
 constructor({engineOrigin,product,fetchImpl=fetch}={}){
  this.origin=origin(engineOrigin);
  if(!PRODUCTS.has(product))throw new TypeError('Unknown product mode');
  if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl required');
  this.product=product;this.fetchImpl=fetchImpl;
 }
 async request(path,{method='GET',tenantId,body,signal}={}){
  if(tenantId!==undefined)assertUUID(tenantId,'tenantId');
  if(!/^\/[a-z0-9/_-]+$/.test(path))throw new TypeError('Unsafe engine API path');
  const url=new URL(path,this.origin);
  let response;
  try{response=await this.fetchImpl(url,{
   method,credentials:'include',cache:'no-store',redirect:'error',
   headers:{'Accept':'application/json','X-SIE-Product':this.product,
    ...(tenantId?{'X-Tenant-Id':tenantId}:{}),
    ...(body!==undefined?{'Content-Type':'application/json'}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),signal
  })}catch(error){throw new ProjectPortalError('engine_unreachable')}
  if(!response.ok){
   let code='engine_error';
   try{const payload=await response.json();if(typeof payload?.code==='string')code=payload.code}catch{}
   throw new ProjectPortalError(code,response.status);
  }
  return response.status===204?null:response.json();
 }
 signInUrl(){return new URL('/auth/'+this.product+'/start',this.origin).href}
 session(){return this.request('/auth/'+this.product+'/session')}
 tenants(){return this.request('/v1/tenants')}
 projects(tenantId){return this.request('/v1/projects',{tenantId})}
 createProject(tenantId,{title,kind}){return this.request('/v1/projects',{tenantId,method:'POST',body:{title,kind}})}
 artifacts(tenantId,projectId){return this.request('/v1/projects/'+assertUUID(projectId,'projectId')+'/artifacts',{tenantId})}
 revisions(tenantId,projectId,artifactId){return this.request('/v1/projects/'+assertUUID(projectId,'projectId')+'/artifacts/'+assertUUID(artifactId,'artifactId')+'/revisions',{tenantId})}
 logout(){return this.request('/auth/'+this.product+'/logout',{method:'POST'})}
}
function recoverIncoming(){
 if(typeof window==='undefined')return null;
 const incoming=parseProjectTransfer(window.location.href);
 if(incoming){try{sessionStorage.setItem('sie.pending-project',JSON.stringify(incoming))}catch{};return incoming}
 try{
  const raw=JSON.parse(sessionStorage.getItem('sie.pending-project')||'null');
  if(raw&&UUID.test(raw.tenantId||'')&&UUID.test(raw.projectId||''))return raw;
 }catch{}
 return null;
}
export function ProjectPortal({product='command',engineOrigin='',companionOrigin='',domain='research',onOpenProject}){
 const client=useMemo(()=>{try{return new ProjectPortalClient({engineOrigin,product})}catch{return null}},[engineOrigin,product]);
 const desired=useRef(null);
 const [status,setStatus]=useState(client?'checking':'unconfigured');
 const [tenants,setTenants]=useState([]);
 const [tenant,setTenant]=useState('');
 const [projects,setProjects]=useState([]);
 const [project,setProject]=useState('');
 const [artifacts,setArtifacts]=useState([]);
 const [chosenArtifact,setChosenArtifact]=useState('');
 const [versions,setVersions]=useState([]);
 const [title,setTitle]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(!client){setStatus('unconfigured');return}
  let live=true;desired.current=recoverIncoming();
  setStatus('checking');setError('');setTenants([]);
  (async()=>{
   try{
    await client.session();
    const owned=await client.tenants();
    if(!live)return;
    const items=Array.isArray(owned.items)?owned.items:[];
    setTenants(items);setStatus('signed-in');
    const wanted=desired.current?.tenantId;
    setTenant(items.some(x=>x.id===wanted)?wanted:items[0]?.id||'');
   }catch(err){if(live)setStatus(err.status===401?'signed-out':'unavailable')}
  })();
  return()=>{live=false};
 },[client]);
 useEffect(()=>{
  if(!client||!tenant){setProjects([]);setProject('');return}
  let live=true;setError('');
  client.projects(tenant).then(x=>{
   if(!live)return;
   const items=Array.isArray(x.items)?x.items:[];
   setProjects(items);
   const wanted=desired.current?.tenantId===tenant?desired.current?.projectId:'';
   setProject(items.some(y=>y.id===wanted)?wanted:'');
  }).catch(err=>{if(live){setProjects([]);setProject('');setError('Could not load projects: '+err.code)}});
  return()=>{live=false};
 },[client,tenant]);
 useEffect(()=>{
  if(!client||!tenant||!project){setArtifacts([]);return}
  let live=true;setChosenArtifact('');setVersions([]);
  client.artifacts(tenant,project).then(x=>{if(live)setArtifacts(Array.isArray(x.items)?x.items:[])})
  .catch(err=>{if(live){setArtifacts([]);setError('Could not load artifacts: '+err.code)}});
  return()=>{live=false};
 },[client,tenant,project]);
 useEffect(()=>{
  if(!client||!chosenArtifact||!project)return;
  let live=true;
  client.revisions(tenant,project,chosenArtifact).then(x=>{if(live)setVersions(Array.isArray(x.items)?x.items:[])})
   .catch(err=>{if(live){setVersions([]);setError('Could not load history: '+err.code)}});
  return()=>{live=false};
 },[client,tenant,project,chosenArtifact]);
 function chooseProject(p){
  setProject(p.id);onOpenProject?.(p);
  if(typeof window!=='undefined'){
   const current=new URL(window.location.href);
   current.searchParams.set('tenant',tenant);current.searchParams.set('project',p.id);
   window.history.replaceState({},'',current.href);
   try{sessionStorage.setItem('sie.pending-project',JSON.stringify({tenantId:tenant,projectId:p.id}))}catch{}
  }
 }
 async function create(event){
  event.preventDefault();if(!client||!tenant||!title.trim()||busy)return;
  setBusy(true);setError('');
  try{
   const result=await client.createProject(tenant,{title:title.trim(),kind:domain});
   setProjects(prev=>[result,...prev.filter(x=>x.id!==result.id)]);
   setTitle('');chooseProject(result);
  }catch(err){setError('Project creation failed: '+(err.code||'unavailable'))}
  finally{setBusy(false)}
 }
 async function signOut(){
  if(!client)return;
  try{await client.logout();setStatus('signed-out');setTenants([]);setProjects([]);setProject('')}
  catch(err){setError('Sign out failed: '+(err.code||'unavailable'))}
 }
 const current=projects.find(x=>x.id===project);
 let transfer=null;
 if(companionOrigin&&tenant&&project)try{transfer=buildProjectTransfer(companionOrigin,tenant,project)}catch{}
 const h=React.createElement;
 const sections=[
  h('div',{key:'bar',className:'sie-project-bar'},
    h('h2',null,'Your projects'),
    h('span',{role:'status','aria-live':'polite'},'Session: '+status))
 ];
 if(status==='unconfigured')sections.push(h('p',{key:'unconfigured'},'Shared project storage is not configured. Drafting remains local to this browser session.'));
 if(status==='checking')sections.push(h('p',{key:'checking'},'Checking your secure project session…'));
 if(status==='unavailable')sections.push(h('p',{key:'unavailable'},'Project service is not reachable or has not been provisioned. No changes were made.'));
 if(status==='signed-out'&&client)sections.push(h('a',{key:'login',href:client.signInUrl()},'Sign in to your shared projects'));
 if(status==='signed-in'){
  sections.push(h('div',{key:'org',className:'sie-project-controls'},
   h('label',null,'Organization',h('select',{value:tenant,onChange:e=>{setTenant(e.target.value);setProject('');setChosenArtifact('')}},
    ...tenants.map(x=>h('option',{key:x.id,value:x.id},x.name+' · '+x.role)))),
   h('button',{type:'button',onClick:signOut},'Sign out')));
  if(!tenants.length)sections.push(h('p',{key:'no-membership'},'Your account has no project organizations. An administrator must grant membership.'));
  if(tenant){
   sections.push(h('form',{key:'create',className:'sie-project-create',onSubmit:create},
    h('label',null,'New project title',h('input',{value:title,maxLength:256,onChange:e=>setTitle(e.target.value),placeholder:'Project title',required:true})),
    h('button',{type:'submit',disabled:busy||!title.trim()},busy?'Saving…':'Create '+domain+' project')));
   const listChildren=[
    h('h3',{key:'title'},'Projects'),
    ...(!projects.length?[h('p',{key:'empty'},'No projects yet in this organization.')]:[]),
    ...projects.map(p=>h('button',{type:'button',key:p.id,'aria-current':p.id===project?'true':undefined,
      onClick:()=>chooseProject(p)},p.title+' · '+p.kind+' · revision '+p.revision))
   ];
   const contents=[h('div',{className:'sie-project-list',key:'list'},...listChildren)];
   if(current){
    const detail=[
     h('h3',{key:'name'},current.title),
     h('p',{key:'id'},'Canonical project ID: '+current.id),
     ...(transfer?[h('a',{key:'transfer',href:transfer},product==='academy'?'Continue in Command Center':'Open in Academy')]:[]),
     h('h4',{key:'artifacts'},'Artifacts'),
     ...(!artifacts.length?[h('p',{key:'empty'},'No saved artifacts yet.')]:[]),
     ...artifacts.map(a=>h('button',{key:a.id,type:'button',onClick:()=>{setChosenArtifact(a.id);setVersions([])}},
      a.mediaType+' · revision '+a.revision+' · '+a.id))
    ];
    if(chosenArtifact){
     detail.push(h('div',{key:'history',className:'sie-project-history'},
      h('h4',null,'Immutable history'),
      ...versions.map(v=>h('p',{key:v.revision},'Revision '+v.revision+' · '+v.mediaType+' · '+v.checksum)),
      ...(!versions.length?[h('p',{key:'empty'},'No revision records loaded.')]:[])));
    }
    contents.push(h('section',{key:'detail',className:'sie-project-details','aria-label':'Selected project'},...detail));
   }
   sections.push(h('div',{key:'contents',className:'sie-project-contents'},...contents));
  }
 }
 if(error)sections.push(h('p',{key:'error',className:'sie-project-error',role:'alert'},error));
 return h('section',{className:'sie-project-portal','data-product':product,'aria-label':'Shared AI project library'},...sections);
}
