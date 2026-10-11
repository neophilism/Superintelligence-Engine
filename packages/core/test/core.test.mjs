import test from 'node:test';
import assert from 'node:assert/strict';
import {assertProject,createArtifact,validateWorkflow,WORKSPACE_KINDS} from '../src/index.mjs';
test('known domains and canonical project validation',()=>{assert.ok(WORKSPACE_KINDS.includes('music'));assert.deepEqual(assertProject({id:'p1',title:' Film ',kind:'video'}),{id:'p1',title:'Film',kind:'video'});assert.throws(()=>assertProject({id:'bad space',title:'Oops',kind:'code'}));});
test('immutable provenance and copy isolation',()=>{const parents=['a'];const x=createArtifact({id:'v1',projectId:'p1',mediaType:'text/plain',checksum:'abc',parents});parents.push('b');assert.deepEqual(x.parents,['a']);assert.ok(Object.isFrozen(x));});
test('dependency ordering and deterministic cycle rejection',()=>{assert.deepEqual(validateWorkflow([{id:'trailer',dependsOn:['script']},{id:'script'}]),['script','trailer']);assert.throws(()=>validateWorkflow([{id:'a',dependsOn:['b']},{id:'b',dependsOn:['a']}]),/cycle/);assert.throws(()=>validateWorkflow([{id:'a',dependsOn:['missing']}]),/Unknown/);});
