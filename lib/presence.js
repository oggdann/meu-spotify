import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {siteStore} from './site-store.js';
import {imageUrl,spotifyUrl,spotifyCooldown,rememberSpotifyLimit,retrySeconds} from './spotify.js';
const ROOT='https://oggspotify.vercel.app',CALLBACK=ROOT+'/api/retorno';
const SESSION='__Host-ogg-presence',STATE='__Host-ogg-presence-state';
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
export function createPresenceHandler({store=siteStore}={}){
  return async function handler(req,res){
    privateResponse(res);
    const url=new URL(req.url,ROOT),action=url.searchParams.get('acao')||'lista';
    if(req.method==='GET'&&action==='lista'){
      try{return res.status(200).json({items:await store().presences(),availability:'ready',spotifyMode:'development'});}
      catch{return res.status(200).json({items:[],availability:'temporarily_unavailable',spotifyMode:'development'});}
    }
    if(req.method==='GET'&&action==='eu'){
      const session=visitorSession(req);return res.status(200).json({profile:session?.profile||null,csrf:session?sign('csrf:'+session.nonce):null,enabled:Boolean(secret())});
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
    if(req.headers?.origin!==ROOT||!session||!equal(body.csrf,sign('csrf:'+session.nonce)))return res.status(403).json({error:'invalid_session'});
    if(action==='sair'){res.setHeader('Set-Cookie',setCookie(SESSION,'',0));return res.status(200).json({ok:true});}
    try{
      if(action==='marcar')return res.status(200).json({items:await store().mark(session.profile,visitorKey(session.profile))});
      if(action==='remover')return res.status(200).json({items:await store().removePresence(visitorKey(session.profile))});
      return res.status(400).json({error:'invalid_action'});
    }catch{return res.status(503).json({error:'storage_unavailable'});}
  };
}
