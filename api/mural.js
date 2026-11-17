import {randomBytes,createHmac} from 'node:crypto';
import {communityStore,OWNER_ID,orderEntries} from '../lib/community-store.js';
import {communityIdentity} from '../lib/presence.js';
import {readShared,writeShared} from '../lib/service-cache.js';
import {linkPreview,cachedLinkPreview} from '../lib/link-preview.js';
export function createMuralHandler({store=communityStore,identity=communityIdentity}={}){
 return async function(req,res){
  res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex');
  const url=new URL(req.url,'https://oggspotify.vercel.app'),action=url.searchParams.get('acao')||'listar',viewer=identity(req);
  try{
   if(req.method==='GET'&&action==='listar'){
    const sort=url.searchParams.get('ordem')||'recentes',limit=20;const rows=(await store().feed(viewer)).filter(r=>sort==='ocultos'&&viewer.isOwner?(r.hidden||r.removed):!r.hidden&&!r.removed);
    let snapshot,offset=0;const cursor=url.searchParams.get('cursor');
    if(cursor){const match=/^([a-f0-9]{32}):(\d{1,6})$/.exec(cursor);if(!match)return res.status(400).json({error:'invalid_cursor'});snapshot=await readShared('mural-page:'+match[1]);offset=Number(match[2]);if(!snapshot||snapshot.sort!==sort||snapshot.owner!==viewer.isOwner)return res.status(409).json({error:'refresh_required'});snapshot={...snapshot,key:match[1]};}
    else{const sorted=orderEntries(sort==='criador'?rows.filter(r=>r.creator):rows,sort);snapshot={key:randomBytes(16).toString('hex'),ids:sorted.map(r=>r.id),sort,owner:viewer.isOwner};await writeShared('mural-page:'+snapshot.key,snapshot,900);}
    const byId=new Map(rows.map(r=>[r.id,r])),ids=snapshot.ids.slice(offset,offset+limit);
    const items=ids.map(id=>byId.get(id)).filter(Boolean),pending=new Map();
    await Promise.all(items.map(async row=>{row.previews=await Promise.all((row.previews||[]).map(async preview=>{const cached=await cachedLinkPreview(preview.url);if(cached)return cached.preview||preview;if(!pending.has(preview.url)&&pending.size<2)pending.set(preview.url,linkPreview(preview.url));return pending.has(preview.url)?await pending.get(preview.url)||preview:preview;}));}));
    return res.status(200).json({items,next:offset+limit<snapshot.ids.length?snapshot.key+':'+(offset+limit):null,total:rows.length,own:rows.find(r=>r.id===viewer.guestId)||null,availability:'ready',owner:viewer.isOwner});
   }
   if(req.method==='GET'&&action==='respostas'){const data=await store().replies(url.searchParams.get('id'),viewer,Math.max(0,Math.min(500,Number(url.searchParams.get('offset'))||0)));return res.status(200).json(data);}
   if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'method_not_allowed'});}
   let body=req.body||{};if(typeof body==='string'){try{body=JSON.parse(body);}catch{return res.status(400).json({error:'invalid_body'});}}
   if(req.headers?.origin!=='https://oggspotify.vercel.app'||!viewer.valid(body.csrf)||!viewer.key)return res.status(403).json({error:'invalid_session'});
   const ip=String(req.headers?.['x-vercel-forwarded-for']||req.headers?.['x-forwarded-for']||'unknown').split(',')[0];
   const rateKey='mural-rate:'+createHmac('sha256',process.env.OGG_PRESENCE_SECRET||'local').update(ip+':'+viewer.key).digest('hex');
   const previous=await readShared(rateKey),rate=previous?.until>Date.now()?previous:{count:0,until:Date.now()+60000};
   if(rate.count>=40){res.setHeader('Retry-After','60');return res.status(429).json({error:'too_many_actions'});}
   await writeShared(rateKey,{...rate,count:rate.count+1},60);
   return res.status(200).json(await store().action(action,body,viewer));
  }catch(e){return res.status(e.status||503).json({error:e.code||'storage_unavailable'});}
 };
}
export default createMuralHandler();
