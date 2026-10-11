import {createServer} from 'node:http';
import {ENGINE_VERSION,WORKSPACE_KINDS} from '../../../packages/core/src/index.mjs';
import {readFileSync} from 'node:fs';
const contract=JSON.parse(readFileSync(new URL('../../../contracts/openapi.json',import.meta.url),'utf8'));
const patterns=Object.entries(contract.paths).flatMap(([path,methods])=>Object.entries(methods).map(([method,op])=>({method:method.toUpperCase(),regex:new RegExp('^'+path.replace(/\{[^}]+\}/g,'[^/]+')+'$'),op})));
export function handler(req,res) {
  const path=new URL(req.url||'/', 'http://localhost').pathname;
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(path==='/health' && req.method==='GET') {res.writeHead(200);res.end(JSON.stringify({status:'ok',version:ENGINE_VERSION}));return;}
  if(path==='/v1/capabilities' && req.method==='GET') {res.writeHead(200);res.end(JSON.stringify({workspaceKinds:WORKSPACE_KINDS,availableProviders:[],generationEnabled:false}));return;}
  const route=patterns.find(x=>x.method===req.method && x.regex.test(path));
  if(route && route.op['x-implementation']==='planned'){res.writeHead(501);res.end(JSON.stringify({code:'not_implemented',message:'The operation is part of the versioned API contract but not available.'}));return;}
  res.writeHead(404);res.end(JSON.stringify({code:'not_found',message:'Unknown API route.'}));
}
export function makeServer(){return createServer(handler)}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){const port=Number(process.env.PORT||8080);makeServer().listen(port,()=>console.log('Engine API listening',port));}
