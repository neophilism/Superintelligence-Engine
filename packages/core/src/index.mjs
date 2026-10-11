export const ENGINE_VERSION = '0.1.0';
export const WORKSPACE_KINDS = Object.freeze(['code','music','poetry','persuasive-writing','research','legislation','image','video','voice','data','workflow']);
export function assertProject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Project must be an object');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.id)) throw new TypeError('Project id is invalid');
  if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 256) throw new TypeError('Project title is invalid');
  if (!WORKSPACE_KINDS.includes(input.kind)) throw new TypeError('Unsupported workspace kind');
  return Object.freeze({id:input.id,title:input.title.trim(),kind:input.kind});
}
export function createArtifact({id,projectId,mediaType,checksum,parents=[]}) {
  if (![id,projectId,mediaType,checksum].every(v=>typeof v==='string'&&v.length>0)) throw new TypeError('Artifact metadata missing');
  if (!Array.isArray(parents) || !parents.every(v=>typeof v==='string')) throw new TypeError('Invalid lineage');
  return Object.freeze({id,projectId,mediaType,checksum,parents:Object.freeze([...parents])});
}
export function validateWorkflow(nodes) {
  if (!Array.isArray(nodes)) throw new TypeError('nodes must be an array');
  const byId = new Map();
  for (const n of nodes) { if (!n||typeof n.id!=='string'||!n.id||byId.has(n.id)) throw new TypeError('Duplicate or invalid node id'); byId.set(n.id,n); }
  const state = new Map(), ordered = [];
  function visit(id) {
    const value=state.get(id);
    if(value===1) throw new Error('Workflow dependency cycle');
    if(value===2) return;
    const node=byId.get(id); if(!node) throw new Error('Unknown workflow dependency: '+id);
    state.set(id,1);
    if(!Array.isArray(node.dependsOn||[])) throw new TypeError('dependsOn must be an array');
    for(const dep of node.dependsOn||[]) visit(dep);
    state.set(id,2); ordered.push(node.id);
  }
  for(const id of byId.keys()) visit(id);
  return Object.freeze(ordered);
}
