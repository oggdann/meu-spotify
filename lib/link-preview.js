import {createHash} from 'node:crypto';
import {imageUrl,plainDescription} from './spotify.js';
import {readShared,writeShared} from './service-cache.js';
function structuredFields(html,url){
 const target=new URL(url),nodes=[];
 for(const match of String(html).matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  if(nodes.length>50)break;try{const value=JSON.parse(match[1]);nodes.push(...(Array.isArray(value)?value:[value]));}catch{}
 }
 for(let i=0;i<nodes.length&&i<100;i++){const node=nodes[i];if(!node||typeof node!=='object')continue;if(Array.isArray(node['@graph']))nodes.push(...node['@graph']);if(node.mainEntity&&typeof node.mainEntity==='object')nodes.push(node.mainEntity);}
 const root=nodes.find(node=>{
  if(!node||typeof node!=='object')return false;const types=[node['@type']].flat().map(v=>String(v).split('/').at(-1));
  if(!types.some(type=>['MusicPlaylist','Person','ProfilePage'].includes(type)))return false;
  const canonical=node.url||node['@id'];if(!canonical)return true;
  try{const actual=new URL(canonical);return actual.hostname.replace(/^www\./,'')===target.hostname.replace(/^www\./,'')&&actual.pathname.replace(/\/$/,'')===target.pathname.replace(/\/$/,'');}catch{return false;}
 });
 if(!root)return {};
 const count=value=>{const number=typeof value==='number'?value:/^\d+$/.test(String(value))?Number(value):NaN;return Number.isSafeInteger(number)&&number>=0?number:undefined;};
 const author=[root.author||root.creator].flat().map(value=>typeof value==='string'?value:value?.name).filter(Boolean).map(plainDescription).join(' · ').slice(0,140);
 const trackCount=count(root.numTracks??root.numberOfTracks??root.track?.numberOfItems);
 let durationSeconds;const duration=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(root.duration||'');
 if(duration)durationSeconds=Math.round(Number(duration[1]||0)*86400+Number(duration[2]||0)*3600+Number(duration[3]||0)*60+Number(duration[4]||0));
 const follow=[root.interactionStatistic].flat().find(value=>String(value?.interactionType?.['@type']||value?.interactionType||'').includes('FollowAction'));
 const followers=count(follow?.userInteractionCount);
 return {root,details:Object.fromEntries(Object.entries({author:author||undefined,trackCount,durationSeconds,followers}).filter(([,value])=>value!==undefined))};
}
export function instagramCounters(description){
 const details={};
 for(const [field,label] of [['followers','followers?|seguidores?'],['following','following|seguindo'],['posts','posts?|publica(?:ç|c)(?:ões|oes|ão|ao)']]){
  const match=new RegExp('(?:^|[\\s,;·])([0-9][0-9.,]*\\s*(?:[kmb]|mil|milh(?:ões|oes))?)\\s+(?:'+label+')(?:\\b|$)','i').exec(description||'');
  if(!match)continue;const value=match[1].trim();
  if(/^(?:\d+|\d{1,3}(?:[.,]\d{3})+)$/.test(value)){const count=Number(value.replace(/[.,]/g,''));if(Number.isSafeInteger(count))details[field]=count;}
  else details[field+'Display']=value;
 }
 return details;
}
export function parseLinkMetadata(html,url){
  const meta={};
  for(const tag of String(html).match(/<meta\b[^>]*>/gi)||[]){
    const attrs={};for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))attrs[match[1].toLowerCase()]=match[3];
    if(attrs.property||attrs.name)meta[attrs.property||attrs.name]=plainDescription(attrs.content||'');
  }
  const target=new URL(url);
  if(meta['og:url']){try{const canonical=new URL(meta['og:url']);if(canonical.hostname.replace(/^www\./,'')!==target.hostname.replace(/^www\./,'')||canonical.pathname.replace(/\/$/,'').toLowerCase()!==target.pathname.replace(/\/$/,'').toLowerCase())return null;}catch{return null;}}
  const structured=structuredFields(html,url);
  if(target.hostname==='www.instagram.com'){structured.details={...structured.details,...instagramCounters(meta['og:description']||meta.description||'')};}
  const title=(meta['og:title']||structured.root?.name||'').trim();
  if(!title)return null;
  const rawCreator=meta['music:creator']||structured.root?.creator||structured.root?.author;
  const author=[rawCreator].flat().find(Boolean),creatorUrl=typeof author==='string'?author:author?.url||author?.['@id'];
  let creator;try{const u=new URL(creatorUrl);if(u.protocol==='https:'&&u.hostname==='open.spotify.com'&&!u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/user\/[A-Za-z0-9._-]{1,64}\/?$/.test(u.pathname))creator={url:u.origin+u.pathname.replace(/\/$/,''),name:typeof author==='object'?plainDescription(author.name||'').slice(0,140):'',image:imageUrl(typeof author==='object'?(author.image?.url||author.image):null)};}catch{}
  return {...(creator?{creator}:{}),title:title.slice(0,140),description:plainDescription(meta['og:description']||meta.description||structured.root?.description||'').slice(0,240),image:imageUrl(meta['og:image']||[structured.root?.image].flat()[0]?.url||[structured.root?.image].flat()[0]),...(structured.details?{details:structured.details}:{})};
}
export async function cachedLinkPreview(url){return readShared('link-preview:v4:'+createHash('sha256').update(url).digest('hex'));}
export async function linkPreview(url,{refresh=false}={}){
  let target;try{target=new URL(url);}catch{return null;}
  const instagram=target.hostname==='www.instagram.com'&&/^\/[A-Za-z0-9._]{1,30}\/$/.test(target.pathname);
  const spotify=target.hostname==='open.spotify.com'&&/^\/(?:user\/[A-Za-z0-9._-]{1,64}|playlist\/[A-Za-z0-9]{22})$/.test(target.pathname);
  if(target.protocol!=='https:'||target.port||target.username||target.password||target.search||target.hash||(!instagram&&!spotify))return null;
  const key='link-preview:v4:'+createHash('sha256').update(url).digest('hex'),saved=await readShared(key);
  if(saved&&!refresh)return saved.preview;
  let data=null;
  try{const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(3500)});if(response.ok)data=parseLinkMetadata(await response.text(),url);}catch{}
  if(instagram&&data&&(!data.image||data.title.trim().toLowerCase()==='instagram'||/\b(?:log\s?in|sign\s?in|entrar)\b/i.test(data.title)))data=null;
  if(!data&&spotify&&target.pathname.startsWith('/playlist/')){
    try{const response=await fetch('https://open.spotify.com/oembed?url='+encodeURIComponent(url),{redirect:'error',signal:AbortSignal.timeout(3500)});if(response.ok){const body=await response.json();if(body.title)data={title:plainDescription(body.title).slice(0,140),image:imageUrl(body.thumbnail_url),description:''};}}catch{}
  }
  if(data&&spotify&&target.pathname.startsWith('/playlist/')&&data.creator?.url){
    const owner=await linkPreview(data.creator.url);
    if(owner){data.creator={...data.creator,name:owner.title||data.creator.name,image:owner.image||data.creator.image};if(!data.details?.author&&owner.title)data.details={...data.details,author:owner.title};}
  }
  const preview=data?{...data,url,provider:instagram?'Instagram':'Spotify',type:target.pathname.startsWith('/playlist/')?'playlist':'profile'}:null;
  await writeShared(key,{preview},preview?3600:300);return preview;
}
export async function guestLinkPreviews(profile,options={}){return Promise.all([...new Set([profile.instagramUrl,profile.spotifyUrl].filter(Boolean))].map(async url=>{const data=await linkPreview(url,options);if(data)return data;const u=new URL(url),instagram=u.hostname.includes('instagram.com');return {url,provider:instagram?'Instagram':'Spotify',type:u.pathname.startsWith('/playlist/')?'playlist':'profile',title:instagram?'@'+u.pathname.replaceAll('/',''):u.pathname.startsWith('/playlist/')?'Playlist no Spotify':'Perfil no Spotify',description:'Abrir '+(instagram?'no Instagram':'no Spotify'),image:null,metadataAvailable:false};}));}

