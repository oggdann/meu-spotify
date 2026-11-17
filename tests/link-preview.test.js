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

test('playlist creator links are accepted only from a public Spotify user URL',()=>{
 const url='https://open.spotify.com/playlist/7777777777777777777777';
 const page='<meta property="og:title" content="Playlist"><meta name="music:creator" content="https://open.spotify.com/user/public_owner">';
 assert.equal(parseLinkMetadata(page,url).creator.url,'https://open.spotify.com/user/public_owner');
 for(const unsafe of ['https://evil.example/user/public_owner','https://open.spotify.com/user/public_owner?redirect=1','https://x:pw@open.spotify.com/user/public_owner'])
 assert.equal(parseLinkMetadata(page.replace('https://open.spotify.com/user/public_owner',unsafe),url).creator,undefined);
});
test('playlist previews resolve the creator photo from a cached public profile without Spotify authorization',async()=>{
 const url='https://open.spotify.com/playlist/8888888888888888888888',owner='https://open.spotify.com/user/avatar_playlist_owner';
 const calls=[];globalThis.fetch=async(u,options)=>{calls.push(u);assert.equal(options.redirect,'error');assert.equal(options.headers?.Authorization,undefined);return new Response(u===url?'<meta property="og:title" content="Mix"><meta property="og:image" content="https://i.scdn.co/image/playlist"><meta name="music:creator" content="'+owner+'">':'<meta property="og:title" content="Creator"><meta property="og:image" content="https://i.scdn.co/image/creator">');};
 const first=await linkPreview(url),second=await linkPreview(url);
 assert.equal(first.creator.image,'https://i.scdn.co/image/creator');assert.equal(first.details.author,'Creator');assert.deepEqual(calls,[url,owner]);assert.deepEqual(second,first);
});
test('comment avatars prefer Instagram, Spotify profile, playlist creator and then cover with only safe image hosts',async()=>{
 const {commentImageCandidates}=await import('../lib/link-preview.js');
 const row={instagramUrl:'https://www.instagram.com/avatar_priority/',spotifyUrl:'https://open.spotify.com/playlist/9999999999999999999999',image:'https://i.scdn.co/image/existing',previews:[{provider:'Instagram',url:'https://www.instagram.com/avatar_priority/',image:'https://scontent.cdninstagram.com/photo.jpg'},{provider:'Spotify',url:'https://open.spotify.com/playlist/9999999999999999999999',type:'playlist',creator:{image:'https://i.scdn.co/image/creator'},image:'https://i.scdn.co/image/cover'}]};
 assert.deepEqual(commentImageCandidates(row),['https://scontent.cdninstagram.com/photo.jpg','https://i.scdn.co/image/creator','https://i.scdn.co/image/existing','https://i.scdn.co/image/cover']);
 row.previews[0].image='https://evil.example/fake.jpg';row.previews[1].type='profile';
 assert.deepEqual(commentImageCandidates(row),['https://i.scdn.co/image/cover','https://i.scdn.co/image/existing']);
});
test('old comments gain avatars on read with bounded metadata requests and keep their original text',async()=>{
 const {enrichCommentProfiles}=await import('../lib/link-preview.js');let calls=0;
 globalThis.fetch=async u=>{calls++;return new Response('<meta property="og:title" content="Public profile"><meta property="og:image" content="https://i.scdn.co/image/old-person">');};
 const rows=Array.from({length:4},(_,i)=>({id:'legacy-'+i,name:'Guest '+i,comment:'Original '+i,spotifyUrl:'https://open.spotify.com/user/avatar_legacy_'+i}));
 await enrichCommentProfiles(rows);assert.equal(calls,2);assert.equal(rows[0].image,'https://i.scdn.co/image/old-person');assert.equal(rows[0].comment,'Original 0');
 await enrichCommentProfiles(rows);assert.equal(calls,4);assert.ok(rows.every(r=>r.image==='https://i.scdn.co/image/old-person'));assert.equal(rows[3].name,'Guest 3');
});

test('an explicit Instagram photo stays ahead of Spotify and unsafe manual photo hosts are rejected',async()=>{
 const {commentImageCandidates,instagramImageUrl}=await import('../lib/link-preview.js');
 const photo='https://scontent.cdninstagram.com/manual.jpg',row={instagramUrl:'https://www.instagram.com/manual_photo/',instagramImage:photo,image:'https://i.scdn.co/image/spotify'};
 assert.deepEqual(commentImageCandidates(row),[photo,row.image]);assert.equal(instagramImageUrl('https://evil.example/manual.jpg'),null);assert.equal(instagramImageUrl('https://i.scdn.co/image/not-instagram'),null);
 assert.equal(instagramImageUrl('https://user:pw@scontent.cdninstagram.com/avatar.jpg'),null);assert.equal(instagramImageUrl('https://scontent.cdninstagram.com:444/avatar.jpg'),null);
 row.instagramUrl=null;assert.deepEqual(commentImageCandidates(row),[row.image]);
});
test('creator preview refresh can revalidate a cached profile photo',async()=>{
 const url='https://open.spotify.com/user/fresh_avatar_test';let calls=0;globalThis.fetch=async()=>new Response('<meta property="og:title" content="Profile"><meta property="og:image" content="https://i.scdn.co/image/photo-'+(++calls)+'">');
 const one=await linkPreview(url),cached=await linkPreview(url),fresh=await linkPreview(url,{refresh:true});assert.equal(one.image,cached.image);assert.notEqual(fresh.image,one.image);assert.equal(calls,2);
});
