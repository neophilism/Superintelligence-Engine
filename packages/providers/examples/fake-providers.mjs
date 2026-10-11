// Two independent, deterministic fake adapters used strictly for conformance tests.
export const providerAlpha={
 async *stream({input,signal}){if(signal?.aborted)throw new Error('Aborted');yield {type:'token',text:'alpha:'+input.text};yield {type:'usage',inputUnits:input.text.length,outputUnits:6};yield {type:'complete'};},
 async submit({input}){return {providerTaskId:'alpha-'+input.text,state:'queued'};},
 async poll({providerTaskId}){return {providerTaskId,state:'completed'};},
 async cancel(){return true;}
};
export const providerBeta={
 async *stream({input}){yield {type:'token',text:'beta:'+input.text};yield {type:'usage',inputUnits:input.text.length,outputUnits:5};yield {type:'complete'};},
 async submit({input}){return {providerTaskId:'beta-'+input.text,state:'running'};},
 async poll({providerTaskId}){return {providerTaskId,state:'running'};}
};
