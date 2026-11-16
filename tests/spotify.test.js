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
test('library only publishes owned public playlists and public profile fields', () => {
  const r = scenario(`globalThis.fetch=async(url)=>{
    if(url.includes('/api/token'))return json({access_token:'never-public-access',scope:'user-read-currently-playing user-read-recently-played',expires_in:3600});
    if(url.endsWith('/me'))return json({id:'owner',display_name:'OGG',email:'private@example.com',country:'BR',product:'premium',images:[],external_urls:{spotify:'https://open.spotify.com/user/owner'}});
    if(url.includes('/me/playlists'))return json({items:[{id:'1111111111111111111111',name:'Public',public:true,owner:{id:'owner'},description:'<b>Good</b>',tracks:{total:2}},{id:'2222222222222222222222',name:'Private',public:false,owner:{id:'owner'}},{id:'3333333333333333333333',name:'Other owner',public:true,owner:{id:'other'}}],next:null});
    return json({items:[{track,played_at:'2026-11-15T20:00:00Z'}]});};
    const {default:h}=await import('./api/biblioteca.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify(r));`);
  assert.equal(r.code, 200); assert.equal(r.body.playlists.length, 1); assert.equal(r.body.playlists[0].description, 'Good');
  assert.equal(r.body.recent.length, 1); assert.doesNotMatch(JSON.stringify(r.body), /private@example|premium|never-public/);
});
test('missing history permission leaves profile and playlists working', () => {
  const r = scenario(`globalThis.fetch=async(url)=>{calls.push(url);if(url.includes('/api/token'))return json({access_token:'test',scope:'user-read-currently-playing',expires_in:3600});if(url.endsWith('/me'))return json({id:'owner',display_name:'OGG'});if(url.includes('recently-played'))throw Error('must not request');return json({items:[],next:null});};const {default:h}=await import('./api/biblioteca.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify({r,calls}));`);
  assert.equal(r.r.code, 200); assert.equal(r.r.body.availability.recent, 'permission_required'); assert.equal(r.calls.length, 3);
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
