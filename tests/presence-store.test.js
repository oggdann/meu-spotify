import test from 'node:test';
import assert from 'node:assert/strict';
import {createSiteStore} from '../lib/site-store.js';
const now=Date.parse('2026-11-16T12:00:00Z');
test('presence store deduplicates users, throttles repeated marks and keeps old presences until their owner removes them',async()=>{
  const memory=new Map(),files=new Map();let writes=0;
  const store=createSiteStore({now:()=>now,cache:{get:async key=>memory.get(key),set:async(key,value)=>memory.set(key,value)},read:async key=>files.get(key),write:async(key,value)=>{files.set(key,{value});writes++},listing:async()=>[...files.keys()].map(pathname=>({pathname})),remove:async key=>files.delete(key)});
  files.set('presence/old.json',{value:{id:'old',presentAt:now-31*86400000}});
  await store.mark({id:'guest',name:'Guest'},'guest');await store.mark({id:'guest',name:'Guest'},'guest');
  assert.equal(writes,1);assert.equal((await store.presences()).length,2);
  await store.removePresence('guest');assert.equal((await store.presences()).length,1);
});
test('a failed profile read is not cached as an empty wall',async()=>{
  let writes=0;const store=createSiteStore({now:()=>now,cache:{get:async()=>null,set:async()=>{writes++}},listing:async()=>[{pathname:'presence/one.json'}],read:async()=>{throw Error('temporary storage failure')}});
  await assert.rejects(store.presences(),/temporary storage failure/);assert.equal(writes,0);
});
test('one visitor has one active presence and a shared playlist does not count as someone else identity',async()=>{
  const files=new Map();let writes=0;const store=createSiteStore({now:()=>now,cache:{get:async()=>null,set:async()=>{}},read:async key=>files.get(key),write:async(key,value)=>{writes++;files.set(key,{value})},listing:async()=>[...files.keys()].map(pathname=>({pathname})),remove:async key=>files.delete(key)});
  const profile={id:'guest-one',name:'One',source:'guest',instagramUrl:'https://www.instagram.com/one/',spotifyUrl:'https://open.spotify.com/playlist/306AubstP6UatfIUhynAX8'};
  await store.mark(profile,'one');await store.mark({...profile,comment:'repeat'},'one');assert.equal(writes,1);
  await assert.rejects(store.mark({...profile,id:'guest-other'},'other'),error=>error.code==='profile_already_present');
  await store.mark({...profile,id:'guest-two',instagramUrl:null},'two');assert.equal((await store.presences()).length,2);
});
