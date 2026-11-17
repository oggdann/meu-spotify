import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunityStore,orderEntries,OWNER_ID} from '../lib/community-store.js';
import {createMuralHandler} from '../api/mural.js';
function setup(){
 const files=new Map(),people=[{id:'guest-one',name:'One',source:'guest',comment:'Original visitor text',presentAt:1000},{id:OWNER_ID,name:'ogg',source:'spotify',comment:'Owner',presentAt:500}];let seq=0;
 const read=async key=>files.has(key)?structuredClone(files.get(key)):null;
 const write=async(key,value,etag)=>{const old=files.get(key);await Promise.resolve();if((old&&(!etag||old.etag!==etag))||(!old&&etag))throw Object.assign(new Error('precondition'),{status:412});if(files.get(key)?.etag!==old?.etag)throw Object.assign(new Error('precondition'),{status:412});files.set(key,{value:structuredClone(value),etag:String(++seq)});};
 const store=createCommunityStore({read,write,listing:async prefix=>[...files.keys()].filter(p=>p.startsWith(prefix)).map(pathname=>({pathname})),presences:async()=>people,now:()=>2000});
 return {store,files,people,viewer:{key:'actor-one',guestId:'guest-one',isOwner:false},owner:{key:'owner-key',guestId:'guest-one',isOwner:true,userId:OWNER_ID,profile:{name:'ogg'}}};
}
test('likes are persistent, idempotent and concurrent actors do not overwrite each other',async()=>{
 const {store,viewer}=setup();await store.action('curtir',{id:'guest-one',liked:true},viewer);await store.action('curtir',{id:'guest-one',liked:true},viewer);
 assert.equal((await store.feed(viewer)).find(r=>r.id==='guest-one').likeCount,1);
 await Promise.all([store.action('curtir',{id:'guest-one',liked:true},{...viewer,key:'two'}),store.action('curtir',{id:'guest-one',liked:true},{...viewer,key:'three'})]);
 assert.equal((await store.feed(viewer)).find(r=>r.id==='guest-one').likeCount,3);
 await store.action('curtir',{id:'guest-one',liked:false},viewer);assert.equal((await store.feed(viewer)).find(r=>r.id==='guest-one').likeCount,2);
 assert.doesNotMatch(JSON.stringify(await store.feed(viewer)),/actor-one|owner-key|audit/);
});
test('replies use real authors, deduplicate retries, support likes, and page within the original thread',async()=>{
 const {store,viewer,owner}=setup();const body={id:'guest-one',requestId:'reply-0001',text:'Hello'};
 await store.action('responder',body,viewer);await store.action('responder',body,viewer);
 await store.action('responder',{...body,requestId:'reply-0002',text:'Owner reply'},owner);
 await store.action('curtir',{id:'guest-one',replyId:'reply-0001',liked:true},viewer);
 const page=await store.replies('guest-one',viewer,0,1);assert.equal(page.items.length,1);assert.equal(page.next,1);assert.equal(page.items[0].name,'One');assert.equal(page.items[0].likeCount,1);
 assert.equal((await store.replies('guest-one',viewer,1,1)).items[0].creator,true);
 await assert.rejects(store.action('responder',{...body,id:'reply-0001'},viewer),e=>e.status===404);
});
test('creator badges preserve normal date and engagement sorting without pinning or granting fabricated names ownership',async()=>{
 const {store,viewer,people}=setup();people.push({id:'guest-fake',name:'ogg',source:'guest',url:'https://open.spotify.com/user/'+OWNER_ID,presentAt:3000});
 const entries=await store.feed(viewer);assert.equal(entries.find(r=>r.id===OWNER_ID).creator,true);
 assert.equal(orderEntries(entries,'recentes')[0].id,'guest-fake');assert.equal(orderEntries(entries,'antigos')[0].id,OWNER_ID);
 entries.find(r=>r.id==='guest-one').likeCount=5;entries.find(r=>r.id==='guest-one').replyCount=4;
 for(const sort of ['curtidos','respostas']){const rows=orderEntries(entries,sort);assert.equal(rows[0].id,'guest-one');assert.equal(rows.find(r=>r.id==='guest-fake').creator,false);}
});
test('admin editing retains private original and audit; moderation is enforced server side',async()=>{
 const {store,viewer,owner,files}=setup();
 for(const action of ['editar','ocultar','excluir','identificar','publicar'])await assert.rejects(store.action(action,{id:'guest-one',text:'Bad',requestId:'post-0001',hidden:true},viewer),e=>e.status===403);
 await store.action('editar',{id:'guest-one',text:'Moderated text'},owner);
 let row=(await store.feed(viewer)).find(r=>r.id==='guest-one');assert.equal(row.comment,'Moderated text');assert.equal(row.moderationEdit,true);
 assert.doesNotMatch(JSON.stringify(row),/Original visitor text|editor/);
 const state=[...files.values()].map(v=>v.value).find(v=>v.audit);assert.equal(state.audit[0].before.comment,'Original visitor text');assert.equal(state.audit[0].editor,OWNER_ID);
 await store.action('ocultar',{id:'guest-one',hidden:true},owner);assert.equal((await store.feed(viewer)).some(r=>r.id==='guest-one'),false);
 assert.equal((await store.feed(owner)).find(r=>r.id==='guest-one').hidden,true);
 await store.action('ocultar',{id:'guest-one',hidden:false},owner);await store.action('excluir',{id:'guest-one'},owner);assert.equal((await store.feed(viewer)).some(r=>r.id==='guest-one'),false);
});
test('creator publication is idempotent and old anonymous ownership needs both verified owner and original browser',async()=>{
 const {store,viewer,owner}=setup();await assert.rejects(store.action('identificar',{id:'guest-one'},{...owner,guestId:'different'}),e=>e.status===403);
 await store.action('identificar',{id:'guest-one'},owner);assert.equal((await store.feed(viewer)).find(r=>r.id==='guest-one').creator,true);
 await store.action('publicar',{requestId:'creator-0001',text:'Owner post'},owner);await store.action('publicar',{requestId:'creator-0001',text:'Owner post'},owner);
 assert.equal((await store.feed(viewer)).filter(r=>r.id==='post-creator-0001').length,1);
});
test('API requires signed identity, exact origin and CSRF and keeps regular sort pagination stable',async()=>{
 const {store,viewer,people}=setup();for(let i=0;i<28;i++)people.push({id:'guest-'+i,name:'Visitor',source:'guest',presentAt:i+5000});
 const h=createMuralHandler({store:()=>store,identity:()=>({...viewer,valid:csrf=>csrf==='valid'})});
 const res=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this}});
 for(const headers of [{origin:'https://evil.example'},{}]){const r=res();await h({method:'POST',url:'/api/mural?acao=curtir',headers,body:{csrf:'valid',id:'guest-one',liked:true}},r);assert.equal(r.code,403);}
 const a=res();await h({method:'GET',url:'/api/mural?acao=listar',headers:{}},a);assert.equal(a.body.items[0].id,'guest-27');assert.equal(a.body.items.length,20);
 const b=res();await h({method:'GET',url:'/api/mural?acao=listar&cursor='+a.body.next,headers:{}},b);const ids=[...a.body.items,...b.body.items].map(r=>r.id);assert.equal(new Set(ids).size,30);assert.equal(b.body.items.find(r=>r.id===OWNER_ID).creator,true);
});

