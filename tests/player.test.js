import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function playerHarness(fetch) {
  const nodes=new Map(), events=new Map(), videoPlayers=[];
  const node=id=>{
    if(nodes.has(id))return nodes.get(id);
    const classes=new Set(), listeners=new Map();
    const n={id,hidden:false,style:{setProperty(){}},listeners,classList:{add(...c){c.forEach(x=>classes.add(x))},remove(...c){c.forEach(x=>classes.delete(x))},contains(c){return classes.has(c)},toggle(c,value){const enabled=value??!classes.has(c);enabled?classes.add(c):classes.delete(c);return enabled}},setAttribute(){},append(){},addEventListener(name,fn){listeners.set(name,fn)}};
    nodes.set(id,n);return n;
  };
  const context=vm.createContext({fetch,AbortSignal,URL,URLSearchParams,console,Response,Element:class {},location:{origin:'https://oggspotify.vercel.app'},navigator:{},window:{scrollTo(){}},matchMedia:()=>({matches:true}),setTimeout:()=>1,clearTimeout(){},setInterval(){},document:{hidden:true,body:node('body'),documentElement:node('html'),getElementById:node,createElement:()=>node(Symbol()),createElementNS:()=>node(Symbol()),addEventListener(name,fn){events.set(name,fn)}}});
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
  return {context,node,events,videoPlayers,run:code=>vm.runInContext(code,context)};
}
const content=id=>JSON.stringify({uri:`spotify:track:${id}`,title:'Song'});
const first='1111111111111111111111',second='2222222222222222222222';
const result=id=>new Response(JSON.stringify({videoId:id}));
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
