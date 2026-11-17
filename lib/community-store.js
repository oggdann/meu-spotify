import {createHash,randomUUID} from 'node:crypto';
import {get,put,list} from '@vercel/blob';
import {siteStore} from './site-store.js';
import {guestLinkPreviews,instagramImageUrl} from './link-preview.js';
import {presenceLink} from './presence.js';
export const OWNER_ID='dq78sjzflg084c1ibpjuo8gjc';
// This exact legacy entry was explicitly confirmed by the project owner during maintenance.
// Visual attribution only: administrative authority still requires signed owner authentication.
const confirmedOwnerEntries=new Set(["guest-dae193aa26c228f9920a9355c9604aafd427da6b"]);
const hash=id=>createHash('sha256').update(id).digest('hex');
const failure=(code,status=400)=>Object.assign(new Error(code),{code,status});
export function orderEntries(entries,sort='recentes'){
  return [...entries].sort((a,b)=>{
    const delta=sort==='antigos'?a.presentAt-b.presentAt:sort==='curtidos'?b.likeCount-a.likeCount:sort==='respostas'?b.replyCount-a.replyCount:b.presentAt-a.presentAt;
    return delta||b.presentAt-a.presentAt||a.id.localeCompare(b.id);
  });
}
export function createCommunityStore({read,write,listing,presences,now=Date.now}){
  const rootPath=id=>'community-post/'+id+'.json',threadPath=id=>'community-thread/'+hash(id)+'.json';
  const roots=async()=>[...await presences(),...await Promise.all((await listing('community-post/')).map(async f=>(await read(f.pathname))?.value))].filter(Boolean);
  async function root(id){if(!/^[A-Za-z0-9._-]{1,100}$/.test(id||''))throw failure('invalid_target');return (await roots()).find(row=>row.id===id);}
  async function state(id){return (await read(threadPath(id)))?.value||{version:0,likes:{},replies:[],audit:[]};}
  function creator(row,s){return confirmedOwnerEntries.has(row.id)||row.ownerId===OWNER_ID||(row.id===OWNER_ID&&row.source!=='guest')||s.claimedOwner===OWNER_ID;}
  function replyView(r,viewer){return {id:r.id,name:r.name,image:r.image||null,comment:r.comment,presentAt:r.presentAt,creator:r.ownerId===OWNER_ID,instagramUrl:r.instagramUrl||null,spotifyUrl:r.spotifyUrl||null,instagramImage:r.instagramImage||null,previews:r.previews||[],source:r.source||'guest',likeCount:Object.values(r.likes||{}).filter(Boolean).length,liked:!!r.likes?.[viewer.key],editedAt:r.editedAt||null,moderationEdit:!!r.moderationEdit,...(viewer.isOwner?{hidden:!!r.hidden,removed:!!r.removed}:{})};}
  function view(row,s,viewer){
    const visible=(s.replies||[]).filter(r=>viewer.isOwner||(!r.hidden&&!r.removed));
    const profile={...row};for(const field of ['instagramUrl','spotifyUrl','instagramImage','url'])if(Object.hasOwn(s,field))profile[field]=s[field];if(s.linksEditedAt)profile.image=null;
    const {ownerId,...base}=profile;
    const links=[profile.instagramUrl,profile.spotifyUrl].filter(Boolean);
    const previews=links.map(url=>(s.previews||row.previews||[]).find(p=>p.url===url)||{url,provider:url.includes('instagram.com')?'Instagram':'Spotify',type:url.includes('/playlist/')?'playlist':'profile',title:url.includes('instagram.com')?'@'+new URL(url).pathname.replaceAll('/',''):url.includes('/playlist/')?'Playlist no Spotify':'Perfil no Spotify',description:'Abrir link',image:null,metadataAvailable:false});
    return {...base,previews,comment:s.comment??row.comment??'',creator:creator(row,s),likeCount:Object.values(s.likes||{}).filter(Boolean).length,liked:!!s.likes?.[viewer.key],replyCount:(s.replies||[]).filter(r=>!r.hidden&&!r.removed).length,editedAt:s.editedAt||null,moderationEdit:!!s.moderationEdit,canClaim:!!(viewer.isOwner&&viewer.guestId===row.id&&!creator(row,s)),...(viewer.isOwner?{hidden:!!s.hidden,removed:!!s.removed}:{})};
  }
  async function mutate(id,work){
    for(let attempt=0;attempt<6;attempt++){
      const current=await read(threadPath(id)),s=structuredClone(current?.value||{version:0,likes:{},replies:[],audit:[]});
      const result=await work(s);s.version=(s.version||0)+1;
      try{await write(threadPath(id),s,current?.etag);return {state:s,result};}
      catch(e){if(![409,412].includes(e.status)&&!/precondition|already exists|etag|conflict/i.test(e.name+' '+e.message))throw e;}
    }
    throw failure('concurrent_update',409);
  }
  const audit=(s,row,viewer,action,before,after,replyId)=>{s.audit??=[];s.audit.push({id:randomUUID(),action,editor:OWNER_ID,at:now(),authorId:row.id,replyId:replyId||null,before,after});};
  return {
    async feed(viewer={}){return (await Promise.all((await roots()).map(async row=>{const s=await state(row.id);return !viewer.isOwner&&(s.hidden||s.removed)?null:view(row,s,viewer);}))).filter(Boolean);},
    async replies(id,viewer={},offset=0,limit=20){
      const row=await root(id);if(!row)throw failure('not_found',404);const s=await state(id);
      if(!viewer.isOwner&&(s.hidden||s.removed))throw failure('not_found',404);
      const replies=(s.replies||[]).filter(r=>viewer.isOwner||(!r.hidden&&!r.removed));
      return {items:replies.slice(offset,offset+limit).map(r=>replyView(r,viewer)),next:offset+limit<replies.length?offset+limit:null,total:replies.length};
    },
    async action(action,body,viewer){
      if(action==='publicar'){
        if(!viewer.isOwner)throw failure('forbidden',403);
        if(!/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId||''))throw failure('invalid_request');
        const id='post-'+body.requestId,profile=viewer.profile||{},text=String(body.text||'').trim();
        if(!text||text.length>1000)throw failure('invalid_text');
        const value={id,name:profile.name||'OGG',image:profile.image||null,url:'https://open.spotify.com/user/'+OWNER_ID,instagramUrl:'https://www.instagram.com/oggdann/',spotifyUrl:'https://open.spotify.com/user/'+OWNER_ID,comment:text,source:'spotify',ownerId:OWNER_ID,presentAt:now()};
        try{await write(rootPath(id),value);}catch(e){if(![409,412].includes(e.status)&&!/already exists|precondition|conflict/i.test(e.name+' '+e.message))throw e;}
        return {ok:true,id};
      }
      const row=await root(body.id);if(!row)throw failure('not_found',404);
      const result=await mutate(row.id,async s=>{
        if(['ocultar','excluir','editar','identificar','previews','links'].includes(action)&&!viewer.isOwner)throw failure('forbidden',403);
        if(!viewer.isOwner&&(s.hidden||s.removed))throw failure('not_found',404);
        if(action==='curtir'){
          if(typeof body.liked!=='boolean')throw failure('invalid_like');
          const target=body.replyId?(s.replies||[]).find(r=>r.id===body.replyId):s;if(!target||(!viewer.isOwner&&(target.hidden||target.removed)))throw failure('not_found',404);target.likes??={};if(body.liked)target.likes[viewer.key]=true;else delete target.likes[viewer.key];return;
        }
        if(action==='responder'){
          if(!/^[A-Za-z0-9_-]{8,64}$/.test(body.requestId||''))throw failure('invalid_request');
          s.replies??=[];if(s.replies.some(r=>r.id===body.requestId))return;
          if(s.replies.length>=500)throw failure('thread_limit',429);
          const text=String(body.text||'').trim();if(!text||text.length>1000)throw failure('invalid_text');
          const own=(await presences()).find(p=>p.id===viewer.guestId||p.id===viewer.userId);
          const name=viewer.isOwner?(viewer.profile?.name||'OGG'):String(own?.name||viewer.profile?.name||body.name||'').trim();
          if(name.length<2||name.length>100)throw failure('name_required');
          s.replies.push({id:body.requestId,authorKey:viewer.key,name,comment:text,presentAt:now(),image:viewer.isOwner?viewer.profile?.image||null:own?.image||null,instagramUrl:viewer.isOwner?'https://www.instagram.com/oggdann/':own?.instagramUrl||null,spotifyUrl:viewer.isOwner?'https://open.spotify.com/user/'+OWNER_ID:own?.spotifyUrl||null,source:viewer.isOwner?'spotify':'guest',...(viewer.isOwner?{ownerId:OWNER_ID}:{})});return;
        }
        if(action==='previews'){const before=s.previews||row.previews||[];s.previews=await guestLinkPreviews(view(row,s,viewer),{refresh:true});audit(s,row,viewer,action,{previews:before},{previews:s.previews});return;}
        if(action==='identificar'){
          if(viewer.guestId!==row.id||row.source!=='guest')throw failure('identity_not_proven',403);
          s.claimedOwner=OWNER_ID;audit(s,row,viewer,action,{creator:false},{creator:true});return;
        }
        let target=s,original=row;
        if(body.replyId){target=(s.replies||[]).find(r=>r.id===body.replyId);if(!target)throw failure('not_found',404);original={...target};}

        if(action==='links'){
          const instagram=String(body.instagramUrl||'').trim(),spotify=String(body.spotifyUrl||'').trim(),photo=String(body.instagramImage||'').trim();
          const instagramUrl=presenceLink(instagram,'instagram'),spotifyUrl=presenceLink(spotify,'spotify'),instagramImage=photo?instagramImageUrl(photo):null;
          if((instagram&&!instagramUrl)||(spotify&&!spotifyUrl)||(photo&&(!instagramImage||!instagramUrl)))throw failure('invalid_links');
          const previous=body.replyId?original:view(row,s,viewer);
          const before={instagramUrl:previous.instagramUrl||null,spotifyUrl:previous.spotifyUrl||null,instagramImage:previous.instagramImage||null};
          Object.assign(target,{instagramUrl,spotifyUrl,instagramImage,url:instagramUrl||spotifyUrl,image:null,linksEditedAt:now()});
          target.previews=await guestLinkPreviews({instagramUrl,spotifyUrl});
          audit(s,row,viewer,action,before,{instagramUrl,spotifyUrl,instagramImage},body.replyId);return;
        }
        const before={...original,comment:body.replyId?target.comment:s.comment??row.comment??'',hidden:!!target.hidden,removed:!!target.removed};
        if(action==='editar'){
          const text=String(body.text||'').trim();if(!text||text.length>1000)throw failure('invalid_text');
          target.comment=text;target.editedAt=now();target.moderationEdit=body.replyId?target.ownerId!==OWNER_ID:!creator(row,s);
        }else if(action==='ocultar'){if(typeof body.hidden!=='boolean')throw failure('invalid_action');target.hidden=body.hidden;}
        else if(action==='excluir')target.removed=true;
        else throw failure('invalid_action');
        audit(s,row,viewer,action,before,{comment:target.comment??row.comment??'',hidden:!!target.hidden,removed:!!target.removed},body.replyId);
      });
      return {ok:true,entry:view(row,result.state,viewer)};
    }
  };
}
let instance;
export function communityStore(){
  if(!instance)instance=createCommunityStore({
    read:async path=>{const result=await get(path,{access:'private',useCache:false});if(!result)return null;if(result.statusCode!==200)throw new Error('storage_unavailable');return {value:await new Response(result.stream).json(),etag:result.blob.etag};},
    write:async(path,value,etag)=>put(path,JSON.stringify(value),{access:'private',addRandomSuffix:false,contentType:'application/json',allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{})}),
    listing:async prefix=>{const files=[];let cursor;do{const page=await list({prefix,limit:1000,...(cursor?{cursor}:{})});files.push(...page.blobs);cursor=page.hasMore?page.cursor:null;}while(cursor);return files;},
    presences:()=>siteStore().presences()
  });return instance;
}