test('legacy comments keep both social previews; only the owner may refresh them',async()=>{
 const {store,viewer,owner,people}=setup();Object.assign(people[0],{instagramUrl:'https://www.instagram.com/legacy_preview/',spotifyUrl:'https://open.spotify.com/user/legacy_preview',previews:[{url:'https://open.spotify.com/user/legacy_preview',title:'Spotify name',provider:'Spotify',type:'profile'}]});
 let row=(await store.feed(viewer)).find(r=>r.id==='guest-one');assert.equal(row.previews.length,2);assert.deepEqual(row.previews.map(p=>p.provider),['Instagram','Spotify']);
 await assert.rejects(store.action('previews',{id:'guest-one'},viewer),e=>e.status===403);
 globalThis.fetch=async()=>{throw Error('metadata blocked')};await store.action('previews',{id:'guest-one'},owner);
 row=(await store.feed(viewer)).find(r=>r.id==='guest-one');assert.equal(row.previews.length,2);assert.ok(row.previews.every(p=>p.metadataAvailable===false));
 await store.action('responder',{id:'guest-one',text:'Reply',requestId:'reply-hidden-0001'},viewer);
 await store.action('ocultar',{id:'guest-one',replyId:'reply-hidden-0001',hidden:true},owner);
 assert.equal((await store.feed(owner)).find(r=>r.id==='guest-one').replyCount,0);
 assert.equal((await store.replies('guest-one',viewer)).items.length,0);
});

