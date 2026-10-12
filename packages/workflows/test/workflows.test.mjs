import test from 'node:test';
import assert from 'node:assert/strict';
import {compileGoalChecklist,listGoalTemplates,previewWorkflow,validateWorkflowRecipe,WorkflowValidationError} from '../src/index.mjs';

test('bill goal compiles prerequisites, requested deliverables and zero real executions',()=>{
 const {recipe,preview}=compileGoalChecklist({goal:'legislative-package',selected:['bill','summary']});
 assert.deepEqual(preview.executionOrder,['sources','bill','summary']);
 assert.deepEqual(preview.deliverables.map(d=>d.id),['bill','summary']);
 assert.equal(preview.plannedOnly,true);assert.equal(preview.executionStarted,false);
 assert.deepEqual(preview.unpricedOperations,['bill','summary']);
 assert.equal(preview.workflowBudgetMicros,0);assert.equal(preview.nodeCostCeilingMicros,0);
});
test('film and music templates create typed multi-modal deliverables',()=>{
 const film=compileGoalChecklist({goal:'film-pitch',selected:['trailer','poster']});
 assert.deepEqual(film.preview.executionOrder,['logline','treatment','storyboard','trailer','poster']);
 assert.equal(film.preview.deliverables[0].mimeType,'video/mp4');
 const music=compileGoalChecklist({goal:'music-release',selected:['stems']});
 assert.deepEqual(music.preview.executionOrder,['song','stems']);
 assert.equal(music.preview.deliverables[0].mimeType,'audio/wav');
 assert.equal(listGoalTemplates()['film-pitch'].length,6);
});
test('reject unknown goals, duplicate requests and unknown deliverables',()=>{
 assert.throws(()=>compileGoalChecklist({goal:'wrong',selected:['bill']}),WorkflowValidationError);
 assert.throws(()=>compileGoalChecklist({goal:'film-pitch',selected:['trailer','trailer']}),/unique/);
 assert.throws(()=>compileGoalChecklist({goal:'film-pitch',selected:['unknown']}),/Unknown deliverable/);
});
function fixture(){
 return {schemaVersion:1,id:'test-plan',version:1,budgetMicros:500,
 nodes:[{id:'source',operation:'research.collect',effects:'read',maxCostMicros:50,dependsOn:[],inputs:{},outputs:{result:'application/json'}},
 {id:'publish',operation:'publish.document',effects:'external',approvalRequired:true,maxCostMicros:100,dependsOn:['source'],inputs:{content:{from:{node:'source',port:'result'},mimeType:'application/json'}},outputs:{result:'application/json'}}],
 deliverables:[{id:'receipt',from:{node:'publish',port:'result'},mimeType:'application/json'}]};
}
test('typed approvals, permissions, budget and clear preview',()=>{
 const recipe=fixture();const preview=previewWorkflow(recipe);
 assert.deepEqual(preview.requiredHumanApprovals,['publish']);
 assert.equal(preview.nodeCostCeilingMicros,150);
 assert.deepEqual(preview.executionOrder,['source','publish']);
 assert.equal(validateWorkflowRecipe(recipe,{allowedOperations:['research.collect','publish.document']}).order.length,2);
 assert.throws(()=>validateWorkflowRecipe(recipe,{allowedOperations:['research.collect']}),/Unsupported operation/);
});
test('fail-closed mismatched ports, cycles, implicit dependencies and external-effects camouflage',()=>{
 const recipe=fixture();
 recipe.nodes[1].inputs.content.mimeType='text/markdown';
 assert.throws(()=>validateWorkflowRecipe(recipe),/mismatched artifact/);
 recipe.nodes[1].inputs.content.mimeType='application/json';
 recipe.nodes[1].dependsOn=[];
 assert.throws(()=>validateWorkflowRecipe(recipe),/explicitly depend/);
 recipe.nodes[1].dependsOn=['source'];recipe.nodes[0].dependsOn=['publish'];
 assert.throws(()=>validateWorkflowRecipe(recipe),/cycle/);
 recipe.nodes[0].dependsOn=[];recipe.nodes[1].approvalRequired=false;
 assert.throws(()=>validateWorkflowRecipe(recipe),/requires explicit human approval/);
 recipe.nodes[1].approvalRequired=true;recipe.nodes[1].effects='generation';
 assert.throws(()=>validateWorkflowRecipe(recipe),/must be external/);
});
test('reject cost overflow, over-budget graphs, invalid literal and unsafe conditions',()=>{
 const recipe=fixture();recipe.nodes[1].maxCostMicros=800;
 assert.throws(()=>validateWorkflowRecipe(recipe),/exceed workflow budget/);
 recipe.nodes[1].maxCostMicros=100;
 recipe.nodes[1].inputs.example={mimeType:'application/json',literal:undefined};
 assert.throws(()=>validateWorkflowRecipe(recipe),/exactly one|cannot be undefined/);
 delete recipe.nodes[1].inputs.example;
 recipe.nodes[1].when={node:'source',port:'missing',equals:true};
 assert.throws(()=>validateWorkflowRecipe(recipe),/JSON result/);
});
