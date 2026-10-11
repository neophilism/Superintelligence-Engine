// Local trusted example handler; not an AI provider and makes no external requests.
export function countLines({text}){
 if(typeof text!=='string')throw new TypeError('text expected');
 return {count:text.length===0?0:text.split(/\r?\n/).length};
}
