// SIE-016: process one safe, read-only queue job. Paid provider dispatch is intentionally disabled.
import pg from 'pg';
import {DurableJobQueue} from '../../../packages/jobs/src/index.mjs';
export function workerStatus(){return Object.freeze({status:process.env.WORKER_DATABASE_URL?'configured':'unconfigured',paidProviderDispatchEnabled:false})}
export async function processOne(queue,{workerId='sie-worker',handlers={}}={}){
 const claimed=await queue.claim({workerId});
 if(!claimed)return {status:'idle'};
 const handler=handlers[claimed.operation];
 if(claimed.effects!=='read'||typeof handler!=='function'){
   const failed=await queue.fail({jobId:claimed.id,workerId,leaseToken:claimed.lease_token,code:'handler_not_authorized'});
   return {status:failed.state,jobId:claimed.id};
 }
 try{
   const result=await handler({checkpoint:claimed.checkpoint,job:claimed});
   await queue.complete({jobId:claimed.id,workerId,leaseToken:claimed.lease_token,result});
   return {status:'succeeded',jobId:claimed.id};
 }catch(error){
   const failed=await queue.fail({jobId:claimed.id,workerId,leaseToken:claimed.lease_token,code:'handler_error'});
   return {status:failed.state,jobId:claimed.id};
 }
}
export async function runWorker({pool,workerId='sie-worker',handlers={},abortSignal,pollMs=2000}){
 const queue=new DurableJobQueue({pool});
 if(!Number.isInteger(pollMs)||pollMs<250)throw new TypeError('Minimum polling interval 250ms');
 while(!abortSignal?.aborted){
   await queue.recoverExpired();
   const outcome=await processOne(queue,{workerId,handlers});
   if(outcome.status==='idle')await new Promise(resolve=>{
     const timer=setTimeout(resolve,pollMs);
     if(abortSignal)abortSignal.addEventListener('abort',()=>{clearTimeout(timer);resolve()},{once:true});
   });
 }
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 if(process.env.WORKER_OPS_ENABLED!=='1'||!process.env.WORKER_DATABASE_URL){
   console.log(JSON.stringify(workerStatus()));
 }else{
   const pool=new pg.Pool({connectionString:process.env.WORKER_DATABASE_URL,max:5});
   const abort=new AbortController();
   for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>abort.abort());
   runWorker({pool,abortSignal:abort.signal,handlers:{}}).catch(error=>{console.error('Worker failure',error.message);process.exitCode=1}).finally(()=>pool.end());
 }
}
