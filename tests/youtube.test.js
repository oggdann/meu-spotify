import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chooseVideo, durationSeconds, videoSearchQuery, videoSearchQueries } from '../lib/youtube.js';

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
  assert.equal(videoSearchQuery({title:'Mega Tropa do Jon',artist:'DJ Petroski, Dj Dudu, Mc Th, Jon Vlogs',primaryArtist:'DJ Petroski'}),'mega tropa do jon dj petroski');
  assert.equal(videoSearchQuery({title:'Outra faixa',artist:'Ryu, The Runner, Jovem Dex',primaryArtist:'Ryu, The Runner'}),'outra faixa ryu the runner');
});
const beijo = {id:'5nCh2luyFsIpFEcw0kdc55',title:'Um Beijo por Minuto (25 Milhões) - Ao Vivo',artist:'Natanzinho Lima',primaryArtist:'Natanzinho Lima',album:'De Bar em Bar 9 (Ao Vivo)',durationMs:191294};
const beijoVideo = {id:'6NfinN3Gg-A',snippet:{title:'Natanzinho Lima - Um Beijo Por Minuto (DE BAR EM BAR 9)',channelTitle:'Natanzinho Lima Oficial',description:''},contentDetails:{duration:'PT3M12S'},status:{embeddable:true,privacyStatus:'public'}};
test('search broadens long live titles without requiring audio or repeating queries', () => {
  assert.deepEqual(videoSearchQueries(beijo),['um beijo por minuto 25 milhoes ao vivo natanzinho lima','um beijo por minuto natanzinho lima','um beijo por minuto']);
  assert.deepEqual(videoSearchQueries(track),['helena beat foster the people','helena beat']);
});
test('the matching live album allows an official video to omit the subtitle and Ao Vivo', () => {
  assert.equal(chooseVideo(beijo,[beijoVideo]),beijoVideo.id);
  const unknownRelease={...beijoVideo,snippet:{...beijoVideo.snippet,title:'Natanzinho Lima - Um Beijo Por Minuto'}};
  assert.equal(chooseVideo(beijo,[unknownRelease]),null);
  assert.equal(chooseVideo(beijo,[{...beijoVideo,contentDetails:{duration:'PT2M52S'}}]),null);
  assert.equal(chooseVideo(beijo,[{...beijoVideo,snippet:{...beijoVideo.snippet,channelTitle:'Different artist',title:'Um Beijo Por Minuto (DE BAR EM BAR 9)'}}]),null);
});
test('Ao Vivo and Live identify the same version while a studio recording is rejected', () => {
  const live={...track,title:'Helena Beat - Ao Vivo'};
  assert.equal(chooseVideo(live,[candidate('FlBCUzGLce0','Helena Beat (Live)')]),'FlBCUzGLce0');
  assert.equal(chooseVideo(live,[candidate('FlBCUzGLce0','Helena Beat')]),null);
  assert.equal(chooseVideo(track,[candidate('FlBCUzGLce0','Helena Beat (Ao Vivo)')]),null);
});
test('part numbers and named remixes stay distinct when title variants are broadened', () => {
  assert.equal(chooseVideo({...track,title:'Helena Beat (Part 2)'},[candidate('FlBCUzGLce0','Helena Beat (Part 1)')]),null);
  assert.equal(chooseVideo({...track,title:'Helena Beat (Artist One Remix)'},[candidate('FlBCUzGLce0','Helena Beat (Artist Two Remix)')]),null);
});
test('official release audio wins over a matching fan lyric upload', () => {
  const fan={...beijoVideo,id:'aaaaaaaaaaa',snippet:{title:beijo.title+' Natanzinho Lima',channelTitle:'Fan Lyrics',description:''}};
  assert.equal(chooseVideo(beijo,[fan,beijoVideo]),beijoVideo.id);
});
test('a short collaboration search still validates title, credited artists and duration', () => {
  const song={title:'Mega Tropa do Jon',artist:'DJ Petroski, Dj Dudu, Mc Th',durationMs:198764};
  const actual={id:'SUjjJ74lj5A',snippet:{title:'MEGA TROPA DO JON - DJ Dudu, DJ Maninho, DJ Petroski, DJ Bruno Marcos',channelTitle:'Petroski'},contentDetails:{duration:'PT3M23S'},status:{embeddable:true,privacyStatus:'public'}};
  assert.equal(chooseVideo(song,[actual]),actual.id);
  assert.equal(chooseVideo(song,[{...actual,snippet:{...actual.snippet,title:'MEGA FUNK SHOW ME LOVE - PETROSKI'}}]),null);
});
test('official topic audio may credit only the main artist in its title and channel', () => {
  const song={title:'Mega Tropa do Jon',primaryArtist:'DJ Petroski',artist:'DJ Petroski, Dj Dudu, Mc Th, Jon Vlogs',durationMs:198764};
  const audio={id:'SUjjJ74lj5A',snippet:{title:'Mega Tropa do Jon',channelTitle:'DJ Petroski - Topic'},contentDetails:{duration:'PT3M23S'},status:{embeddable:true,privacyStatus:'public'}};
  assert.equal(chooseVideo(song,[audio]),audio.id);
  assert.equal(chooseVideo(song,[{...audio,snippet:{title:'Mega Tropa do Jon',channelTitle:'DJ Different - Topic'}}]),null);
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
test('progressive searches deduplicate videos, inspect 50 results and stop on a valid recording', () => {
  const code="process.env.YOUTUBE_API_KEY='private-youtube-key';let searches=0;const good="+JSON.stringify(beijoVideo)+";globalThis.fetch=async(url)=>{const u=new URL(url);calls.push(u.href);if(u.pathname.endsWith('/search')){searches++;return json({items:searches===1?[{id:{videoId:'aaaaaaaaaaa'}}]:[{id:{videoId:'aaaaaaaaaaa'}},{id:{videoId:good.id}}]})}return json({items:u.searchParams.get('id')==='aaaaaaaaaaa'?[{...good,id:'aaaaaaaaaaa',snippet:{...good.snippet,title:good.snippet.title+' cover'}}]:[good]})};const {resolveVideo}=await import('./lib/youtube.js');const result=await resolveVideo("+JSON.stringify(beijo)+");console.log(JSON.stringify({result,calls,searches}));";
  const r=scenario(code);
  assert.equal(r.result.videoId,beijoVideo.id);assert.equal(r.searches,2);
  const requests=r.calls.map(url=>new URL(url));
  assert.ok(requests.filter(u=>u.pathname.endsWith('/search')).every(u=>u.searchParams.get('maxResults')==='50'&&u.searchParams.get('regionCode')==='BR'));
  assert.deepEqual(requests.filter(u=>u.pathname.endsWith('/videos')).map(u=>u.searchParams.get('id')),['aaaaaaaaaaa',beijoVideo.id]);
  assert.doesNotMatch(JSON.stringify(r.result),/private-youtube-key/);
});
test('no-match results share work but expire after five minutes rather than a day', () => {
  const r=scenario("process.env.YOUTUBE_API_KEY='key';let clock=1000;Date.now=()=>clock;globalThis.fetch=async(url)=>{calls.push(String(url));return json({items:[]})};const {resolveVideo}=await import('./lib/youtube.js');const song="+JSON.stringify(beijo)+";await Promise.all([resolveVideo(song),resolveVideo(song)]);const first=calls.length;await resolveVideo(song);const warm=calls.length;clock+=300001;await resolveVideo(song);console.log(JSON.stringify({first,warm,final:calls.length}));");
  assert.equal(r.first,3);assert.equal(r.warm,3);assert.equal(r.final,6);
});
test('upstream quota errors stop the expanded search and suppress immediate retries', () => {
  const r=scenario("process.env.YOUTUBE_API_KEY='key';globalThis.fetch=async(url)=>{calls.push(String(url));return json({error:{message:'quota'}},403)};const {resolveVideo}=await import('./lib/youtube.js');const song="+JSON.stringify(beijo)+";const a=await resolveVideo(song),b=await resolveVideo(song);console.log(JSON.stringify({a,b,count:calls.length}));");
  assert.equal(r.count,1);assert.equal(r.a.reason,'search_unavailable');assert.equal(r.b.reason,'search_unavailable');
});