export function instagramImageUrl(value){if(typeof value!=='string'||value.length>2048)return null;const safe=imageUrl(value);if(!safe)return null;const u=new URL(safe),h=u.hostname;if(u.port||u.username||u.password)return null;return h.endsWith('.cdninstagram.com')||h.endsWith('.fbcdn.net')||h==='platform-lookaside.fbsbx.com'?safe:null;}
export function commentImageCandidates(person){
 const previews=person.previews||[],instagram=previews.find(p=>p.url===person.instagramUrl&&p.provider==='Instagram'),spotify=previews.find(p=>p.url===person.spotifyUrl&&p.provider==='Spotify');
 return [...new Set([person.instagramUrl?instagramImageUrl(person.instagramImage):null,instagram?.image,spotify?.type==='profile'?spotify.image:null,spotify?.type==='playlist'?spotify.creator?.image:null,person.image,spotify?.type==='playlist'?spotify.image:null].map(imageUrl).filter(Boolean))];
}
export async function enrichCommentProfiles(items){
 const pending=new Map();
 await Promise.all(items.map(async row=>{
  const links=[row.instagramUrl,row.spotifyUrl].filter(Boolean);
  row.previews=await Promise.all(links.map(async url=>{
   const previous=(row.previews||[]).find(p=>p.url===url),cached=await cachedLinkPreview(url);
   if(cached)return cached.preview||previous;
   if(!pending.has(url)&&pending.size<2)pending.set(url,linkPreview(url));
   return pending.has(url)?await pending.get(url)||previous:previous;
  }));
  row.previews=row.previews.filter(Boolean);
  row.imageCandidates=commentImageCandidates(row);row.image=row.imageCandidates[0]||null;
 }));
 return items;
}
