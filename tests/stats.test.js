import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { summarizeRecent } from '../api/estatisticas.js';

const now = Date.parse('2026-11-16T12:00:00Z');
const track = { type:'track', id:'1111111111111111111111', name:'Song', artists:[{id:'2222222222222222222222',name:'Artist'}],duration_ms:180000,album:{name:'Album',images:[]},external_urls:{spotify:'https://open.spotify.com/track/1111111111111111111111'} };
const row = days => ({track,played_at:new Date(now-days*86400000).toISOString()});
test('weekly and monthly samples deduplicate records and never claim exact listened minutes',()=>{
  const periods=summarizeRecent([row(1),row(1),row(9),row(35),{...row(1),played_at:'bad'},row(-1)],now);
  assert.equal(periods[0].plays,1);assert.equal(periods[1].plays,2);
  assert.equal(periods[0].estimatedMinutes,3);assert.equal(periods[1].estimatedMinutes,6);
  assert.equal(periods[1].tracks[0].count,2);assert.equal(periods[1].artists[0].count,2);
  assert.ok(periods.every(period=>period.sampleOnly&&!Object.hasOwn(period,'exactMinutes')));
});
test('empty periods have no fabricated ranking or playback records',()=>{
  const periods=summarizeRecent([],now);
  assert.deepEqual(periods.map(period=>[period.plays,period.estimatedMinutes,period.tracks.length,period.artists.length]),[[0,0,0,0],[0,0,0,0]]);
});
function scenario(body){
  const code="process.env.SPOTIFY_CLIENT_ID='id';process.env.SPOTIFY_CLIENT_SECRET='never-public-secret';process.env.SPOTIFY_REFRESH_TOKEN='never-public-refresh';const json=(data,status=200)=>new Response(JSON.stringify(data),{status});const calls=[];const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(data){this.body=data;return this}});"+body;
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
test('missing top permission keeps recent statistics available without unauthorized top calls',()=>{
  const r=scenario("globalThis.fetch=async(url)=>{calls.push(url);return url.includes('/api/token')?json({access_token:'access',scope:'user-read-recently-played',expires_in:3600}):json({items:["+JSON.stringify(row(1))+"]})};const {default:h}=await import('./api/estatisticas.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify({r,calls}));");
  assert.equal(r.r.code,200);assert.equal(r.r.body.recentAvailability,'ready');assert.equal(r.r.body.top.availability,'permission_required');
  assert.equal(r.r.body.exactMinutesAvailability,'extended_history_required');
  assert.ok(r.calls.every(url=>!url.includes('/me/top/')));
  assert.doesNotMatch(JSON.stringify(r.r.body),/never-public|access_token/);
});
test('authorized four-week rankings expose only public artist and track fields',()=>{
  const r=scenario("globalThis.fetch=async(url)=>{if(url.includes('/api/token'))return json({access_token:'access',scope:'user-read-recently-played user-top-read',expires_in:3600});if(url.includes('/top/artists'))return json({items:[{id:'2222222222222222222222',name:'Artist',external_urls:{spotify:'https://open.spotify.com/artist/2222222222222222222222'},private:'must-not-leak'}]});if(url.includes('/top/tracks'))return json({items:["+JSON.stringify(track)+"]});return json({items:[]})};const {default:h}=await import('./api/estatisticas.js');const r=response();await h({method:'GET'},r);console.log(JSON.stringify(r));");
  assert.equal(r.body.top.availability,'ready');assert.equal(r.body.top.period,'last_four_weeks');assert.equal(r.body.top.artists[0].name,'Artist');
  assert.equal(r.body.top.tracks[0].title,'Song');assert.doesNotMatch(JSON.stringify(r.body),/must-not-leak|never-public/);
});
