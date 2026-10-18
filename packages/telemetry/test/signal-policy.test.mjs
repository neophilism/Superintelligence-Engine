import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateOperationalSignal,redactCorrelation} from '../src/signal-policy.mjs';
test('provider failures and ledger spend anomalies trigger bounded alerts',()=>{
 assert.equal(evaluateOperationalSignal({category:'provider',kind:'error',value:12,threshold:10}).severity,'warning');
 assert.equal(evaluateOperationalSignal({category:'ledger',kind:'spend',value:25,threshold:10}).severity,'critical');
 assert.equal(evaluateOperationalSignal({category:'api',kind:'latency',value:1,threshold:10}).alert,false);
});
test('prompt, identity and secret fields are rejected, not logged',()=>{
 const signal={category:'worker',kind:'dead_letter',value:8,threshold:2};
 for(const field of ['prompt','apiKey','tenantId'])assert.throws(()=>evaluateOperationalSignal({...signal,[field]:'sensitive'}));
 const span={traceId:'a'.repeat(32),spanId:'b'.repeat(16),service:'worker',event:'job_failed'};
 assert.deepEqual(Object.keys(redactCorrelation(span)),['traceId','spanId','service','event']);
 assert.throws(()=>redactCorrelation({...span,token:'secret'}));
});