test('a legacy entry explicitly confirmed through project maintenance has a badge but grants no admin privilege',async()=>{
 const {store,viewer,people}=setup();people.push({id:'guest-dae193aa26c228f9920a9355c9604aafd427da6b',source:'guest',name:'ogg dono da parada',comment:'salve da korea',presentAt:3000});
 const row=(await store.feed(viewer)).find(r=>r.id==='guest-dae193aa26c228f9920a9355c9604aafd427da6b');assert.equal(row.creator,true);
 await assert.rejects(store.action('editar',{id:row.id,text:'unauthorized'},viewer),e=>e.status===403);
});

test('only owner can edit both social links and Instagram photo, retaining original comments and private audit',async()=>{
 const {store,viewer,owner,files}=setup();globalThis.fetch=async()=>{throw Error('blocked')};
 const body={id:'guest-one',instagramUrl:'@new_social_ogg',spotifyUrl:'https://open.spotify.com/playlist/1234567890123456789012?si=test',instagramImage:'https://scontent.cdninstagram.com/avatar.jpg'};
 await assert.rejects(store.action('links',body,viewer),e=>e.status===403);
 await store.action('links',body,owner);
 const row=(await store.feed(viewer)).find(r=>r.id==='guest-one');
 assert.equal(row.instagramUrl,'https://www.instagram.com/new_social_ogg/');assert.equal(row.spotifyUrl,'https://open.spotify.com/playlist/1234567890123456789012');assert.equal(row.instagramImage,body.instagramImage);
 assert.equal(row.comment,'Original visitor text');assert.equal(row.previews.length,2);assert.equal(row.creator,false);assert.equal(row.url,row.instagramUrl);
 const state=[...files.values()].map(r=>r.value).find(s=>s.audit?.some(a=>a.action==='links'));assert.deepEqual(state.audit.at(-1).before,{instagramUrl:null,spotifyUrl:null,instagramImage:null});assert.equal(state.audit.at(-1).after.instagramUrl,row.instagramUrl);
 await store.action('previews',{id:'guest-one'},owner);assert.deepEqual((await store.feed(viewer)).find(r=>r.id==='guest-one').previews.map(p=>p.url),[row.instagramUrl,row.spotifyUrl]);
 await store.action('links',{id:'guest-one',instagramUrl:'',spotifyUrl:'',instagramImage:''},owner);
 const cleared=(await store.feed(viewer)).find(r=>r.id==='guest-one');assert.equal(cleared.instagramUrl,null);assert.equal(cleared.spotifyUrl,null);assert.deepEqual(cleared.previews,[]);assert.equal(cleared.comment,row.comment);
});
test('social editing rejects unsafe links and arbitrary avatar hosts without changing stored comments',async()=>{
 const {store,viewer,owner}=setup();
 for(const patch of [{instagramUrl:'https://evil.example/'},{spotifyUrl:'https://user:pass@open.spotify.com/user/test'},{instagramUrl:'@name',instagramImage:'https://i.scdn.co/image/not-instagram'},{instagramUrl:'@name',instagramImage:'http://scontent.cdninstagram.com/avatar.jpg'}])
 await assert.rejects(store.action('links',{id:'guest-one',...patch},owner),e=>e.code==='invalid_links');
 const row=(await store.feed(viewer)).find(r=>r.id==='guest-one');assert.equal(row.comment,'Original visitor text');assert.equal(row.instagramUrl,undefined);
});
test('owner can update reply links while keeping real author and text intact',async()=>{
 const {store,viewer,owner}=setup();globalThis.fetch=async()=>{throw Error('blocked')};
 await store.action('responder',{id:'guest-one',text:'Reply stays',requestId:'reply-links-0001'},viewer);
 await store.action('links',{id:'guest-one',replyId:'reply-links-0001',instagramUrl:'@reply_person',spotifyUrl:'user/reply_person'},owner);
 const reply=(await store.replies('guest-one',viewer)).items[0];assert.equal(reply.name,'One');assert.equal(reply.comment,'Reply stays');assert.equal(reply.instagramUrl,'https://www.instagram.com/reply_person/');assert.equal(reply.previews.length,2);
 await assert.rejects(store.action('links',{id:'guest-one',replyId:reply.id,instagramUrl:'@forged'},viewer),e=>e.status===403);
});
