import pg from 'pg';
import {ProviderAdapters,EnvironmentCredentialProvider} from '../../../packages/providers/src/index.mjs';
import {OpenAIResponsesTextAdapter} from '../../../packages/openai-responses/src/index.mjs';
import {TextGenerationService} from '../../../packages/text-generation/src/index.mjs';

const REQUIRED=[
 'TEXT_GENERATION_DATABASE_URL','PROVIDER_OPENAI_API_KEY','TEXT_GENERATION_MODEL_ID',
 'TEXT_GENERATION_MODEL_REVISION','TEXT_GENERATION_LICENSE_SCOPE','TEXT_GENERATION_REGION',
 'TEXT_GENERATION_INPUT_MICRO_PER_TOKEN','TEXT_GENERATION_OUTPUT_MICRO_PER_TOKEN',
 'TEXT_GENERATION_FIXED_MICRO','TEXT_GENERATION_INPUT_TOKEN_CEILING'
];
const integer=value=>typeof value==='string'&&/^\d{1,12}$/.test(value)?Number(value):NaN;
export function textGenerationFromEnvironment(env=process.env){
 if(env.TEXT_GENERATION_DISPATCH_ENABLED!=='1')return null;
 if(REQUIRED.some(x=>!env[x]))return null;
 const input=integer(env.TEXT_GENERATION_INPUT_MICRO_PER_TOKEN);
 const output=integer(env.TEXT_GENERATION_OUTPUT_MICRO_PER_TOKEN);
 const fixed=integer(env.TEXT_GENERATION_FIXED_MICRO);
 const ceiling=integer(env.TEXT_GENERATION_INPUT_TOKEN_CEILING);
 if(![input,output,fixed,ceiling].every(Number.isSafeInteger)||ceiling<1||ceiling>250000)return null;
 if(input+output+fixed===0||!['personal','commercial'].includes(env.TEXT_GENERATION_LICENSE_SCOPE))return null;
 if(!/^[a-z]{2}(?:-[a-z0-9-]+)?$/.test(env.TEXT_GENERATION_REGION))return null;
 const pool=new pg.Pool({connectionString:env.TEXT_GENERATION_DATABASE_URL,max:6,connectionTimeoutMillis:3500});
 const budgetAuthority={
   check:async({tenantId,reservationId,maximumMicrounits})=>{
    const answer=await pool.query(
     "SELECT 1 FROM budget_reservations WHERE tenant_id=$1 AND id=$2 AND status='reserved' AND reserved_micro>=$3",
     [tenantId,reservationId,maximumMicrounits]);
    return {authorized:answer.rowCount===1};
   }
 };
 const registry=new ProviderAdapters({
   secrets:new EnvironmentCredentialProvider(env),budgetAuthority,
   logger:details=>{if(env.PROVIDER_AUDIT_LOG==='1')console.info(JSON.stringify({category:details.category,providerId:details.providerId,operation:details.operation}))}
 });
 const quotedMinimum=Math.max(fixed,1);
 registry.register({descriptor:{
   id:'openai-text',model:env.TEXT_GENERATION_MODEL_ID,revision:env.TEXT_GENERATION_MODEL_REVISION,
   operations:['text.generate','reason.generate'],licenseScope:env.TEXT_GENERATION_LICENSE_SCOPE,
   regions:[env.TEXT_GENERATION_REGION],priceMicrounits:quotedMinimum,timeoutMs:120000
  },adapter:new OpenAIResponsesTextAdapter({modelId:env.TEXT_GENERATION_MODEL_ID}),secretRef:'PROVIDER_OPENAI_API_KEY'});
 return new TextGenerationService({pool,providers:registry,pricing:{
   inputMicroPerToken:input,outputMicroPerToken:output,fixedMicros:fixed,inputTokenCeiling:ceiling
 },dispatchEnabled:true});
}
export function disabledByDefault(env=process.env){return env.TEXT_GENERATION_DISPATCH_ENABLED!=='1'}
