import pg from 'pg';
export const AI_FAMILIES=Object.freeze(['generative','predictive','speech','vision','spatial','optimization','agent','music','video','image','coding']);
const STATES=Object.freeze(['healthy','degraded','outage','unknown']);
export function describeModel(row,{capability,region,usage='personal',now=Date.now(),maxObservationAgeMs=300000}={}){
  if(!row||typeof row!=='object')throw new TypeError('Model row required');
  const operations=Array.isArray(row.operations)?row.operations:[];
  const modalities=Array.isArray(row.modalities)?row.modalities:[];
  const regions=Array.isArray(row.regions)?row.regions:[];
  const reasons=[];
  const healthTime=row.health_observed_at?new Date(row.health_observed_at).getTime():NaN;
  let health=STATES.includes(row.health_status)?row.health_status:'unknown';
  if(!Number.isFinite(healthTime)||now-healthTime>maxObservationAgeMs||now<healthTime)health='unknown';
  if(row.enabled!==true)reasons.push('disabled');
  if(row.adapter_configured!==true)reasons.push('provider_not_configured');
  if(health!=='healthy')reasons.push('health_'+health);
  if(row.price_status!=='known'||row.price_microunits===null||row.price_microunits===undefined)reasons.push('price_unknown');
  if(row.license_scope==='none'||(usage==='commercial'&&row.license_scope!=='commercial'))reasons.push('rights_restricted');
  if(capability&&!operations.includes(capability))reasons.push('capability_unsupported');
  if(region&&!regions.includes(region))reasons.push('region_unsupported');
  return {id:String(row.id),provider:String(row.provider),model:String(row.model),revision:String(row.revision),operations:[...operations],modalities:[...modalities],regions:[...regions],licenseScope:row.license_scope||'none',priceStatus:row.price_status||'unknown',healthStatus:health,available:reasons.length===0,reasons};
}
export class CapabilityCatalog{
 constructor({db,now=()=>Date.now()}={}){if(!db||typeof db.query!=='function')throw new TypeError('PostgreSQL query adapter required');this.db=db;this.now=now;}
 async list(options={}){
  if(options.usage && !['personal','commercial'].includes(options.usage))throw new TypeError('Invalid usage category');
  for(const key of ['capability','region'])if(options[key]&&(typeof options[key]!=='string'||options[key].length>96))throw new TypeError('Invalid '+key);
  const result=await this.db.query('SELECT id,provider,model,revision,operations,modalities,regions,license_scope,price_status,price_microunits,health_status,health_observed_at,adapter_configured,enabled FROM provider_models ORDER BY provider,model,revision LIMIT 2000');
  return {items:result.rows.map(row=>describeModel(row,{...options,now:this.now()})).filter(x=>(!options.capability||x.operations.includes(options.capability))&&(!options.region||x.regions.includes(options.region)))};
 }
}
export function makeCatalogPool(connectionString){if(!connectionString)return null;return new pg.Pool({connectionString,max:5,connectionTimeoutMillis:2500,idleTimeoutMillis:10000});}
