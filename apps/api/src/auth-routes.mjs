import {brokerFromEnvironment} from '../../../packages/auth/src/index.mjs';
const defaultBroker=brokerFromEnvironment();
export function authRoute(req,res,pathname,{broker=defaultBroker,returnUrls={academy:process.env.ACADEMY_RETURN_URL,command:process.env.COMMAND_RETURN_URL},redirectUris={academy:process.env.OIDC_ACADEMY_REDIRECT_URI,command:process.env.OIDC_COMMAND_REDIRECT_URI}}={}){
 const match=/^\/auth\/(academy|command)\/(start|callback|session|logout)$/.exec(pathname);
 if(!match)return false;
 const [,product,action]=match;
 const reply=(status,payload)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(payload));};
 if(!broker){reply(503,{code:'auth_unconfigured',message:'Identity provider not configured'});return true;}
 const url=new URL(req.url,'http://localhost');
 const cookies=req.headers.cookie||'';
 const fail=()=>reply(401,{code:'auth_failed',message:'Authentication was not accepted'});
 if(action==='start'&&req.method==='GET'){
  broker.begin(product).then(x=>{res.writeHead(302,{Location:x.url,'Set-Cookie':x.flowCookie,'Cache-Control':'no-store'});res.end();}).catch(fail);return true;
 }
 if(action==='callback'&&req.method==='GET'){
  const next=returnUrls[product],registered=redirectUris[product];
  if(!next||!registered)return reply(503,{code:'return_unconfigured',message:'Authorized callback and return URLs are required'});
  let canonical;
  try{
   const callback=new URL(registered),returnUrl=new URL(next);
   if(callback.protocol!=='https:'||returnUrl.protocol!=='https:'||callback.pathname!==pathname)throw new Error('Untrusted redirect configuration');
   callback.search=url.search;canonical=callback.href;
  }catch{return reply(503,{code:'return_unconfigured',message:'Invalid callback or return URL configuration'});}
  broker.complete({product,callbackUrl:canonical,cookieHeader:cookies}).then(x=>{
   res.writeHead(302,{Location:next,'Set-Cookie':[x.sessionCookie,x.clearFlowCookie],'Cache-Control':'no-store'});res.end();
  }).catch(fail);return true;
 }
 if(action==='session'&&req.method==='GET'){
  broker.session({product,cookieHeader:cookies}).then(x=>x?reply(200,{authenticated:true,identityId:x.identityId}):reply(401,{authenticated:false})).catch(fail);return true;
 }
 if(action==='logout'&&req.method==='POST'){
  const origin=req.headers.origin;
  try{if(!returnUrls[product]||new URL(returnUrls[product]).origin!==origin)throw new Error('CSRF');}catch{return fail();}
  broker.logout({product,cookieHeader:cookies}).then(x=>{res.writeHead(204,{'Set-Cookie':x.clearSessionCookie,'Cache-Control':'no-store'});res.end();}).catch(fail);return true;
 }
 reply(405,{code:'method_not_allowed',message:'Unsupported authentication action'});return true;
}
