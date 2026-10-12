import {ProviderError} from '../../providers/src/index.mjs';
const ENDPOINT='https://api.openai.com/v1/responses';
const MODEL=/^[A-Za-z0-9._:-]{2,96}$/;
const MAX_PROMPT=100000,MAX_STREAM_BYTES=8388608,MAX_TEXT=2000000;
function requireText(value,label,max){
 if(typeof value!=='string'||!value.trim()||value.length>max)throw new ProviderError('invalid_input','Invalid '+label);
 return value;
}
async function* parseStream(response,signal){
 if(!response.body?.getReader)throw new ProviderError('missing_stream','Provider did not return streaming data');
 const decoder=new TextDecoder(),reader=response.body.getReader();
 let buffer='',total=0;
 try{
  while(true){
   if(signal?.aborted)throw new ProviderError('cancelled','Provider stream was cancelled');
   const chunk=await reader.read();if(chunk.done)break;
   total+=chunk.value.byteLength;
   if(total>MAX_STREAM_BYTES)throw new ProviderError('response_limit','Provider stream exceeds bounded output size');
   buffer+=decoder.decode(chunk.value,{stream:true});
   if(buffer.length>MAX_STREAM_BYTES)throw new ProviderError('response_limit','Oversized streaming buffer');
   let match;
   while((match=/\r?\n\r?\n/.exec(buffer))){
    const frame=buffer.slice(0,match.index),remaining=buffer.slice(match.index+match[0].length);
    buffer=remaining;
    const data=frame.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');
    if(!data||data==='[DONE]')continue;
    try{yield JSON.parse(data)}catch{throw new ProviderError('invalid_stream_event','Provider sent malformed JSON')}
   }
  }
  buffer+=decoder.decode();
  if(buffer.trim()){
    const data=buffer.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');
    if(data&&data!=='[DONE]'){try{yield JSON.parse(data)}catch{throw new ProviderError('invalid_stream_event')}}
  }
 }finally{await reader.cancel().catch(()=>{})}
}
export class OpenAIResponsesTextAdapter {
 constructor({modelId,fetchImpl=fetch}={}){
  if(typeof modelId!=='string'||!MODEL.test(modelId))throw new TypeError('Model must be an explicitly configured nonempty identifier');
  if(typeof fetchImpl!=='function')throw new TypeError('fetchImpl required');
  this.modelId=modelId;this.fetchImpl=fetchImpl;
 }
 async *stream({operation,input,credential,signal,options={}}={}){
  if(!['text.generate','reason.generate'].includes(operation))throw new ProviderError('unsupported_operation');
  requireText(credential,'server credential',8192);
  const prompt=typeof input==='string'?input:input?.prompt;
  requireText(prompt,'prompt',MAX_PROMPT);
  const instructions=input&&typeof input==='object'&&input.instructions!==undefined?requireText(input.instructions,'instructions',4096):undefined;
  const maxOutputTokens=options.maxOutputTokens===undefined?512:options.maxOutputTokens;
  if(!Number.isInteger(maxOutputTokens)||maxOutputTokens<16||maxOutputTokens>4096)throw new ProviderError('output_limit','Invalid maximum output tokens');
  if(signal?.aborted)throw new ProviderError('cancelled');
  const body={model:this.modelId,input:prompt,stream:true,store:false,max_output_tokens:maxOutputTokens,...(instructions?{instructions}:{})};
  let response;
  try{
   response=await this.fetchImpl(ENDPOINT,{method:'POST',redirect:'error',headers:{
    'Authorization':'Bearer '+credential,'Content-Type':'application/json','Accept':'text/event-stream'
   },body:JSON.stringify(body),signal});
  }catch(error){if(signal?.aborted)throw new ProviderError('cancelled');throw new ProviderError('transport_error','Provider streaming transport failed')}
  if(!response?.ok)throw new ProviderError('upstream_error','Provider did not accept the request');
  if(!response.headers?.get('content-type')?.includes('text/event-stream'))throw new ProviderError('invalid_content_type','Expected provider SSE stream');
  let completed=false,characters=0;
  for await(const event of parseStream(response,signal)){
   if(event?.type==='response.output_text.delta'){
     if(typeof event.delta!=='string')throw new ProviderError('invalid_stream_event');
     characters+=event.delta.length;if(characters>MAX_TEXT)throw new ProviderError('output_limit');
     yield {type:'token',text:event.delta};
   }else if(event?.type==='response.completed'){
     if(completed)throw new ProviderError('duplicate_terminal_event');
     const usage=event.response?.usage;
     if(!Number.isSafeInteger(usage?.input_tokens)||!Number.isSafeInteger(usage?.output_tokens)||usage.input_tokens<0||usage.output_tokens<0)throw new ProviderError('usage_missing','Cannot settle a provider response without usage evidence');
     yield {type:'usage',inputUnits:usage.input_tokens,outputUnits:usage.output_tokens};
     yield {type:'complete',responseId:String(event.response.id||''),modelRevision:String(event.response.model||this.modelId)};
     completed=true;
   }else if(event?.type==='response.failed'||event?.type==='response.incomplete'||event?.type==='error'){
     throw new ProviderError('provider_failed','Provider reported an unsuccessful generation');
   }
  }
  if(!completed)throw new ProviderError('incomplete_stream','No completed response with usage was received');
 }
 async submit(){throw new ProviderError('async_not_supported','Background submission belongs to the later asynchronous media pipeline')}
 async poll(){throw new ProviderError('async_not_supported','This adapter only supports streaming text')}
}
