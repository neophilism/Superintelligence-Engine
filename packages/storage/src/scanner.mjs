import {createConnection} from 'node:net';
import {createHash} from 'node:crypto';
import {fileTypeFromBuffer} from 'file-type';
const mimeMap={'application/pdf':'application/pdf','image/png':'image/png','image/jpeg':'image/jpeg','image/webp':'image/webp','image/gif':'image/gif','audio/mpeg':'audio/mpeg','audio/x-wav':'audio/wav','audio/wav':'audio/wav','audio/ogg':'audio/ogg','video/mp4':'video/mp4','application/zip':'application/zip'};
export class ClamAVStreamScanner{
 constructor({socketPath,maxBytes=1073741824}={}){if(!socketPath||typeof socketPath!=='string')throw new Error('ClamAV Unix socket is required');this.socketPath=socketPath;this.maxBytes=maxBytes;}
 async scan(source){
  const socket=createConnection({path:this.socketPath});let count=0;const hash=createHash('sha256');let head=Buffer.alloc(0);
  const finish=new Promise((resolve,reject)=>{let response='';socket.setTimeout(300000,()=>socket.destroy(new Error('Scanner timed out')));socket.on('data',chunk=>{response+=chunk.toString('utf8');if(response.length>8192){socket.destroy(new Error('Malformed scanner response'));return;}if(response.includes('\0')||response.includes('\n')){socket.end();resolve(response);}});socket.on('error',reject);socket.on('close',()=>{if(!response)reject(new Error('Scanner closed without verdict'));else resolve(response);});});
  try{
   await new Promise((ok,fail)=>{socket.once('connect',ok);socket.once('error',fail)});
   socket.write(Buffer.from('zINSTREAM\0'));
   for await(const input of source){const data=Buffer.from(input);count+=data.length;if(count>this.maxBytes)throw new Error('Asset size exceeds scan cap');hash.update(data);if(head.length<4100)head=Buffer.concat([head,data.subarray(0,4100-head.length)]);
     for(let offset=0;offset<data.length;offset+=1024*1024){const chunk=data.subarray(offset,offset+1024*1024);const length=Buffer.alloc(4);length.writeUInt32BE(chunk.length);if(!socket.write(Buffer.concat([length,chunk])))await new Promise(ok=>socket.once('drain',ok));}
   }
   socket.write(Buffer.alloc(4));
   const response=await finish;
   const virus=/FOUND/.test(response);if(virus)return {clean:false,sizeBytes:count,sha256:hash.digest('hex'),detectedType:'unknown'};
   if(!/\bOK\b/.test(response))throw new Error('Scanner did not return clean verdict');
   const identified=await fileTypeFromBuffer(head);
   let mediaType=mimeMap[identified?.mime]||null;
   if(!mediaType){try{new TextDecoder('utf-8',{fatal:true}).decode(head);mediaType='text/plain'}catch{mediaType='application/octet-stream';}}
   return {clean:true,sizeBytes:count,sha256:hash.digest('hex'),detectedType:mediaType};
  }catch(e){socket.destroy();throw e;}
 }
}
