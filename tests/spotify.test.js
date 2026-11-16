import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const common = `
process.env.SPOTIFY_CLIENT_ID='test-client';process.env.SPOTIFY_CLIENT_SECRET='never-public-secret';process.env.SPOTIFY_REFRESH_TOKEN='never-public-refresh';
const calls=[];
const track={type:'track',id:'1234567890123456789012',name:'Test song',artists:[{name:'Test artist'}],album:{name:'Test album',images:[]},external_urls:{spotify:'https://open.spotify.com/track/1234567890123456789012'},duration_ms:180000};
const response=()=>({code:200,headers:{},status(n){this.code=n;return this},setHeader(k,v){this.headers[k]=v},json(body){this.body=body;return this}});
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers});
`;
function scenario(code) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', common + code], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
test('current song survives missing artwork and never publishes credentials; token and snapshot are reused', () => {
  const r = scenario(`
  globalThis.fetch=async(url,options)=>{calls.push({url,timeout:!!options.signal});return url.includes('/api/token')?json({access_token:'never-public-access',expires_in:3600}):json({is_playing:true,item:track,progress_ms:1000})};
  const {default:handler}=await import('./api/musica.js');const a=response(),b=response();await Promise.all([handler({method:'GET'},a),handler({method:'GET'},b)]);
  console.log(JSON.stringify({a,b,calls}));`);
  assert.equal(r.a.code, 200); assert.equal(r.a.body.isPlaying, true); assert.equal(r.a.body.albumImageUrl, null);
  assert.equal(r.calls.length, 2); assert.ok(r.calls.every(c => c.timeout));
  assert.doesNotMatch(JSON.stringify(r.a.body), /never-public/);
});
test('revoked refresh credential is a service error and never sends Bearer undefined', () => {
  const r = scenario(`globalThis.fetch=async(url)=>{calls.push(url);return json({error:'invalid_grant'},400)};const {default:h}=await import('./api/musica.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify({r,calls}));`);
  assert.equal(r.r.code, 503); assert.equal(r.r.body.error, 'authorization_required'); assert.equal(r.calls.length, 1);
});
test('upstream rate limiting honors Retry-After and suppresses repeated calls during cooldown', () => {
  const r = scenario(`globalThis.fetch=async(url)=>{calls.push(url);return url.includes('/api/token')?json({access_token:'test',expires_in:3600}):json({error:'limited'},429,{'Retry-After':'25'})};const {default:h}=await import('./api/musica.js');const a=response(),b=response();await h({method:'GET'},a);await h({method:'GET'},b);console.log(JSON.stringify({a,b,calls}));`);
  assert.equal(r.a.code, 503); assert.equal(r.a.headers['Retry-After'], '25'); assert.equal(r.b.code, 503); assert.equal(r.calls.length, 2);
});
test('unsupported HTTP methods do not call Spotify', () => {
  const r = scenario(`globalThis.fetch=async()=>{throw Error('must not call')};const {default:h}=await import('./api/musica.js');const r=response();await h({method:'POST'},r);console.log(JSON.stringify(r));`);
  assert.equal(r.code, 405); assert.equal(r.headers.Allow, 'GET, HEAD');
});
test('library shows only the two selected playlists and survives Spotify quota exhaustion',()=>{
  const r=scenario(`globalThis.fetch=async(url)=>{calls.push(url);if(url.includes('/oembed?'))return json({title:'Minha playlist',thumbnail_url:'https://i.scdn.co/image/cover'});if(url.includes('/api/token'))return json({access_token:'test',expires_in:3600,scope:'user-read-recently-played'});return json({error:{reason:'QUOTA_EXCEEDED'}},429,{'Retry-After':'7200'})};const {default:h}=await import('./api/biblioteca.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify({r,calls}));`);
  assert.equal(r.r.code,200);assert.deepEqual(r.r.body.playlists.map(p=>p.id),['306AubstP6UatfIUhynAX8','5Q6OaPkyTIu8CaZSg4fwVr']);assert.equal(r.r.body.availability.playlists,'ready');assert.equal(r.r.body.retryAfter,0);assert.equal(r.r.body.availability.recent,'quota_exceeded');assert.ok(r.calls.every(url=>!url.includes('/me/playlists')));assert.doesNotMatch(JSON.stringify(r.r.body),/never-public|access_token/);
});
test('missing history permission preserves the selected playlists without querying history',()=>{
  const r=scenario(`globalThis.fetch=async(url)=>{calls.push(url);if(url.includes('/oembed?'))return json({title:'Seleção'});if(url.includes('/api/token'))return json({access_token:'test',expires_in:3600,scope:'user-read-currently-playing'});return json({id:'owner',display_name:'OGG'});};const {default:h}=await import('./api/biblioteca.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify({r,calls}));`);
  assert.equal(r.r.body.playlists.length,2);assert.equal(r.r.body.availability.recent,'permission_required');assert.ok(r.calls.every(url=>!url.includes('recently-played')));
});
test('resource and public URL validation reject credential forwarding and executable links', () => {
  const r = scenario(`const {spotifyGet,spotifyUrl,imageUrl}=await import('./lib/spotify.js');let rejected=false;try{await spotifyGet('//evil.example/path')}catch{rejected=true}console.log(JSON.stringify({rejected,bad:spotifyUrl('javascript:alert(1)'),badImage:imageUrl('https://scdn.co.evil.example/image'),good:spotifyUrl('https://open.spotify.com/track/123')}));`);
  assert.equal(r.rejected, true); assert.equal(r.bad, null); assert.equal(r.badImage, null); assert.ok(r.good);
});
test('playlist descriptions decode display entities without keeping markup', () => {
  const r = scenario(`const {plainDescription}=await import('./lib/spotify.js');console.log(JSON.stringify({value:plainDescription('since&gt;11&#x2F;05&#x2F;2026 &amp; som &lt;script&gt;ignored&lt;/script&gt;')}));`);
  assert.equal(r.value, 'since>11/05/2026 & som ignored');
});
test('current playback publishes a verified public playlist without raw context or private metadata',()=>{
  const r=scenario("const id='2222222222222222222222';globalThis.fetch=async(url)=>{calls.push(url);if(url.includes('/api/token'))return json({access_token:'access',expires_in:3600});if(url.includes('/playlists/'))return json({id,name:'OGG public list',public:true,owner:{email:'private@example.com'},description:'not needed'});return json({is_playing:true,item:track,context:{type:'playlist',uri:'spotify:playlist:'+id,href:'private-context-data'}})};const {default:h}=await import('./api/musica.js');const a=response(),b=response();await Promise.all([h({method:'GET'},a),h({method:'GET'},b)]);console.log(JSON.stringify({a,count:calls.length}));");
  assert.equal(r.a.body.playlist.name,'OGG public list');assert.equal(r.a.body.playlist.url,'https://open.spotify.com/playlist/2222222222222222222222');
  assert.equal(r.count,3);assert.doesNotMatch(JSON.stringify(r.a.body),/private@example|private-context|not needed|access_token/);
});
test('private playlist names and identifiers never appear in public playback responses',()=>{
  const r=scenario("const id='9999999999999999999999';globalThis.fetch=async(url)=>url.includes('/api/token')?json({access_token:'access',expires_in:3600}):url.includes('/playlists/')?json({id,name:'PRIVATE PLAYLIST',public:false}):json({is_playing:true,item:track,context:{type:'playlist',uri:'spotify:playlist:'+id}});const {default:h}=await import('./api/musica.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify(r));");
  assert.equal(r.body.playlist,null);assert.equal(r.body.isPlaying,true);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE|9999999999999999999999/);
});
test('a failed playlist lookup leaves the current song working',()=>{
  const r=scenario("globalThis.fetch=async(url)=>url.includes('/api/token')?json({access_token:'access',expires_in:3600}):url.includes('/playlists/')?json({error:'unavailable'},503):json({is_playing:true,item:track,context:{type:'playlist',uri:'spotify:playlist:2222222222222222222222'}});const {default:h}=await import('./api/musica.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify(r));");
  assert.equal(r.code,200);assert.equal(r.body.playlist,null);assert.equal(r.body.title,'Test song');
});
test('quota exhaustion preserves the full provider wait and suppresses queries with different limits',()=>{
  const r=scenario(`globalThis.fetch=async(url)=>{calls.push(url);return url.includes('/api/token')?json({access_token:'test',expires_in:3600}):json({error:{reason:'QUOTA_EXCEEDED'}},429,{'Retry-After':'7200'})};const {spotifyGet}=await import('./lib/spotify.js');const errors=[];for(const path of ['/me/player/recently-played?limit=50','/me/player/recently-played?limit=30']){try{await spotifyGet(path)}catch(e){errors.push({code:e.code,wait:e.retryAfter})}}console.log(JSON.stringify({errors,count:calls.length}));`);
  assert.equal(r.count,2);assert.ok(r.errors.every(e=>e.code==='quota_exceeded'&&e.wait===7200));
});
test('a previous snapshot survives temporary quota failure and is labelled stale',()=>{
  const r=scenario(`let clock=1000;Date.now=()=>clock;let limited=false;globalThis.fetch=async(url)=>url.includes('/api/token')?json({access_token:'test',expires_in:3600}):limited?json({error:{reason:'QUOTA_EXCEEDED'}},429,{'Retry-After':'7200'}):json({items:[{id:'saved'}]});const {spotifyGet}=await import('./lib/spotify.js');await spotifyGet('/me/top/tracks');clock+=7200001;limited=true;const data=await spotifyGet('/me/top/tracks');console.log(JSON.stringify(data));`);
  assert.equal(r.items[0].id,'saved');assert.equal(r.__oggCache.stale,true);assert.equal(r.__oggCache.reason,'quota_exceeded');
});
test('selected playlist metadata refreshes names and covers after ten minutes without credentials',()=>{
  const r=scenario(`let clock=1000;Date.now=()=>clock;let version=1;globalThis.fetch=async(url)=>{calls.push(url);return json({title:'Nome '+version,thumbnail_url:'https://i.scdn.co/image/cover'+version})};const {featuredPlaylists}=await import('./lib/featured-playlists.js');const first=await featuredPlaylists();clock+=60001;await featuredPlaylists();const warm=calls.length;version=2;clock+=600001;const updated=await featuredPlaylists();console.log(JSON.stringify({first,updated,warm,count:calls.length}));`);
  assert.equal(r.warm,2);assert.equal(r.count,4);assert.equal(r.first.items[0].name,'Nome 1');assert.equal(r.updated.items[0].name,'Nome 2');assert.match(r.updated.items[0].image,/cover2$/);
});
test('selected playlist links remain available when metadata cannot be fetched',()=>{
  const r=scenario(`globalThis.fetch=async()=>{throw Error('offline')};const {featuredPlaylists}=await import('./lib/featured-playlists.js');console.log(JSON.stringify(await featuredPlaylists()));`);
  assert.equal(r.items.length,2);assert.equal(r.stale,true);assert.ok(r.items.every(p=>p.url.startsWith('https://open.spotify.com/playlist/')&&p.total===null));
});
