import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const loadTS = async (file) => {
  const js = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
};
const {requestJson, canRetry} = await loadTS('../src/lib/api-client.ts');
const id = '11111111-2222-4333-8444-555555555555';
const response = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}});
const deps = (fetch) => ({hosts:['https://primary.invalid/portal','https://fallback.invalid/portal'], getAdminToken:()=>null, getVisitorId:()=>id, setAdminToken:()=>{}, fetch});
for (const failure of ['network','timeout','502','malformed']) {
  test(`POST creation never repeats after ${failure}, including fallback`, async()=>{
    let count=0;
    const d=deps(async()=>{count++; if(failure==='network')throw new TypeError('lost response'); if(failure==='timeout'){const e=new Error('timeout');e.name='TimeoutError';throw e;} if(failure==='502')return response({error:'gateway'},502);return new Response('<html>gateway</html>',{status:200});});
    await assert.rejects(requestJson('tests',{method:'POST',body:'{}',retries:2},d), e=>e.uncertain===true);
    assert.equal(count,1);
  });
}
test('GET can switch to fallback after network failure',async()=>{
 let count=0;const result=await requestJson('overview',{retries:0},deps(async()=>{if(++count===1)throw new TypeError('offline');return response({ok:true});}));assert.deepEqual(result,{ok:true});assert.equal(count,2);
});
test('GET can switch to fallback after 503',async()=>{
 let count=0;await requestJson('overview',{retries:0},deps(async()=>++count===1?response({},503):response({ok:true})));assert.equal(count,2);
});
test('4xx is not retried',async()=>{
 let count=0;await assert.rejects(requestJson('overview',{},deps(async()=>{count++;return response({error:'forbidden'},403);})),e=>e.status===403);assert.equal(count,1);
});
test('POST login cannot be repeated or set a token from an error',async()=>{
 let count=0,token=null;const d={...deps(async()=>{count++;return response({token:'do-not-store'},401)}),setAdminToken:t=>token=t};
 await assert.rejects(requestJson('admin/login',{method:'POST'},d));assert.equal(count,1);assert.equal(token,null);
});
test('successful login stores token',async()=>{
 let token=null;await requestJson('admin/login',{method:'POST'},{...deps(async()=>response({token:'test-session'})),setAdminToken:t=>token=t});assert.equal(token,'test-session');
});
test('already aborted request never sends',async()=>{
 let count=0;const c=new AbortController();c.abort();await assert.rejects(requestJson('overview',{signal:c.signal},deps(async()=>{count++;return response({})})),e=>e.name==='AbortError');assert.equal(count,0);
});
test('abort during retry wait prevents another request',async()=>{
 let count=0;const c=new AbortController();const run=requestJson('overview',{signal:c.signal},deps(async()=>{count++;return response({},503)}));setTimeout(()=>c.abort(),20);await assert.rejects(run,e=>e.name==='AbortError');assert.equal(count,1);
});
test('request timeout aborts fetch and can fall back for GET',async()=>{
 let count=0;await requestJson('overview',{timeoutMs:10,retries:0},deps(async(_url,init)=>{if(++count===2)return response({});return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));}));assert.equal(count,2);
});
test('Headers instance is supported; same visitor ID sent',async()=>{
 await requestJson('overview',{headers:new Headers({'x-custom':'value'})},deps(async(_url,init)=>{assert.equal(init.headers.get('x-custom'),'value');assert.equal(init.headers.get('x-visitor-id'),id);return response({});}));
});
test('only explicitly idempotent mutations may retry',()=>{
 assert.equal(canRetry(`tests/${id}`,'PATCH'),true);assert.equal(canRetry(`tests/${id}/finish`,'POST'),true);
 for(const [p,m] of [['admin/login','POST'],['admin/backups/1','POST'],['admin/questions/1','DELETE'],['admin/questions/1','PATCH'],['tests','POST']])assert.equal(canRetry(p,m),false);
});
test('private-mode storage failure keeps visitor identity and admin session',async()=>{
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')},removeItem(){throw Error('blocked')}}});
 const session=await loadTS('../src/lib/session.ts');
 const a=session.getVisitorId();assert.match(a,/^[\da-f-]{36}$/);assert.equal(session.getVisitorId(),a);
 session.setAdminToken('ephemeral');assert.equal(session.getAdminToken(),'ephemeral');session.setAdminToken(null);assert.equal(session.getAdminToken(),null);
 delete globalThis.localStorage;
});

test('GET switches to fallback even when a gateway returns HTML',async()=>{
 let count=0;await requestJson('overview',{retries:0},deps(async()=>++count===1?new Response('<html>gateway</html>',{status:502}):response({ok:true})));assert.equal(count,2);
});
