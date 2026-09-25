// Runs the watch routes of workers/subs-worker.js against an in-memory KV. No network.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const src = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'workers', 'subs-worker.js');
const tmp = path.join(os.tmpdir(), 'subs-worker-under-test.mjs');
fs.copyFileSync(src, tmp);
const w = (await import(pathToFileURL(tmp).href)).default;
const store=new Map();
const env={UNSUB_SECRET:'sec',LIST_TOKEN:'tok',SUBS:{
 async get(k){return store.has(k)?store.get(k):null},
 async put(k,v){store.set(k,v)},async delete(k){store.delete(k)},
 async list({prefix}){return{keys:[...store.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name})),list_complete:true}}}};
const H='https://x.dev';
const call=(p,m='GET',b)=>w.fetch(new Request(H+p,{method:m,headers:{'Content-Type':'application/json',Origin:'https://agsist.com'},body:b?JSON.stringify(b):undefined}),env);
const tok=(s)=>crypto.createHmac('sha256','sec').update(s.toLowerCase()).digest('hex').slice(0,16);
let ok=0;const A=(c,m)=>{if(!c){console.log('FAIL',m);process.exit(1)}ok++};
let r=await call('/watch-subscribe','POST',{email:'A@x.com',fips:'19169'});A(r.status==200,'sub');
A(JSON.parse(store.get('watch:a@x.com')).pend['19169'].m===0,'pending');
r=await call('/watch-subscribe','POST',{email:'a@x.com',fips:'abc'});A(r.status==400,'bad fips');
r=await call('/watch-subscribe','POST',{email:'nope',fips:'19169'});A(r.status==400,'bad email');
r=await call('/watch-subscribe','POST',{email:'b@x.com',fips:'19169',_gotcha:'x'});A(!store.has('watch:b@x.com'),'honeypot');
// confirm: GET mutates nothing
let t=tok('a@x.com|c|19169');
r=await call(`/watch-confirm?e=a@x.com&f=19169&t=${t}`);A((await r.text()).includes('Yes, watch it'),'confirm page');
A('19169' in JSON.parse(store.get('watch:a@x.com')).pend,'GET did not confirm');
r=await call(`/watch-confirm?e=a@x.com&f=19169&t=0000000000000000`,'POST');A((await r.text()).includes("isn't valid"),'bad token');
r=await call(`/watch-confirm?e=a@x.com&f=19169&t=${t}`,'POST');A((await r.text()).includes('You are watching'),'confirmed');
let rec=JSON.parse(store.get('watch:a@x.com'));A(rec.w['19169']===null&&!rec.pend['19169'],'moved to w');
// list + mark need token
r=await call('/watch-list');A(r.status==403,'list needs token');
r=await call('/watch-list?token=tok');let L=await r.json();A(L.length==1&&L[0].email=='a@x.com','list');
r=await call('/watch-mark?token=tok','POST',{email:'a@x.com',fips:'19169',k:'abc',s:{r:1}});
rec=JSON.parse(store.get('watch:a@x.com'));A(rec.w['19169'].k=='abc','mark');
// cap of 5
for(const f of ['19001','19003','19005','19007']) await call('/watch-subscribe','POST',{email:'a@x.com',fips:f});
r=await call('/watch-subscribe','POST',{email:'a@x.com',fips:'19009'});A(r.status==429,'cap 5');
r=await call('/watch-subscribe','POST',{email:'a@x.com',fips:'19169'});A(r.status==200,'existing is silent ok');
// one-county unsubscribe, then all
t=tok('a@x.com|w|19169');
r=await call(`/watch-unsubscribe?e=a@x.com&f=19169&t=${t}`);A(JSON.parse(store.get('watch:a@x.com')).w['19169'],'GET unsub mutates nothing');
await call(`/watch-unsubscribe?e=a@x.com&f=19169&t=${t}`,'POST');A(!('19169' in JSON.parse(store.get('watch:a@x.com')).w),'one gone');
await call(`/watch-unsubscribe?e=a@x.com&t=${tok('a@x.com|w')}`,'POST');A(!store.has('watch:a@x.com'),'all gone, key deleted');
// mark after unsubscribe is skipped
r=await call('/watch-mark?token=tok','POST',{email:'a@x.com',fips:'19169',k:'z'});A((await r.json()).skipped,'mark skipped');
// old routes intact
r=await call('/subscribe','POST',{email:'c@x.com'});A(store.has('sub:c@x.com'),'v4 subscribe');
console.log('worker ok',ok,'checks');
