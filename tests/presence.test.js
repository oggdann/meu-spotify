import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresenceHandler,presenceCallback,publicVisitor} from '../lib/presence.js';
process.env.OGG_PRESENCE_SECRET='test-presence-secret-for-this-process';
process.env.SPOTIFY_CLIENT_ID='test-client';
process.env.SPOTIFY_CLIENT_SECRET='test-secret';
const root='https://oggspotify.vercel.app';
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(value){this.body=value;return this},redirect(n,url){this.code=n;this.url=url;return this}});
const req=(action,options={})=>({method:'GET',url:'/api/presenca?acao='+action,headers:{},...options});
const visitor={id:'visitor-123',display_name:'Visitante',images:[{url:'https://i.scdn.co/image/avatar'}],external_urls:{spotify:'https://open.spotify.com/user/visitor-123'},email:'must-not-leak@example.com',country:'BR',product:'premium'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
async function start(){const h=createPresenceHandler();const r=response();await h(req('entrar'),r);return {cookie:r.headers['Set-Cookie'].split(';')[0],state:new URL(r.url).searchParams.get('state'),redirect:new URL(r.url)};}
async function login(){
  const s=await start();let calls=0;
  globalThis.fetch=async()=>++calls===1?json({access_token:'guest-access-token',refresh_token:'discard-this-refresh'}):json(visitor);
  const r=response();await presenceCallback({method:'GET',url:'/api/retorno?code=guest-code&state='+s.state,headers:{cookie:s.cookie}},r);
  return {cookie:r.headers['Set-Cookie'].find(value=>value.startsWith('__Host-ogg-presence=')).split(';')[0],r};
}
test('only public visitor fields are published and arbitrary image URLs are rejected',()=>{
  const publicProfile=publicVisitor({...visitor,images:[{url:'https://attacker.example/image'}]});
  assert.equal(publicProfile.image,null);assert.equal(publicProfile.name,'Visitante');
  assert.doesNotMatch(JSON.stringify(publicProfile),/email|country|product|must-not-leak/);
});
test('visitor login uses PKCE, a signed ten-minute state cookie and the existing callback',async()=>{
  const s=await start();assert.equal(s.redirect.origin,'https://accounts.spotify.com');
  assert.equal(s.redirect.searchParams.get('redirect_uri'),root+'/api/retorno');
  assert.equal(s.redirect.searchParams.get('code_challenge_method'),'S256');
  assert.match(s.state,/^presence\./);assert.ok(s.cookie.startsWith('__Host-ogg-presence-state='));
});
test('invalid OAuth state never exchanges a code',async()=>{
  const s=await start();let calls=0;globalThis.fetch=()=>{calls++;throw Error('not expected')};
  const r=response();await presenceCallback({url:'/api/retorno?code=code&state=presence.wrong',headers:{cookie:s.cookie}},r);
  assert.equal(calls,0);assert.match(r.url,/conexao-expirada/);
});
test('successful guest login never changes owner credentials or automatically publishes a presence',async()=>{
  process.env.SPOTIFY_REFRESH_TOKEN='owner-token-unchanged';
  const s=await login();assert.equal(process.env.SPOTIFY_REFRESH_TOKEN,'owner-token-unchanged');
  const h=createPresenceHandler({store:()=>{throw Error('must not publish on login')}}),r=response();
  await h(req('eu',{headers:{cookie:s.cookie}}),r);
  assert.equal(r.body.profile.id,visitor.id);assert.ok(r.body.csrf);
  assert.doesNotMatch(JSON.stringify(r.body)+s.cookie,/guest-access-token|discard-this-refresh|must-not-leak/);
  assert.equal(r.headers['Cache-Control'],'no-store');
});
test('presence writes require a real signed session, same origin and CSRF; removal only targets the signed-in user',async()=>{
  const s=await login(), calls=[];
  const h=createPresenceHandler({store:()=>({mark:async(profile,key)=>{calls.push(['mark',profile,key]);return [profile]},removePresence:async key=>{calls.push(['remove',key]);return []}})});
  const me=response();await h(req('eu',{headers:{cookie:s.cookie}}),me);
  for(const headers of [{origin:root},{origin:'https://attacker.example',cookie:s.cookie},{origin:root,cookie:s.cookie+'tampered'}]){
    const r=response();await h(req('marcar',{method:'POST',headers,body:{csrf:me.body.csrf,id:'other'}}),r);assert.equal(r.code,403);
  }
  const headers={origin:root,cookie:s.cookie};
  const bad=response();await h(req('marcar',{method:'POST',headers,body:{csrf:'wrong'}}),bad);assert.equal(bad.code,403);
  for(const action of ['marcar','remover']){const r=response();await h(req(action,{method:'POST',headers,body:{csrf:me.body.csrf,id:'other'}}),r);assert.equal(r.code,200);}
  assert.equal(calls[0][1].id,visitor.id);assert.equal(calls[0][2],calls[1][1]);assert.match(calls[0][2],/^[a-f0-9]{64}$/);
});
test('development-mode denial returns an explanatory result without a visitor session',async()=>{
  const s=await start();let calls=0;globalThis.fetch=async()=>++calls===1?json({access_token:'guest'}):json({error:'not allowlisted'},403);
  const r=response();await presenceCallback({url:'/api/retorno?code=code&state='+s.state,headers:{cookie:s.cookie}},r);
  assert.match(r.url,/conta-nao-liberada/);assert.equal(typeof r.headers['Set-Cookie'],'string');
});
