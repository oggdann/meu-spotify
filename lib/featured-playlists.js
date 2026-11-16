import {cached,imageUrl} from './spotify.js';
import {readShared,writeShared} from './service-cache.js';
export const featuredPlaylistIds=['306AubstP6UatfIUhynAX8','5Q6OaPkyTIu8CaZSg4fwVr'];
async function playlist(id){
  const url='https://open.spotify.com/playlist/'+id,key='featured-playlist:'+id;
  const saved=await readShared(key);
  if(saved?.checkedAt+600000>Date.now())return saved;
  try{
    const response=await fetch('https://open.spotify.com/oembed?url='+encodeURIComponent(url),{signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw Error('metadata_unavailable');
    const data=await response.json();
    if(typeof data.title!=='string'||!data.title.trim())throw Error('metadata_unavailable');
    const value={id,uri:'spotify:playlist:'+id,url,name:data.title.slice(0,200),image:imageUrl(data.thumbnail_url),description:'Minha seleção. Abre no Spotify e salva pra ouvir depois.',total:null,checkedAt:Date.now()};
    await writeShared(key,value,86400);return value;
  }catch{return {...(saved||{id,uri:'spotify:playlist:'+id,url,name:'Playlist do OGG',image:null,description:'Abre minha playlist no Spotify.',total:null}),stale:true};}
}
export function featuredPlaylists(){return cached('featured-playlists',60000,async()=>{const items=await Promise.all(featuredPlaylistIds.map(playlist));return {items,stale:items.some(item=>item.stale),truncated:false};});}
