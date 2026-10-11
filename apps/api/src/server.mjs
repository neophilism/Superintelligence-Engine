import {createServer} from 'node:http';
import {ENGINE_VERSION,WORKSPACE_KINDS} from '../../../packages/core/src/index.mjs';
export function handler(req,res) {
 const path=new URL(req.url||'/', 'http://localhost').pathname;
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 if(path==='/health' && req.method==='GET') {res.writeHead(200);res.end(JSON.stringify({status:'ok',version:ENGINE_VERSION}));return;}
 if(path==='/v1/capabilities' && req.method==='GET') {res.writeHead(200);res.end(JSON.stringify({workspaceKinds:WORKSPACE_KINDS,availableProviders:[],generationEnabled:false}));return;}
 res.writeHead(404);res.end(JSON.stringify({error:'not_found'}));
}
export function makeServer(){return createServer(handler)}
if(process.argv[1] && import.meta.url===new URL('file://'+process.argv[1]).href){const port=Number(process.env.PORT||8080);makeServer().listen(port,()=>console.log('Engine API listening',port));}
