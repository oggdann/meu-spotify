import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {siteStore} from './site-store.js';
import {imageUrl,spotifyUrl,spotifyCooldown,rememberSpotifyLimit,retrySeconds} from './spotify.js';
import {readShared,writeShared} from './service-cache.js';
import {guestLinkPreviews} from './link-preview.js';
import {createCreatorHandler} from './creator-login.js';
const ROOT='https://oggspotify.vercel.app',CALLBACK=ROOT+'/api/retorno';
const SESSION='__Host-ogg-presence',STATE='__Host-ogg-presence-state';
const GUEST='__Host-ogg-guest';
const secret=()=>process.env.OGG_PRESENCE_SECRET;
const sign=text=>createHmac('sha256',secret()).update(text).digest('base64url');
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);};
const cookie=(req,name)=>String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const pack=value=>{const body=Buffer.from(JSON.stringify(value)).toString('base64url');return body+'.'+sign(body);};
function unpack(value){
  if(!secret()||!value)return null;
  const [body,sig,...extra]=value.split('.');
  if(extra.length||!equal(sign(body),sig))return null;
  try{return JSON.parse(Buffer.from(body,'base64url').toString());}catch{return null;}
}
const setCookie=(name,value,seconds)=>name+'='+value+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+seconds;
const privateResponse=res=>{res.setHeader('Cache-Control','private, no-store, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex');};
export function publicVisitor(me){
  if(!/^[A-Za-z0-9._-]{1,64}$/.test(me?.id||''))return null;
  return{id:me.id,name:String(me.display_name||me.id).slice(0,100),image:imageUrl(me.images?.[0]?.url),url:spotifyUrl(me.external_urls?.spotify)||'https://open.spotify.com/user/'+encodeURIComponent(me.id)};
}
export function visitorSession(req){
  const value=unpack(cookie(req,SESSION));return value?.expires>Date.now()?value:null;
}
const visitorKey=profile=>createHash('sha256').update(profile.id).digest('hex');
function guestSession(req){const value=unpack(cookie(req,GUEST));return value?.expires>Date.now()&&/^[a-f0-9]{40}$/.test(value.id||'')?value:null;}
export function communityIdentity(req){const session=visitorSession(req),guest=guestSession(req),enabled=Boolean(secret());return {userId:session?.profile?.id||null,guestId:guest?'guest-'+guest.id:null,profile:session?.profile||null,isOwner:session?.profile?.id==='dq78sjzflg084c1ibpjuo8gjc',key:enabled&&(session||guest)?sign('mural-actor:'+(session?'spotify:'+session.profile.id:'guest:'+guest.id)):'',valid:csrf=>enabled&&Boolean((session&&equal(csrf,sign('csrf:'+session.nonce)))||(guest&&equal(csrf,sign('guest:'+guest.nonce))))};}
export function presenceLink(value,kind){
  if(!value)return null;
  try{
    let text=String(value).trim();
    if(/^(?:www\.)?instagram\.com\//i.test(text)||/^open\.spotify\.com\//i.test(text))text='https://'+text;
    else if(kind==='instagram'&&/^@?[A-Za-z0-9._]{1,30}$/.test(text))text='https://www.instagram.com/'+text.replace(/^@/,'');
    else if(kind==='spotify'){
      if(/^spotify:(?:user|playlist):[A-Za-z0-9._-]+$/.test(text))text='https://open.spotify.com/'+text.slice(8).replace(':','/');
      else if(/^(?:user|playlist)\/[A-Za-z0-9._-]+$/.test(text))text='https://open.spotify.com/'+text;
      else if(/^@?[A-Za-z0-9._-]{1,64}$/.test(text))text='https://open.spotify.com/user/'+text.replace(/^@/,'');
    }
    const u=new URL(text);
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>2048)return null;
    if((!kind||kind==='instagram')&&['instagram.com','www.instagram.com'].includes(u.hostname)&&/^\/[A-Za-z0-9._]{1,30}\/?$/.test(u.pathname)){
      const name=u.pathname.replaceAll('/','').toLowerCase();if(['p','reel','reels','stories','explore','accounts','direct'].includes(name))return null;
      return 'https://www.instagram.com/'+name+'/';
    }
    if((!kind||kind==='spotify')&&u.hostname==='open.spotify.com'&&/^\/(?:user\/[A-Za-z0-9._-]{1,64}|playlist\/[A-Za-z0-9]{22})\/?$/.test(u.pathname))return 'https://open.spotify.com'+u.pathname.replace(/\/$/,'');
  }catch{}return null;
}
export function guestProfile(body,id){
  const name=String(body.name||'').replace(/[\u0000-\u001f\u007f]/g,'').trim();
  const comment=String(body.comment||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
  if(name.length<2||name.length>60||comment.length>280||body.website)return null;
  const legacy=presenceLink(body.url),instagramUrl=presenceLink(body.instagramUrl,'instagram')||(legacy?.includes('instagram.com/')?legacy:null),spotifyUrl=presenceLink(body.spotifyUrl,'spotify')||(legacy?.includes('open.spotify.com/')?legacy:null);
  if((body.url&&!legacy)||(body.instagramUrl&&!presenceLink(body.instagramUrl,'instagram'))||(body.spotifyUrl&&!presenceLink(body.spotifyUrl,'spotify')))return null;
  return {id:'guest-'+id,name,comment,url:instagramUrl||spotifyUrl,instagramUrl,spotifyUrl,image:null,source:'guest'};
}
export async function presenceCallback(req,res){
  privateResponse(res);
  const url=new URL(req.url,ROOT),state=url.searchParams.get('state'),proof=unpack(cookie(req,STATE));
  res.setHeader('Set-Cookie',setCookie(STATE,'',0));
  const fail=(code,wait=0)=>res.redirect(302,ROOT+'/?presenca='+code+(wait?'&aguarde='+wait:'')+'#presenca');
  if(!proof||proof.expires<Date.now()||!equal(state,'presence.'+proof.nonce))return fail('conexao-expirada');
  if(url.searchParams.get('error'))return fail('permissao-recusada');
  if(!url.searchParams.get('code'))return fail('conexao-expirada');
  try{
    const token=await fetch('https://accounts.spotify.com/api/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:'Basic '+Buffer.from(process.env.SPOTIFY_CLIENT_ID+':'+process.env.SPOTIFY_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:CALLBACK,code_verifier:proof.verifier})});
    if(token.status===429)return fail('spotify-limite',retrySeconds(token));
    const auth=await token.json();if(!token.ok||!auth.access_token)return fail('conexao-negada');
    const response=await fetch('https://api.spotify.com/v1/me',{headers:{Authorization:'Bearer '+auth.access_token},signal:AbortSignal.timeout(10000)});
    if(response.status===403)return fail('perfil-recusado');
    if(response.status===429){const limit=await rememberSpotifyLimit('/me',response);return fail('spotify-limite',limit.retryAfter);}
    const profile=publicVisitor(await response.json());if(!response.ok||!profile)return fail('conexao-negada');
    const session={profile,nonce:randomBytes(20).toString('base64url'),expires:Date.now()+86400000};
    res.setHeader('Set-Cookie',[setCookie(STATE,'',0),setCookie(SESSION,pack(session),86400)]);
    return res.redirect(302,ROOT+'/?presenca=conectado#presenca');
  }catch{return fail('indisponivel');}
}
export function createPresenceHandler({store=siteStore,creatorConsume}={}){
  const creatorLogin=createCreatorHandler({consume:creatorConsume,issue:res=>{const session={profile:{id:'dq78sjzflg084c1ibpjuo8gjc',name:'ogg',image:null,url:'https://open.spotify.com/user/dq78sjzflg084c1ibpjuo8gjc'},nonce:randomBytes(20).toString('base64url'),authSource:'project-owner',expires:Date.now()+86400000};res.setHeader('Set-Cookie',setCookie(SESSION,pack(session),86400));}});
  return async function handler(req,res){
    privateResponse(res);
    const url=new URL(req.url,ROOT),action=url.searchParams.get('acao')||'lista';
    if(action==='criador')return creatorLogin(req,res);
    if(req.method==='GET'&&action==='lista'){
      try{return res.status(200).json({items:await store().presences(),availability:'ready',spotifyMode:'development'});}
      catch{return res.status(200).json({items:[],availability:'temporarily_unavailable',spotifyMode:'development'});}
    }
    if(req.method==='GET'&&action==='eu'){
      const session=visitorSession(req);let guest=guestSession(req);
      if(secret()&&!guest){guest={id:randomBytes(20).toString('hex'),nonce:randomBytes(20).toString('base64url'),expires:Date.now()+30*86400000};res.setHeader('Set-Cookie',setCookie(GUEST,pack(guest),30*86400));}
      return res.status(200).json({profile:session?.profile||null,csrf:session?sign('csrf:'+session.nonce):null,enabled:Boolean(secret()),owner:session?.profile?.id==='dq78sjzflg084c1ibpjuo8gjc',guest:guest?{id:'guest-'+guest.id,csrf:sign('guest:'+guest.nonce)}:null});
    }
    if(req.method==='GET'&&action==='entrar'){
      if(!secret()||!process.env.SPOTIFY_CLIENT_ID)return res.status(503).json({error:'unavailable'});
      const limit=await spotifyCooldown('/me');
      if(limit)return res.redirect(302,ROOT+'/?presenca=spotify-limite&aguarde='+limit.retryAfter+'#presenca');
      const proof={nonce:randomBytes(24).toString('base64url'),verifier:randomBytes(48).toString('base64url'),expires:Date.now()+600000};
      res.setHeader('Set-Cookie',setCookie(STATE,pack(proof),600));
      const params=new URLSearchParams({client_id:process.env.SPOTIFY_CLIENT_ID,response_type:'code',redirect_uri:CALLBACK,state:'presence.'+proof.nonce,scope:'user-read-private',show_dialog:'true',code_challenge_method:'S256',code_challenge:createHash('sha256').update(proof.verifier).digest('base64url')});
      return res.redirect(302,'https://accounts.spotify.com/authorize?'+params);
    }
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'method_not_allowed'});}
    const session=visitorSession(req),body=typeof req.body==='string'?(()=>{try{return JSON.parse(req.body)}catch{return {}}})():req.body||{};
    if(['convidado','remover-convidado'].includes(action)){
      const guest=guestSession(req);
      if(req.headers?.origin!==ROOT||!guest||!equal(body.csrf,sign('guest:'+guest.nonce)))return res.status(403).json({error:'invalid_session'});
      const key=visitorKey({id:'guest-'+guest.id});
      try{
        if(action==='remover-convidado')return res.status(200).json({items:await store().removePresence(key)});
        const profile=guestProfile(body,guest.id);if(!profile)return res.status(400).json({error:'invalid_fields'});
        const ip=String(req.headers['x-vercel-forwarded-for']||req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
        const rateKey='guest-post:'+createHmac('sha256',secret()).update(ip).digest('hex');
        const previous=await readShared(rateKey),rate=previous?.until>Date.now()?previous:{count:0,until:Date.now()+3600000};
        if(rate.count>=5){res.setHeader('Retry-After',String(Math.ceil((rate.until-Date.now())/1000)));return res.status(429).json({error:'too_many_posts'});}
        await writeShared(rateKey,{...rate,count:rate.count+1},Math.ceil((rate.until-Date.now())/1000));
        profile.previews=await guestLinkPreviews(profile);
        return res.status(200).json({items:await store().mark(profile,key)});
      }catch(error){return res.status(error.code==='profile_already_present'?409:503).json({error:error.code==='profile_already_present'?'profile_already_present':'storage_unavailable'});}
    }
    if(req.headers?.origin!==ROOT||!session||!equal(body.csrf,sign('csrf:'+session.nonce)))return res.status(403).json({error:'invalid_session'});
    if(action==='sair'){res.setHeader('Set-Cookie',setCookie(SESSION,'',0));return res.status(200).json({ok:true});}
    try{
      if(action==='marcar')return res.status(200).json({items:await store().mark(session.profile,visitorKey(session.profile))});
      if(action==='remover')return res.status(200).json({items:await store().removePresence(visitorKey(session.profile))});
      return res.status(400).json({error:'invalid_action'});
    }catch{return res.status(503).json({error:'storage_unavailable'});}
  };
}
