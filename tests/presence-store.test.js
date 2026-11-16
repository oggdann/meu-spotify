import test from 'node:test';
import assert from 'node:assert/strict';
import {createSiteStore} from '../lib/site-store.js';
const now=Date.parse('2026-11-16T12:00:00Z');
test('presence store deduplicates users, throttles repeated marks and limits the public wall to 30 days',async()=>{
  const memory=new Map(),files=new Map();let writes=0;
  const store=createSiteStore({now:()=>now,cache:{get:async key=>memory.get(key),set:async(key,value)=>memory.set(key,value)},read:async key=>files.get(key),write:async(key,value)=>{files.set(key,{value});writes++},listing:async()=>[...files.keys()].map(pathname=>({pathname})),remove:async key=>files.delete(key)});
  files.set('presence/old.json',{value:{id:'old',presentAt:now-31*86400000}});
  await store.mark({id:'guest',name:'Guest'},'guest');await store.mark({id:'guest',name:'Guest'},'guest');
  assert.equal(writes,1);assert.equal((await store.presences()).length,1);
  await store.removePresence('guest');assert.equal((await store.presences()).length,0);
});
