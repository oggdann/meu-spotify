import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseOwnerPhoto} from '../lib/owner-photo.js';
const page=image=>`<meta property="og:title" content="ogg"><meta property="og:url" content="https://open.spotify.com/user/dq78sjzflg084c1ibpjuo8gjc"><meta content="${image}" property="og:image">`;
test('owner photo reads only the public owner metadata and rejects unsafe or mismatched images',()=>{
  assert.equal(parseOwnerPhoto(page('https://i.scdn.co/image/current')).image,'https://i.scdn.co/image/current');
  assert.equal(parseOwnerPhoto(page('javascript:alert(1)')),null);
  assert.equal(parseOwnerPhoto(page('https://attacker.example/avatar')),null);
  assert.equal(parseOwnerPhoto(page('https://i.scdn.co/image/current').replace('dq78sjzflg084c1ibpjuo8gjc','someone-else')),null);
  assert.equal(parseOwnerPhoto('<html>Sign in</html>'),null);
});
test('owner photo refreshes after five minutes without tokens and retains the previous photo on temporary failure',()=>{
  const code=`let clock=1000;Date.now=()=>clock;let calls=0,offline=false;globalThis.fetch=async(url,opts)=>{calls++;if(offline)throw Error('offline');if(opts.headers?.Authorization)throw Error('no credentials expected');return new Response(${JSON.stringify(page('https://i.scdn.co/image/'))}.replace('/image/','/image/'+calls))};const {ownerPhoto}=await import('./lib/owner-photo.js');const first=await ownerPhoto(),warm=await ownerPhoto();clock+=300001;const fresh=await ownerPhoto();clock+=300001;offline=true;const stale=await ownerPhoto();console.log(JSON.stringify({first,warm,fresh,stale,calls}));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const r=JSON.parse(result.stdout);assert.equal(r.first.image,r.warm.image);assert.notEqual(r.first.image,r.fresh.image);assert.equal(r.stale.image,r.fresh.image);assert.equal(r.stale.stale,true);assert.equal(r.calls,3);
});
