import test from 'node:test';
import assert from 'node:assert/strict';
import {validateListeningSnapshot} from '../lib/listening.js';
import {createCollectorHandler} from '../api/coletor.js';
import {createSiteStore} from '../lib/site-store.js';
const now=Date.parse('2026-11-16T12:00:00Z');
const snapshot=()=>({version:1,mode:'playback_progress',startedAt:now-86400000,updatedAt:now,periods:[7,30].map(days=>({days,start:now-days*86400000,end:now,heardMs:90000,plays:1,artists:[{name:'Artist',heardMs:90000,count:1,url:'javascript:alert(1)',email:'must-not-leak'}],tracks:[]}))});
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this}});
test('collector accepts measured playback time and strips private fields and unsafe links',()=>{
  const result=validateListeningSnapshot(snapshot(),now);assert.equal(result.periods[0].minutes,1);
  assert.equal(result.periods[0].artists[0].url,null);assert.doesNotMatch(JSON.stringify(result),/email|javascript|must-not-leak/);
});
test('impossible totals, duplicated periods, invalid dates and inflated rankings are rejected',()=>{
  for(const mutate of [s=>s.periods[0].heardMs=8*86400000,s=>s.periods[1].days=7,s=>s.updatedAt=now+600000,s=>s.periods[0].artists[0].heardMs=999999,s=>s.periods[0].end=now+999999]){
    const s=snapshot();mutate(s);assert.throws(()=>validateListeningSnapshot(s,now));
  }
});
test('upload authentication and expiring bootstrap protect the collector write credential',async()=>{
  process.env.OGG_COLLECTOR_TOKEN='write-only-test';process.env.OGG_SETUP_KEY='private-bootstrap';process.env.OGG_COLLECTOR_SETUP_EXPIRES_AT=String(now+60000);
  const stored=[],h=createCollectorHandler({now:()=>now,store:()=>({saveMeasured:async value=>{stored.push(value);return true}})});
  for(const authorization of [undefined,'Bearer wrong']){const r=response();await h({method:'POST',headers:{authorization},body:snapshot()},r);assert.equal(r.code,401);}
  const upload=response();await h({method:'POST',headers:{authorization:'Bearer write-only-test'},body:snapshot()},upload);assert.equal(upload.code,200);assert.equal(stored.length,1);
  const setup=response();await h({method:'GET',headers:{authorization:'Bearer private-bootstrap'}},setup);assert.equal(setup.body.token,'write-only-test');assert.equal(setup.headers['Cache-Control'],'no-store');
  process.env.OGG_COLLECTOR_SETUP_EXPIRES_AT='0';const expired=response();await h({method:'GET',headers:{authorization:'Bearer private-bootstrap'}},expired);assert.equal(expired.code,404);assert.doesNotMatch(JSON.stringify(expired.body),/write-only/);
});
test('durable checkpoint recovers after cache eviction and rejects older uploads',async()=>{
  const memory=new Map(),files=new Map();let writes=0;
  const store=createSiteStore({now:()=>now,cache:{get:async key=>memory.get(key),set:async(key,value)=>memory.set(key,value)},read:async key=>files.get(key),write:async(key,value)=>{files.set(key,{value,etag:'v1'});writes++},listing:async()=>[],remove:async()=>{}});
  const value=validateListeningSnapshot(snapshot(),now);await store.saveMeasured(value);assert.equal(writes,1);
  assert.equal(await store.saveMeasured({...value,updatedAt:now-1000}),false);
  memory.clear();assert.deepEqual(await store.measured(),value);
  await store.saveMeasured({...value,updatedAt:now+1000});assert.equal(writes,2); // Eviction permits another safe checkpoint.
});
test('presence store deduplicates users, throttles repeated marks and limits the public wall to 30 days',async()=>{
  const memory=new Map(),files=new Map();let writes=0;
  const store=createSiteStore({now:()=>now,cache:{get:async key=>memory.get(key),set:async(key,value)=>memory.set(key,value)},read:async key=>files.get(key),write:async(key,value)=>{files.set(key,{value});writes++},listing:async()=>[...files.keys()].map(pathname=>({pathname})),remove:async key=>files.delete(key)});
  files.set('presence/old.json',{value:{id:'old',presentAt:now-31*86400000}});
  await store.mark({id:'guest',name:'Guest'},'guest');await store.mark({id:'guest',name:'Guest'},'guest');
  assert.equal(writes,1);assert.equal((await store.presences()).length,1);
  await store.removePresence('guest');assert.equal((await store.presences()).length,0);
});
