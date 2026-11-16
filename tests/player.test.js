import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function playerHarness(fetch) {
  const nodes=new Map(), events=new Map(), videoPlayers=[], timers=new Map();let timerId=0;
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const classes=new Set(), listeners=new Map();
    const n={id,hidden:false,style:{setProperty(){}},listeners,classList:{add(...c){c.forEach(x=>classes.add(x))},remove(...c){c.forEach(x=>classes.delete(x))},contains(c){return classes.has(c)},toggle(c,value){const enabled=value??!classes.has(c);enabled?classes.add(c):classes.delete(c);return enabled}},setAttribute(){},append(){},addEventListener(name,fn){listeners.set(name,fn)}};
    nodes.set(id,n);return n;
  };
  const context=vm.createContext({fetch,AbortSignal,URL,URLSearchParams,console,Response,Element:class {},location:{origin:'https://oggspotify.vercel.app'},navigator:{},window:{scrollTo(){}},matchMedia:()=>({matches:true}),setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId},clearTimeout(id){timers.delete(id)},setInterval(){},document:{hidden:true,body:node('body'),documentElement:node('html'),getElementById:node,createElement:()=>node(Symbol()),createElementNS:()=>node(Symbol()),addEventListener(name,fn){events.set(name,fn)}}});
  context.window=context;
  context.YT={Player:class{
    constructor(id,options){this.options=options;this.plays=0;this.pauses=0;this.loaded=[];videoPlayers.push(this)}
    playVideo(){this.plays++;this.options.events.onStateChange({data:1})}
    pauseVideo(){this.pauses++;this.options.events.onStateChange({data:2})}
    loadVideoById(id){this.loaded.push(id);this.playVideo()}
    cueVideoById(id){this.loaded.push(id)}
  }};
  vm.runInContext(readFileSync('public/app.js','utf8'),context);
  vm.runInContext('onYouTubeIframeAPIReady()',context);
  return {context,node,events,videoPlayers,timers,run:code=>vm.runInContext(code,context)};
}
const content=id=>JSON.stringify({uri:`spotify:track:${id}`,title:'Song'});
const first='1111111111111111111111',second='2222222222222222222222';
const result=id=>new Response(JSON.stringify({videoId:id}));
function attachSpotify(h, {delayReady=false}={}) {
  const listeners=new Map();
  const player={plays:0,pauses:0,created:0,addListener(name,fn){listeners.set(name,fn)},play(){this.plays++;listeners.get('playback_started')?.()},pause(){this.pauses++;listeners.get('playback_update')?.({data:{isPaused:true,isBuffering:false}})},loadEntity(){},emit(name,data){listeners.get(name)?.(data)}};
  h.context.spotifyApi={createController(_element,_options,callback){player.created++;callback(player);if(!delayReady)player.emit('ready')}};
  h.run('onSpotifyIframeApiReady(spotifyApi)');
  return player;
}
test('a slow older match cannot replace the newer selected song',async()=>{
  let completeOld;
  const h=playerHarness(url=>url.includes(first)?new Promise(resolve=>{completeOld=resolve}):Promise.resolve(result('bbbbbbbbbbb')));
  const old=h.run(`selectContent(${content(first)})`);await h.run(`selectContent(${content(second)})`);
  completeOld(result('aaaaaaaaaaa'));await old;
  assert.equal(h.videoPlayers.length,1);assert.equal(h.videoPlayers[0].options.videoId,'bbbbbbbbbbb');
  assert.equal(h.run('state.loadedUri'),`spotify:track:${second}`);
});
test('a song change while the YouTube iframe initializes loads the latest song when ready',async()=>{
  const h=playerHarness(url=>Promise.resolve(result(url.includes(first)?'aaaaaaaaaaa':'bbbbbbbbbbb')));
  await h.run(`selectContent(${content(first)})`);await h.run(`selectContent(${content(second)})`);
  const player=h.videoPlayers[0];player.options.events.onReady();
  assert.deepEqual(player.loaded,['bbbbbbbbbbb']);assert.equal(player.plays,1);
});
test('collapsing YouTube pauses it and does not retry after the visitor pauses',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));
  await h.run(`selectContent(${content(first)})`);const player=h.videoPlayers[0];player.options.events.onReady();
  h.node('collapse-player').listeners.get('click')();
  const plays=player.plays;h.run("unlockOnInteraction({isTrusted:true,type:'click',target:null})");
  assert.equal(h.run('state.wantsAudio'),false);assert.equal(h.run('state.audible'),false);assert.equal(player.plays,plays);assert.ok(player.pauses>0);
});
test('switching to Spotify pauses the YouTube player before hiding its video',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));
  await h.run(`selectContent(${content(first)})`);const player=h.videoPlayers[0];player.options.events.onReady();
  await h.run(`state.preferred='spotify';selectContent(${content(first)})`);
  assert.ok(player.pauses>0);assert.equal(h.node('youtube-player').hidden,true);assert.equal(h.run('state.provider'),'spotify');
});
test('a stalled YouTube stream falls back to Spotify instead of buffering forever',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));
  await h.run(`selectContent(${content(first)})`);const player=h.videoPlayers[0];player.options.events.onReady();
  player.options.events.onStateChange({data:3});
  [...h.timers.values()].find(timer=>timer.ms===15000).fn();
  assert.equal(h.run('state.provider'),'spotify');assert.ok(player.pauses>0);
});
test('explicit YouTube with no match stops Spotify and reports unavailability without switching back',async()=>{
  let complete;
  const h=playerHarness(()=>new Promise(resolve=>{complete=resolve}));const spotify=attachSpotify(h);
  await h.run(`state.preferred='spotify';selectContent(${content(first)})`);
  assert.equal(spotify.plays,1);
  const pending=h.run(`state.preferred='youtube';selectContent(${content(first)})`);
  assert.ok(spotify.pauses>0);assert.equal(h.run('state.audible'),false);
  // Late events from the old iframe cannot revive its sound/state.
  spotify.emit('playback_started');spotify.emit('playback_update',{data:{isPaused:false,isBuffering:false}});
  assert.equal(h.run('state.audible'),false);assert.equal(h.run('state.wantsAudio'),true);
  complete(result(null));await pending;
  assert.equal(h.run('state.provider'),'youtube');assert.equal(h.run('state.unavailable'),true);
  assert.equal(spotify.plays,1);assert.equal(h.node('spotify-player').hidden,true);
  assert.equal(h.node('player-unavailable').hidden,false);
});
test('a manually selected YouTube failure does not silently start Spotify',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));const spotify=attachSpotify(h);
  await h.run(`state.preferred='youtube';selectContent(${content(first)})`);
  const player=h.videoPlayers[0];player.options.events.onReady();player.options.events.onError({data:150});
  assert.equal(h.run('state.unavailable'),true);assert.equal(h.run('state.provider'),'youtube');assert.equal(spotify.created,0);
  assert.equal(h.run('state.audible'),false);assert.ok(player.pauses>0);
  // A late ready/play event from the unavailable video is ignored.
  player.options.events.onReady();player.options.events.onStateChange({data:1});
  assert.equal(h.run('state.audible'),false);
});
test('Spotify is available through an explicit action after a YouTube failure',async()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));const spotify=attachSpotify(h);
  await h.run(`state.preferred='youtube';selectContent(${content(first)})`);
  h.node('use-spotify').listeners.get('click')();
  assert.equal(h.run('state.provider'),'spotify');assert.equal(h.run('state.preferred'),'spotify');
  assert.equal(h.node('player-source').value,'spotify');assert.equal(h.node('player-unavailable').hidden,true);
  assert.equal(spotify.plays,1);
});
test('automatic mode still uses Spotify when there is no YouTube match',async()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));const spotify=attachSpotify(h);
  await h.run(`selectContent(${content(first)})`);
  assert.equal(h.run('state.provider'),'spotify');assert.equal(spotify.plays,1);
});
test('a Spotify ready event during a provider change cannot restart the old song',async()=>{
  let complete;
  const h=playerHarness(()=>new Promise(resolve=>{complete=resolve}));const spotify=attachSpotify(h,{delayReady:true});
  await h.run(`state.preferred='spotify';selectContent(${content(first)})`);
  const pending=h.run(`state.preferred='youtube';selectContent(${content(first)})`);
  spotify.emit('ready');assert.equal(spotify.plays,0);
  complete(result(null));await pending;assert.equal(h.run('state.unavailable'),true);assert.equal(spotify.plays,0);
});
test('the visitor pause in the Spotify iframe is not undone by an unrelated page click',async()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));const spotify=attachSpotify(h);
  await h.run(`state.preferred='spotify';selectContent(${content(first)})`);spotify.pause();
  h.run("unlockOnInteraction({isTrusted:true,type:'click',target:null})");
  assert.equal(h.run('state.wantsAudio'),false);assert.equal(spotify.plays,1);
});
test('the dock names the selected recent song independently of the owner header',async()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));attachSpotify(h);
  h.node('track-title').textContent='Owner song';
  await h.run(`state.preferred='spotify';selectContent({uri:'spotify:track:${first}',title:'Visitor song',artist:'Visitor artist'})`);
  assert.equal(h.node('selected-track').textContent,'NO PLAYER: Visitor song · Visitor artist');
  assert.equal(h.node('track-title').textContent,'Owner song');assert.equal(h.run('state.follow'),false);
});
test('a matched song after an unavailable YouTube selection restores the visible video',async()=>{
  const h=playerHarness(url=>Promise.resolve(result(url.includes(first)?null:'bbbbbbbbbbb')));
  await h.run(`state.preferred='youtube';selectContent(${content(first)})`);
  assert.equal(h.node('youtube-player').hidden,true);
  await h.run(`selectContent(${content(second)})`);
  assert.equal(h.node('player-unavailable').hidden,true);assert.equal(h.node('youtube-player').hidden,false);
  h.videoPlayers[0].options.events.onReady();assert.equal(h.run('state.audible'),true);
});
