import {imageUrl,plainDescription} from './spotify.js';
import {readShared,writeShared} from './service-cache.js';
const profileUrl='https://open.spotify.com/user/dq78sjzflg084c1ibpjuo8gjc';
// Read only public metadata from the fixed owner's page. Never execute HTML.
export function parseOwnerPhoto(html){
  const meta={};
  for(const tag of String(html).match(/<meta\b[^>]*>/gi)||[]){
    const attrs={};
    for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))attrs[match[1].toLowerCase()]=match[3];
    if(attrs.property&&attrs.content)meta[attrs.property]=plainDescription(attrs.content);
  }
  if(meta['og:url']&&meta['og:url'].replace(/\/$/,'')!==profileUrl)return null;
  const image=imageUrl(meta['og:image']);
  return meta['og:title']&&image?{image,checkedAt:Date.now()}:null;
}
export async function ownerPhoto(){
  const key='owner-public-photo:v1',saved=await readShared(key);
  if(saved?.checkedAt+300000>Date.now())return saved;
  try{
    const response=await fetch(profileUrl,{signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('profile_unavailable');
    const photo=parseOwnerPhoto(await response.text());
    if(!photo)throw Error('photo_unavailable');
    await writeShared(key,photo,86400);return photo;
  }catch{return saved?{...saved,stale:true}:null;}
}
