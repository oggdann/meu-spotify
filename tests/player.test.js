import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function playerHarness(fetch, {observeVideo=false}={}) {
  const nodes=new Map(), events=new Map(), videoPlayers=[], timers=new Map(), observers=[], windowEvents=new Map();let timerId=0;
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const classes=new Set(), listeners=new Map();
    const n={id,hidden:false,style:{setProperty(){}},listeners,classList:{add(...c){c.forEach(x=>classes.add(x))},remove(...c){c.forEach(x=>classes.delete(x))},contains(c){return classes.has(c)},toggle(c,value){const enabled=value??!classes.has(c);enabled?classes.add(c):classes.delete(c);return enabled}},setAttribute(){},removeAttribute(name){delete this[name]},append(...children){(this.children??=[]).push(...children)},prepend(...children){this.children=[...children,...(this.children||[])]},replaceChildren(...children){this.children=children},addEventListener(name,fn){listeners.set(name,fn)}};
    n.getBoundingClientRect=()=>n.rect||{top:0,left:0,right:320,bottom:320,width:320,height:320};
    nodes.set(id,n);return n;
  };
  const context=vm.createContext({fetch,AbortSignal,URL,URLSearchParams,console,Response,Element:class {},location:{origin:'https://oggspotify.vercel.app'},navigator:{},window:{scrollTo(){}},matchMedia:()=>({matches:true}),setTimeout(fn,ms){timers.set(++timerId,{fn,ms});return timerId},clearTimeout(id){timers.delete(id)},setInterval(){},document:{hidden:true,body:node('body'),documentElement:node('html'),getElementById:node,createElement:()=>node(Symbol()),createElementNS:()=>node(Symbol()),addEventListener(name,fn){events.set(name,fn)},querySelectorAll(){return []}}});
  context.window=context;
  context.innerWidth=390;context.innerHeight=844;
  context.addEventListener=(name,fn)=>windowEvents.set(name,fn);
  context.requestAnimationFrame=fn=>{fn();return 1};
  node('html').clientWidth=390;
  node('player-dock').rect={top:774,left:14,right:376,bottom:834,width:362,height:60};
  if(observeVideo)node('cover-image').rect={top:1000,left:20,right:340,bottom:1320,width:320,height:320};
  if(observeVideo)context.IntersectionObserver=class{constructor(callback){this.callback=callback;observers.push(this)}observe(target){this.target=target}unobserve(){}};
  context.YT={Player:class{
    constructor(id,options){this.options=options;this.plays=0;this.pauses=0;this.loaded=[];videoPlayers.push(this)}
    playVideo(){this.plays++;this.options.events.onStateChange({data:1})}
    pauseVideo(){this.pauses++;this.options.events.onStateChange({data:2})}
    loadVideoById(id){this.loaded.push(id);this.playVideo()}
    cueVideoById(id){this.loaded.push(id)}
  }};
  vm.runInContext(readFileSync('public/app.js','utf8'),context);
  vm.runInContext('onYouTubeIframeAPIReady()',context);
  return {context,node,events,windowEvents,videoPlayers,timers,observers,run:code=>vm.runInContext(code,context)};
}
const content=id=>JSON.stringify({uri:`spotify:track:${id}`,title:'Song'});
const first='1111111111111111111111',second='2222222222222222222222';
const result=id=>new Response(JSON.stringify({videoId:id}));
function attachSpotify(h, {delayReady=false}={}) {
  const listeners=new Map();
  const player={plays:0,pauses:0,created:0,destroys:0,destroy(){this.destroys++},addListener(name,fn){listeners.set(name,fn)},play(){this.plays++;listeners.get('playback_started')?.()},pause(){this.pauses++;listeners.get('playback_update')?.({data:{isPaused:true,isBuffering:false}})},loadEntity(){},emit(name,data){listeners.get(name)?.(data)}};
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
test('compact controls keep the visible video playing and explicit pause is respected',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));
  await h.run(`selectContent(${content(first)})`);const player=h.videoPlayers[0];player.options.events.onReady();
  h.node('collapse-player').listeners.get('click')();
  assert.equal(h.run('state.audible'),true);
  assert.equal(h.node('inline-video-slot').hidden,false);
  h.node('dock-play').listeners.get('click')();
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
test('initial listening attempts autoplay with both YouTube and Spotify',async()=>{
  const youtube=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));
  await youtube.run('selectContent('+content(first)+',{follow:true,automatic:true})');
  const video=youtube.videoPlayers[0];assert.equal(video.options.playerVars.autoplay,1);
  video.options.events.onReady();assert.ok(video.plays>0);assert.equal(youtube.run('state.audible'),true);
  const spotify=playerHarness(()=>Promise.resolve(result(null)));const player=attachSpotify(spotify);
  await spotify.run("state.preferred='spotify';selectContent("+content(first)+",{follow:true,automatic:true})");
  assert.equal(player.plays,1);assert.equal(spotify.run('state.audible'),true);
});
test('a negative browser match expires and can find a newly available video',async()=>{
  let calls=0;
  const h=playerHarness(()=>Promise.resolve(result(++calls===1?null:'aaaaaaaaaaa')));
  h.run('let clock=1000;Date.now=()=>clock');
  await h.run('findVideo('+content(first)+')');await h.run('findVideo('+content(first)+')');assert.equal(calls,1);
  h.run('clock+=60001');const found=await h.run('findVideo('+content(first)+')');
  assert.equal(found.videoId,'aaaaaaaaaaa');assert.equal(calls,2);
});
test('the visitor login stays on Spotify and follows the selected song',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));attachSpotify(h);
  await h.run("state.preferred='spotify';selectContent("+content(first)+")");
  assert.equal(h.node('spotify-access').hidden,false);
  let url=new URL(h.node('spotify-login-link').href);
  assert.equal(url.origin,'https://accounts.spotify.com');
  assert.equal(url.searchParams.get('continue'),'https://open.spotify.com/track/'+first);
  await h.run("state.preferred='youtube';selectContent("+content(second)+")");
  assert.equal(h.node('spotify-access').hidden,true);
  url=new URL(h.node('spotify-login-link').href);
  assert.equal(url.searchParams.get('continue'),'https://open.spotify.com/track/'+second);
});
test('retrying after visitor login recreates the Spotify player and autoplays the same selection',async()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));const player=attachSpotify(h);
  await h.run("state.preferred='spotify';selectContent("+content(first)+",{follow:true})");
  h.node('spotify-retry').listeners.get('click')();
  assert.equal(player.destroys,1);assert.equal(player.created,2);assert.equal(player.plays,2);
  assert.equal(h.run('state.selected.uri'),'spotify:track:'+first);assert.equal(h.run('state.follow'),true);
});
test('cover colors remain readable and genuinely differ for different cover pixels',()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));
  const red=h.run('coverPalette([230,20,20,255,200,15,15,255])');
  const blue=h.run('coverPalette([20,20,230,255,15,15,200,255])');
  assert.ok(red.accent[0]>red.accent[2]);assert.ok(blue.accent[2]>blue.accent[0]);
  assert.ok([...red.accent,...blue.accent].every(value=>value>=165&&value<=245));
  assert.ok(red.background.every(value=>value<=17));
});
test('playlist origin is linked when present and removed when playback leaves the playlist',async()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));attachSpotify(h);
  const data={hasTrack:true,isPlaying:true,uri:'spotify:track:'+first,title:'Owner song',artist:'Artist',durationMs:180000,checkedAt:Date.now(),playlist:{id:second,name:'OGG public list',url:'https://open.spotify.com/playlist/'+second}};
  h.context.playback=data;h.run('renderNow(playback)');
  assert.equal(h.node('owner-playlist').hidden,false);
  assert.equal(h.node('owner-playlist-name').textContent,'OGG public list');
  assert.equal(h.node('owner-playlist-link').href,data.playlist.url);
  h.context.playback={...data,playlist:null};h.run('renderNow(playback)');
  assert.equal(h.node('owner-playlist').hidden,true);assert.equal(h.node('owner-playlist-name').textContent,'');
});
test('initial autoplay keeps the player compact in both providers',async()=>{
  for(const provider of ['youtube','spotify']){
    const h=playerHarness(()=>Promise.resolve(result(provider==='youtube'?'aaaaaaaaaaa':null)));
    const spotify=attachSpotify(h);
    await h.run("state.preferred='"+provider+"';selectContent("+content(first)+",{follow:true,automatic:true})");
    if(provider==='youtube')h.videoPlayers[0].options.events.onReady();
    assert.equal(h.node('player-dock').classList.contains('collapsed'),true);
    assert.equal(h.run('state.audible'),true);
    assert.equal(h.node('body').classList.contains('player-collapsed'),true);
  }
});
test('initial autoplay waits for the cover and does not cover the mobile entrance with a floating player',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')),{observeVideo:true});
  await h.run(`selectContent(${content(first)},{automatic:true})`);
  const player=h.videoPlayers[0];player.options.events.onReady();
  assert.equal(player.plays,0);
  assert.equal(h.node('inline-video-slot').classList.contains('is-floating'),false);
  h.node('cover-image').rect={top:100,left:20,right:340,bottom:420,width:320,height:320};h.run('document.hidden=false;placeYouTube()');
  assert.equal(player.plays,1);
});
test('scrolling on mobile or desktop floats the same YouTube iframe without pausing or restarting it',async()=>{
  for(const width of [390,1360]){
    const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));
    h.node('html').clientWidth=width;
    await h.run(`selectContent(${content(first)})`);const player=h.videoPlayers[0];player.options.events.onReady();
    const plays=player.plays,pauses=player.pauses,loaded=player.loaded.length;
    h.node('cover-image').rect={top:-500,left:20,right:340,bottom:-180,width:320,height:320};h.windowEvents.get('scroll')();
    assert.equal(h.node('inline-video-slot').classList.contains('is-floating'),true);
    assert.equal(h.run('state.audible'),true);assert.equal(player.pauses,pauses);assert.equal(player.plays,plays);assert.equal(player.loaded.length,loaded);
    h.node('cover-image').rect={top:100,left:20,right:340,bottom:420,width:320,height:320};h.windowEvents.get('scroll')();
    assert.equal(h.node('inline-video-slot').classList.contains('is-floating'),false);assert.equal(h.videoPlayers.length,1);assert.equal(player.pauses,pauses);
  }
});
test('closing the floating video pauses intentionally and unrelated clicks do not restart it',async()=>{
  const h=playerHarness(()=>Promise.resolve(result('aaaaaaaaaaa')));
  await h.run(`selectContent(${content(first)})`);const player=h.videoPlayers[0];player.options.events.onReady();
  h.node('cover-image').rect={top:-500,left:20,right:340,bottom:-180,width:320,height:320};h.windowEvents.get('scroll')();
  h.node('mini-video-close').listeners.get('click')();const plays=player.plays;
  h.run("unlockOnInteraction({isTrusted:true,type:'click',target:null})");
  assert.equal(h.run('state.wantsAudio'),false);assert.equal(h.run('state.audible'),false);assert.equal(h.node('inline-video-slot').classList.contains('is-floating'),false);assert.equal(player.plays,plays);
  h.node('dock-play').listeners.get('click')();assert.equal(h.node('inline-video-slot').classList.contains('is-floating'),true);assert.equal(h.run('state.audible'),true);
});
test('Spotify-only statistics ignore old collector payloads and never ask for local activation',()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));
  h.context.stats={sampleSize:50,recentAvailability:'ready',periods:[{days:7,plays:12,trackCount:8,minutes:null,artists:[],tracks:[]}],top:{availability:'permission_required'},measured:{periods:[{days:7,minutes:9999,plays:999}]}};
  h.run('statsPeriod=7;renderStats(stats)');
  assert.equal(h.node('stats-plays').textContent,'12');
  assert.equal(h.node('stats-track-count').textContent,'8');
  assert.equal(h.node('stats-metrics').hidden,false);
  assert.match(h.node('stats-context').textContent,/recorte/);
  assert.match(h.node('stats-footnote').textContent,/não é disponibilizado/);
  assert.doesNotMatch(h.node('stats-footnote').textContent,/coletor|instala|ativação|começa com o monitoramento/);
});
test('official four-week Spotify rankings show without misleading sample totals or minute placeholders',()=>{
  const h=playerHarness(()=>Promise.resolve(result(null)));
  h.context.stats={recentAvailability:'ready',sampleSize:50,periods:[{days:30,plays:50,trackCount:42}],top:{availability:'ready',artists:[],tracks:[]}};
  h.run('statsPeriod=30;renderStats(stats)');
  assert.equal(h.node('stats-metrics').hidden,true);
  assert.match(h.node('stats-context').textContent,/oficial.*4 semanas/);
  assert.match(h.node('stats-disclosure').textContent,/atualizados automaticamente/);
});
