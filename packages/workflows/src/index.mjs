import {validateWorkflow} from '../../core/src/index.mjs';

const IDENTIFIER=/^[a-z][a-z0-9_-]{0,63}$/;
const OPERATION=/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
const MIME=/^[a-z][a-z0-9.+-]*\/[a-z0-9.+-]+$/;
const CONSEQUENT=/^(publish|deploy|send|purchase|delete|transfer|release)\./;
export class WorkflowValidationError extends Error {
  constructor(message){super(message);this.name='WorkflowValidationError';this.code='invalid_workflow';}
}
function fail(message){throw new WorkflowValidationError(message)}
function object(x,label){if(!x||typeof x!=='object'||Array.isArray(x))fail(label+' must be an object');return x}
function identifier(value,label){if(typeof value!=='string'||!IDENTIFIER.test(value))fail(label+' must be a stable identifier');return value}
function cost(value,label){if(!Number.isSafeInteger(value)||value<0)fail(label+' must be a nonnegative integer in microcredits');return value}
function mime(value,label){if(typeof value!=='string'||!MIME.test(value))fail(label+' must be a MIME type');return value}
function fields(x,allowed,label){for(const key of Object.keys(x)){if(!allowed.includes(key))fail(label+' contains unsupported field '+key)}}
function portMap(x,label){object(x,label);const entries=Object.entries(x);if(!entries.length)fail(label+' must have at least one output');for(const [port,type] of entries){identifier(port,label+' port');mime(type,label+'.'+port)}return x}
function readInput(value,label){
  object(value,label);fields(value,['from','literal','mimeType'],label);mime(value.mimeType,label+'.mimeType');
  const linked=Object.hasOwn(value,'from'),constant=Object.hasOwn(value,'literal');
  if(linked===constant)fail(label+' must specify exactly one of from and literal');
  if(linked){object(value.from,label+'.from');fields(value.from,['node','port'],label+'.from');identifier(value.from.node,label+'.from.node');identifier(value.from.port,label+'.from.port')}
  else{if(value.literal===undefined)fail(label+' literal cannot be undefined');try{const wire=JSON.stringify(value.literal);if(wire===undefined||wire.length>131072)fail(label+' literal cannot be encoded within size limits')}catch(error){if(error instanceof WorkflowValidationError)throw error;fail(label+' literal cannot be encoded')}}
}
export function validateWorkflowRecipe(recipe,{allowedOperations}={}){
  object(recipe,'recipe');fields(recipe,['schemaVersion','id','version','nodes','deliverables','budgetMicros'],'recipe');
  if(recipe.schemaVersion!==1)fail('Unsupported recipe schemaVersion');
  identifier(recipe.id,'recipe.id');
  if(!Number.isSafeInteger(recipe.version)||recipe.version<1)fail('recipe.version must be positive');
  const budget=cost(recipe.budgetMicros,'recipe.budgetMicros');
  if(!Array.isArray(recipe.nodes)||recipe.nodes.length<1||recipe.nodes.length>128)fail('nodes length must be 1..128');
  if(!Array.isArray(recipe.deliverables)||recipe.deliverables.length<1||recipe.deliverables.length>128)fail('deliverables length must be 1..128');
  const nodes=new Map();
  for(const [i,node] of recipe.nodes.entries()){
    object(node,'nodes['+i+']');fields(node,['id','operation','dependsOn','inputs','outputs','effects','maxCostMicros','approvalRequired','when'],'node');
    identifier(node.id,'node.id');
    if(nodes.has(node.id))fail('Duplicate node '+node.id);
    if(typeof node.operation!=='string'||!OPERATION.test(node.operation))fail(node.id+' has an invalid operation');
    if(allowedOperations&&!allowedOperations.includes(node.operation))fail('Unsupported operation '+node.operation);
    if(!['read','generation','external'].includes(node.effects))fail(node.id+' needs an effects classification');
    if(CONSEQUENT.test(node.operation)&&node.effects!=='external')fail(node.id+' consequential operation must be external');
    if(node.effects==='external'&&node.approvalRequired!==true)fail(node.id+' external effect requires explicit human approval');
    if(node.approvalRequired!==undefined&&typeof node.approvalRequired!=='boolean')fail(node.id+' approvalRequired must be boolean');
    if(!Array.isArray(node.dependsOn)||new Set(node.dependsOn).size!==node.dependsOn.length)fail(node.id+' dependsOn must list unique node IDs');
    for(const dep of node.dependsOn)identifier(dep,node.id+' dependency');
    cost(node.maxCostMicros,node.id+' maxCostMicros');
    object(node.inputs,node.id+'.inputs');
    for(const [name,input] of Object.entries(node.inputs)){identifier(name,node.id+' input');readInput(input,node.id+'.'+name)}
    portMap(node.outputs,node.id+'.outputs');
    if(node.when!==undefined){
      object(node.when,node.id+'.when');fields(node.when,['node','port','equals'],node.id+'.when');
      identifier(node.when.node,node.id+'.when.node');identifier(node.when.port,node.id+'.when.port');
      if(!['string','number','boolean'].includes(typeof node.when.equals)||(typeof node.when.equals==='number'&&!Number.isFinite(node.when.equals)))fail('when.equals must be a finite scalar');
    }
    nodes.set(node.id,node);
  }
  let order;
  try{order=validateWorkflow(recipe.nodes)}catch(error){fail(error.message)}
  let total=0n;
  for(const node of recipe.nodes){
    total+=BigInt(node.maxCostMicros);
    if(total>BigInt(Number.MAX_SAFE_INTEGER))fail('Workflow aggregate budget overflows');
    for(const [name,input] of Object.entries(node.inputs)){
      if(!input.from)continue;
      const parent=nodes.get(input.from.node);
      if(!parent)fail(node.id+'.'+name+' points to an unknown node');
      if(!node.dependsOn.includes(parent.id))fail(node.id+'.'+name+' must explicitly depend on '+parent.id);
      if(parent.outputs[input.from.port]!==input.mimeType)fail(node.id+'.'+name+' has a mismatched artifact MIME type');
    }
    if(node.when){
      const parent=nodes.get(node.when.node);
      if(!parent||!node.dependsOn.includes(parent.id))fail(node.id+' condition must depend on a known node');
      if(parent.outputs[node.when.port]!=='application/json')fail(node.id+' condition must use a JSON result');
    }
  }
  if(total>BigInt(budget))fail('Combined per-node cost ceilings exceed workflow budget');
  const resultIds=new Set();
  for(const deliverable of recipe.deliverables){
    object(deliverable,'deliverable');fields(deliverable,['id','from','mimeType'],'deliverable');
    identifier(deliverable.id,'deliverable.id');
    if(resultIds.has(deliverable.id))fail('Duplicate deliverable '+deliverable.id);
    resultIds.add(deliverable.id);
    object(deliverable.from,'deliverable.from');fields(deliverable.from,['node','port'],'deliverable.from');
    const parent=nodes.get(deliverable.from.node);
    if(!parent||parent.outputs[deliverable.from.port]!==deliverable.mimeType)fail('Deliverable '+deliverable.id+' lacks a matching typed output');
    mime(deliverable.mimeType,'deliverable.mimeType');
  }
  return {order,costCeilingMicros:Number(total),approvals:recipe.nodes.filter(n=>n.approvalRequired).map(n=>n.id)};
}
export function previewWorkflow(recipe,options){
  const validity=validateWorkflowRecipe(recipe,options);
  return {
    schemaVersion:1,recipeId:recipe.id,recipeVersion:recipe.version,
    plannedOnly:true,executionStarted:false,costIsEstimate:false,
    workflowBudgetMicros:recipe.budgetMicros,nodeCostCeilingMicros:validity.costCeilingMicros,
    executionOrder:validity.order,
    requiredHumanApprovals:validity.approvals,
    unpricedOperations:recipe.nodes.filter(n=>n.effects==='generation'&&n.maxCostMicros===0).map(n=>n.id),
    deliverables:recipe.deliverables.map(d=>({...d,from:{...d.from}})),
    blockers:['Provider capability, permission, pricing and execution infrastructure must be verified before running this workflow']
  };
}
const TEXT='text/markdown',JSON_TYPE='application/json',IMAGE='image/png',VIDEO='video/mp4',AUDIO='audio/wav';
const BLUEPRINTS={
  'legislative-package':[
    ['sources','research.collect',JSON_TYPE,[]],
    ['bill','legislation.draft',TEXT,['sources']],
    ['summary','writing.summarize',TEXT,['bill']],
    ['analysis','research.analyze',TEXT,['sources','bill']],
    ['talking-points','writing.persuade',TEXT,['bill']],
    ['appendix','writing.citations',TEXT,['sources']]
  ],
  'film-pitch':[
    ['logline','writing.logline',TEXT,[]],
    ['treatment','writing.treatment',TEXT,['logline']],
    ['storyboard','image.storyboard',IMAGE,['treatment']],
    ['trailer','video.trailer',VIDEO,['storyboard','treatment']],
    ['pitch-deck','writing.pitch',TEXT,['treatment','storyboard']],
    ['poster','image.poster',IMAGE,['storyboard']]
  ],
  'music-release':[
    ['song','music.generate',AUDIO,[]],
    ['stems','music.separate',AUDIO,['song']],
    ['cover','image.cover',IMAGE,[]],
    ['music-video','video.music',VIDEO,['song','cover']],
    ['release-notes','writing.release',TEXT,['song']]
  ]
};
export function listGoalTemplates(){return Object.fromEntries(Object.entries(BLUEPRINTS).map(([key,steps])=>[key,steps.map(s=>s[0])]))}
export function compileGoalChecklist({goal,selected,budgetMicros=0}={}){
  const steps=BLUEPRINTS[goal];if(!steps)fail('Unknown goal template');
  if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length)fail('Select one or more unique deliverables');
  cost(budgetMicros,'budgetMicros');
  const byId=new Map(steps.map(s=>[s[0],s])),wanted=new Set();
  function include(id){const step=byId.get(id);if(!step)fail('Unknown deliverable '+id);if(wanted.has(id))return;wanted.add(id);step[3].forEach(include)}
  selected.forEach(include);
  const nodes=steps.filter(s=>wanted.has(s[0])).map(([id,operation,type,dependencies])=>({
    id,operation,effects:operation.startsWith('research.')?'read':'generation',
    maxCostMicros:0,approvalRequired:false,dependsOn:dependencies,
    inputs:Object.fromEntries(dependencies.map(dep=>[dep,{from:{node:dep,port:'result'},mimeType:byId.get(dep)[2]}])),
    outputs:{result:type}
  }));
  const recipe={schemaVersion:1,id:goal,version:1,budgetMicros,nodes,deliverables:selected.map(id=>({id,from:{node:id,port:'result'},mimeType:byId.get(id)[2]}))};
  return {recipe,preview:previewWorkflow(recipe)};
}
