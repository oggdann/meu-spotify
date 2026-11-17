import test from 'node:test';import assert from 'node:assert/strict';
import {createCreatorTicket,verifyCreatorTicket,createCreatorHandler} from '../lib/creator-login.js';
import {createPresenceHandler,communityIdentity} from '../lib/presence.js';
process.env.OGG_CREATOR_LOGIN_KEY='test-only-owner-login-key-at-least-32-characters';process.env.OGG_PRESENCE_SECRET='test-only-presence-secret-never-production';
const response=()=>({code:200,headers:{},status(n){this.code=n;return this;},setHeader(k,v){this.headers[k]=v;},json(v){this.body=v;return this;}});
test('creator tickets expire, reject tampering, have a separate purpose and never expose the signing key',()=>{
 const now=Date.now(),ticket=createCreatorTicket(now);assert.ok(verifyCreatorTicket(ticket,now));assert.equal(verifyCreatorTicket(ticket,now+600001),null);assert.equal(verifyCreatorTicket(ticket,now-1),null);assert.equal(verifyCreatorTicket(ticket+'x',now),null);assert.equal(verifyCreatorTicket(ticket+'.extra',now),null);assert.doesNotMatch(ticket,/test-only-owner/);
});
test('creator login rejects cross-site, malformed and replayed tickets without issuing unauthorized sessions',async()=>{
 let issued=0;const used=new Set(),handler=createCreatorHandler({consume:async nonce=>{if(used.has(nonce))return false;used.add(nonce);return true;},issue:()=>issued++}),ticket=createCreatorTicket();
 for(const req of [{method:'GET'},{method:'POST',headers:{origin:'https://evil.example'},body:{token:ticket}},{method:'POST',headers:{origin:'https://oggspotify.vercel.app'},body:{token:'invalid'}}]){const r=response();await handler(req,r);assert.ok([403,405].includes(r.code));}assert.equal(issued,0);
 const req={method:'POST',headers:{origin:'https://oggspotify.vercel.app'},body:{token:ticket}},a=response(),b=response();await handler(req,a);await handler(req,b);assert.equal(a.code,200);assert.equal(b.code,403);assert.equal(issued,1);
});
test('private owner login creates the existing signed owner session without any Spotify API call',async()=>{
 let network=0;const original=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Spotify must not be called');};
 try{let consumed=false;const handler=createPresenceHandler({creatorConsume:async()=>!consumed&&(consumed=true)}),res=response();await handler({method:'POST',url:'/api/presenca?acao=criador',headers:{origin:'https://oggspotify.vercel.app'},body:{token:createCreatorTicket()}},res);
 assert.equal(res.code,200);assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);assert.match(res.headers['Set-Cookie'],/Max-Age=86400/);
 const req={headers:{cookie:res.headers['Set-Cookie'].split(';')[0]}},identity=communityIdentity(req);assert.equal(identity.isOwner,true);assert.equal(identity.userId,'dq78sjzflg084c1ibpjuo8gjc');assert.equal(network,0);
 const me=response();await handler({...req,method:'GET',url:'/api/presenca?acao=eu'},me);assert.equal(me.body.owner,true);assert.equal(identity.valid(me.body.csrf),true);
 }finally{globalThis.fetch=original;}
});
test('a storage failure never grants owner access',async()=>{let issued=false;const h=createCreatorHandler({consume:async()=>{throw Error('storage unavailable');},issue:()=>issued=true}),r=response();await h({method:'POST',headers:{origin:'https://oggspotify.vercel.app'},body:{token:createCreatorTicket()}},r);assert.equal(r.code,503);assert.equal(issued,false);});
