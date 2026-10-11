// SIE-001: process boundary only. Durable queues and billable dispatch belong to SIE-014 through SIE-018.
export function workerStatus(){return Object.freeze({status:'unconfigured',dispatchEnabled:false})}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href)console.log(JSON.stringify(workerStatus()));
