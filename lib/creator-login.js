import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {put} from '@vercel/blob';
const ROOT='https://oggspotify.vercel.app',key=()=>process.env.OGG_CREATOR_LOGIN_KEY;
const mac=value=>createHmac('sha256',key()).update('creator-login:'+value).digest('base64url');
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);};
export function createCreatorTicket(now=Date.now()){
 if(!key()||key().length<32)throw Error('owner_login_unavailable');
 const body=Buffer.from(JSON.stringify({v:1,purpose:'creator-login',nonce:randomBytes(24).toString('base64url'),issued:now,expires:now+600000})).toString('base64url');return body+'.'+mac(body);
}
export function verifyCreatorTicket(token,now=Date.now()){
 if(!key()||key().length<32||typeof token!=='string'||token.length>1024)return null;
 const [body,sig,...rest]=token.split('.');if(!body||rest.length||!equal(mac(body),sig))return null;
 try{const data=JSON.parse(Buffer.from(body,'base64url').toString());return data.v===1&&data.purpose==='creator-login'&&/^[A-Za-z0-9_-]{32}$/.test(data.nonce)&&Number.isSafeInteger(data.issued)&&Number.isSafeInteger(data.expires)&&data.issued<=now&&data.expires>now&&data.expires-data.issued===600000&&data.expires<=now+600000?data:null;}catch{return null;}
}
async function consumeTicket(nonce,expires){
 try{await put('creator-login-used/'+createHash('sha256').update(nonce).digest('hex')+'.json',JSON.stringify({usedAt:Date.now(),expires}),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'});return true;}
 catch(e){if([409,412].includes(e.status)||/already exists|precondition|conflict/i.test(e.name+' '+e.message))return false;throw e;}
}
export function createCreatorHandler({consume=consumeTicket,issue}={}){
 return async(req,res)=>{
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  if(req.headers?.origin!==ROOT)return res.status(403).json({error:'invalid_access'});
  let body=req.body;try{if(typeof body==='string')body=JSON.parse(body);}catch{return res.status(400).json({error:'invalid_body'});}
  const data=verifyCreatorTicket(body?.token);if(!data)return res.status(403).json({error:'invalid_access'});
  try{if(!await consume(data.nonce,data.expires))return res.status(403).json({error:'invalid_access'});issue(res);return res.status(200).json({ok:true});}
  catch{return res.status(503).json({error:'temporarily_unavailable'});}
 };
}
