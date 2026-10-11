import test from 'node:test';import assert from 'node:assert/strict';import {GeneratedEngineClient} from '../src/generated.mjs';
test('Generated query parameters are safely encoded and typed from OpenAPI schema',async()=>{
 const paths=[];const client=new GeneratedEngineClient({baseUrl:'https://engine.test',fetchImpl:async(url)=>{paths.push(new URL(url).searchParams);return {ok:true,json:async()=>({items:[]})}}});
 const data=await client.listModels({region:'us',capability:'text.reason',usage:'commercial'});
 assert.deepEqual(data.items,[]);assert.equal(paths[0].get('capability'),'text.reason');assert.equal(paths[0].get('usage'),'commercial');assert.equal(paths[0].get('region'),'us');
});
