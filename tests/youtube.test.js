import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chooseVideo, durationSeconds, videoSearchQuery } from '../lib/youtube.js';

const track = { id:'1234567890123456789012', title:'Helena Beat', artist:'Foster The People', durationMs:276000 };
const candidate = (id, title, duration='PT4M36S', overrides={}) => ({ id, snippet:{title,channelTitle:'Foster The People',description:'Provided to YouTube by Columbia'}, contentDetails:{duration}, status:{embeddable:true,privacyStatus:'public'}, ...overrides });
test('matching rejects a cover, changed speed, wrong artist, wrong duration, and restricted video', () => {
  const good=candidate('FlBCUzGLce0','Helena Beat');
  const bad=[candidate('aaaaaaaaaaa','Helena Beat cover'),candidate('bbbbbbbbbbb','Helena Beat sped up'),candidate('ccccccccccc','Helena Beat','PT2M'),candidate('ddddddddddd','Helena Beat','PT4M36S',{snippet:{title:'Helena Beat',channelTitle:'Other artist'}}),candidate('eeeeeeeeeee','Helena Beat','PT4M36S',{status:{embeddable:false,privacyStatus:'public'}}),candidate('fffffffffff','Helena Beat','PT4M36S',{contentDetails:{duration:'PT4M36S',contentRating:{ytRating:'ytAgeRestricted'}}})];
  assert.equal(chooseVideo(track,bad),null);
  assert.equal(chooseVideo(track,[...bad,good]),good.id);
  assert.equal(durationSeconds('PT1H2M3S'),3723);
});
test('a remix must match the requested version', () => {
  assert.equal(chooseVideo({...track,title:'Helena Beat - Remix'},[candidate('FlBCUzGLce0','Helena Beat')]),null);
});
test('search uses the main artist without overconstraining a collaboration', () => {
  assert.equal(videoSearchQuery({title:'Mega Tropa do Jon',artist:'DJ Petroski, Dj Dudu, Mc Th, Jon Vlogs',primaryArtist:'DJ Petroski'}),'Mega Tropa do Jon DJ Petroski audio');
  assert.equal(videoSearchQuery({title:'Outra faixa',artist:'Ryu, The Runner, Jovem Dex',primaryArtist:'Ryu, The Runner'}),'Outra faixa Ryu, The Runner audio');
});
test('a short collaboration search still validates title, credited artists and duration', () => {
  const song={title:'Mega Tropa do Jon',artist:'DJ Petroski, Dj Dudu, Mc Th',durationMs:198764};
  const actual={id:'SUjjJ74lj5A',snippet:{title:'MEGA TROPA DO JON - DJ Dudu, DJ Maninho, DJ Petroski, DJ Bruno Marcos',channelTitle:'Petroski'},contentDetails:{duration:'PT3M23S'},status:{embeddable:true,privacyStatus:'public'}};
  assert.equal(chooseVideo(song,[actual]),actual.id);
  assert.equal(chooseVideo(song,[{...actual,snippet:{...actual.snippet,title:'MEGA FUNK SHOW ME LOVE - PETROSKI'}}]),null);
});
function scenario(code) {
  const r=spawnSync(process.execPath,['--input-type=module','-e',`
    const calls=[];const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
    const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(body){this.body=body;return this}});
    ${code}
  `],{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
test('verified same-track mappings work without credentials or an upstream request', () => {
  const r=scenario(`globalThis.fetch=async()=>{throw Error('must not request')};const {default:h}=await import('./api/video.js');const r=response();await h({method:'GET',url:'/api/video?track=4VbDJMkAX3dWNBdn3KH6Wx'},r);console.log(JSON.stringify(r));`);
  assert.equal(r.code,200);assert.equal(r.body.videoId,'FlBCUzGLce0');assert.equal(r.body.match,'verified');
});
test('unconfigured searches degrade honestly without leaking credentials or consuming quota', () => {
  const r=scenario(`delete process.env.YOUTUBE_API_KEY;globalThis.fetch=async()=>{throw Error('must not request')};const {default:h}=await import('./api/video.js');const r=response();await h({method:'GET',url:'/api/video?track=1234567890123456789012'},r);console.log(JSON.stringify(r));`);
  assert.equal(r.body.videoId,null);assert.equal(r.body.reason,'search_not_configured');
});
test('malformed IDs and unsupported methods never contact external services', () => {
  const r=scenario(`globalThis.fetch=async()=>{throw Error('must not request')};const {default:h}=await import('./api/video.js');const a=response(),b=response();await h({method:'GET',url:'/api/video?track=https://evil.example'},a);await h({method:'POST',url:'/api/video'},b);console.log(JSON.stringify({a,b}));`);
  assert.equal(r.a.code,400);assert.equal(r.b.code,405);
});
test('public visitors cannot use the owner key as an arbitrary search proxy', () => {
  const r=scenario(`process.env.YOUTUBE_API_KEY='private-youtube-key';process.env.SPOTIFY_CLIENT_ID='id';process.env.SPOTIFY_CLIENT_SECRET='secret';process.env.SPOTIFY_REFRESH_TOKEN='refresh';globalThis.fetch=async(url)=>{calls.push(String(url));if(String(url).includes('googleapis'))throw Error('must not search');return String(url).includes('/api/token')?json({access_token:'access',expires_in:3600}):json({items:[]})};const {default:h}=await import('./api/video.js');const r=response();await h({method:'GET',url:'/api/video?track=1234567890123456789012'},r);console.log(JSON.stringify({r,calls}));`);
  assert.equal(r.r.code,404);assert.ok(r.calls.every(url=>!url.includes('googleapis')));assert.doesNotMatch(JSON.stringify(r.r),/private-youtube-key/);
});
test('concurrent searches share requests, validate details, and publish no API key', () => {
  const r=scenario(`process.env.YOUTUBE_API_KEY='private-youtube-key';globalThis.fetch=async(url)=>{calls.push(String(url));return String(url).includes('/search?')?json({items:[{id:{videoId:'FlBCUzGLce0'}}]}):json({items:[${JSON.stringify(candidate('FlBCUzGLce0','Helena Beat'))}]})};const {resolveVideo}=await import('./lib/youtube.js');const results=await Promise.all([resolveVideo(${JSON.stringify(track)}),resolveVideo(${JSON.stringify(track)})]);console.log(JSON.stringify({results,calls}));`);
  assert.equal(r.calls.length,2);assert.equal(r.results[0].videoId,'FlBCUzGLce0');assert.doesNotMatch(JSON.stringify(r.results),/private-youtube-key/);
});
