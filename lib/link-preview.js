import {createHash} from 'node:crypto';
import {imageUrl,plainDescription} from './spotify.js';
import {readShared,writeShared} from './service-cache.js';
export function parseLinkMetadata(html,url){
  const meta={};
  for(const tag of String(html).match(/<meta\b[^>]*>/gi)||[]){
    const attrs={};for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))attrs[match[1].toLowerCase()]=match[3];
    if(attrs.property||attrs.name)meta[attrs.property||attrs.name]=plainDescription(attrs.content||'');
  }
  const target=new URL(url);
  if(meta['og:url']){try{const canonical=new URL(meta['og:url']);if(canonical.hostname.replace(/^www\./,'')!==target.hostname.replace(/^www\./,'')||canonical.pathname.replace(/\/$/,'').toLowerCase()!==target.pathname.replace(/\/$/,'').toLowerCase())return null;}catch{return null;}}
  const title=(meta['og:title']||'').trim();
  if(!title)return null;
  return {title:title.slice(0,140),description:(meta['og:description']||meta.description||'').slice(0,240),image:imageUrl(meta['og:image'])};
}
export async function linkPreview(url){
  let target;try{target=new URL(url);}catch{return null;}
  const instagram=target.hostname==='www.instagram.com'&&/^\/[A-Za-z0-9._]{1,30}\/$/.test(target.pathname);
  const spotify=target.hostname==='open.spotify.com'&&/^\/(?:user\/[A-Za-z0-9._-]{1,64}|playlist\/[A-Za-z0-9]{22})$/.test(target.pathname);
  if(target.protocol!=='https:'||target.port||target.username||target.password||target.search||target.hash||(!instagram&&!spotify))return null;
  const key='link-preview:'+createHash('sha256').update(url).digest('hex'),saved=await readShared(key);
  if(saved)return saved.preview;
  let data=null;
  try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(3500)});if(response.ok)data=parseLinkMetadata(await response.text(),url);}catch{}
  if(instagram&&data&&(!data.image||data.title.trim().toLowerCase()==='instagram'||/\b(?:log\s?in|sign\s?in|entrar)\b/i.test(data.title)))data=null;
  if(!data&&spotify&&target.pathname.startsWith('/playlist/')){
    try{const response=await fetch('https://open.spotify.com/oembed?url='+encodeURIComponent(url),{redirect:'error',signal:AbortSignal.timeout(3500)});if(response.ok){const body=await response.json();if(body.title)data={title:plainDescription(body.title).slice(0,140),image:imageUrl(body.thumbnail_url),description:''};}}catch{}
  }
  const preview=data?{...data,url,provider:instagram?'Instagram':'Spotify',type:target.pathname.startsWith('/playlist/')?'playlist':'profile'}:null;
  await writeShared(key,{preview},preview?3600:300);return preview;
}
export async function guestLinkPreviews(profile){return (await Promise.all([...new Set([profile.instagramUrl,profile.spotifyUrl].filter(Boolean))].map(linkPreview))).filter(Boolean);}
