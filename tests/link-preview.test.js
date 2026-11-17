import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLinkMetadata,linkPreview} from '../lib/link-preview.js';
const url='https://open.spotify.com/playlist/1111111111111111111111';
const html=`<meta content="Minha playlist" property="og:title"><meta property="og:url" content="${url}"><meta property="og:description" content="Playlist · OGG · 40 músicas"><meta property="og:image" content="https://i.scdn.co/image/cover">`;
test('link previews retain public name, image and description only for the expected page',()=>{
  const data=parseLinkMetadata(html,url);assert.equal(data.title,'Minha playlist');assert.equal(data.image,'https://i.scdn.co/image/cover');assert.match(data.description,/40 músicas/);
  assert.equal(parseLinkMetadata(html.replace(url,'https://open.spotify.com/user/other'),url),null);
  assert.equal(parseLinkMetadata('<html>Login required</html>','https://www.instagram.com/oggdann/'),null);
});
test('preview fetches reject unsupported hosts, paths, credentials and query redirects before network access',async()=>{
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected')};
  for(const link of ['http://127.0.0.1','https://open.spotify.com.evil.example/user/test','https://user:pass@open.spotify.com/user/test','https://www.instagram.com/accounts/login/','https://open.spotify.com/user/test?redirect=http://127.0.0.1'])assert.equal(await linkPreview(link),null);
  assert.equal(calls,0);
});
test('public playlist previews are cached without authorization or following redirects',async()=>{
  let calls=0;globalThis.fetch=async(request,options)=>{calls++;assert.equal(request,url);assert.equal(options.redirect,'error');assert.equal(options.headers?.Authorization,undefined);return new Response(html)};
  const first=await linkPreview(url),second=await linkPreview(url);assert.equal(calls,1);assert.equal(first.provider,'Spotify');assert.equal(first.type,'playlist');assert.deepEqual(first,second);
});
test('an Instagram login page is not published as a visitor profile preview',async()=>{
  globalThis.fetch=async()=>new Response('<meta property="og:title" content="Instagram"><meta property="og:image" content="https://static.cdninstagram.com/logo.png">');
  assert.equal(await linkPreview('https://www.instagram.com/preview_test_guest/'),null);
});

test('public structured metadata adds real author, counts, duration and followers without guessing',()=>{
 const url='https://open.spotify.com/playlist/1111111111111111111111';
 const html='<meta property="og:title" content="My playlist"><script type="application/ld+json">'+JSON.stringify({'@type':'MusicPlaylist',url,author:{name:'OGG'},numTracks:42,duration:'PT2H3M',interactionStatistic:{interactionType:{'@type':'FollowAction'},userInteractionCount:120}})+'</script>';
 const data=parseLinkMetadata(html,url);assert.deepEqual(data.details,{author:'OGG',trackCount:42,durationSeconds:7380,followers:120});
 const wrong=parseLinkMetadata(html.replace('numTracks":42','numTracks":"many"'),url);assert.equal(Object.hasOwn(wrong.details,'trackCount'),false);
});
test('both social links retain separate usable previews when metadata is blocked',async()=>{
 globalThis.fetch=async()=>{throw Error('blocked')};const {guestLinkPreviews}=await import('../lib/link-preview.js');
 const result=await guestLinkPreviews({instagramUrl:'https://www.instagram.com/link_fallback_both/',spotifyUrl:'https://open.spotify.com/user/metadata_fallback_both'});
 assert.equal(result.length,2);assert.deepEqual(result.map(r=>r.provider),['Instagram','Spotify']);assert.ok(result.every(r=>r.url&&r.metadataAvailable===false));
});
