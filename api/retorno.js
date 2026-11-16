import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';
import { available, equals, OWNER_ID, page, privateHeaders, REDIRECT_URI, sign } from '../lib/owner-auth.js';
export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).end(); }
  const url = new URL(req.url,'https://oggspotify.vercel.app'), state = url.searchParams.get('state') || '';
  const cookie = String(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('__Host-ogg-spotify-state='))?.slice('__Host-ogg-spotify-state='.length);
  const parts = state.split('.'), nonce = parts.slice(0,2).join('.'), age = Date.now() - Number(parts[0]);
  if (!available() || parts.length !== 3 || !equals(state,cookie) || !equals(parts[2],sign(nonce)) || !Number.isFinite(age) || age < 0 || age > 900000) return page(res,400,'Link inválido ou expirado.','Reabra o link de conexão enviado na conversa.');
  res.setHeader('Set-Cookie','__Host-ogg-spotify-state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
  if (url.searchParams.has('error') || !url.searchParams.get('code')) return page(res,400,'A conexão não foi concluída.','Nenhuma permissão foi alterada no site. Você pode tentar novamente.');
  try {
    const response = await fetch('https://accounts.spotify.com/api/token',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:REDIRECT_URI})});
    const data = await response.json();
    if (!response.ok || !data.refresh_token || !data.access_token) throw new Error('exchange_failed');
    const meResponse = await fetch('https://api.spotify.com/v1/me',{signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${data.access_token}`}});
    const me = await meResponse.json();
    if (!meResponse.ok || me.id !== OWNER_ID) return page(res,403,'Essa conta não é a do OGG.','A configuração foi interrompida. Entre com a mesma conta do perfil do site.');
    const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({refreshToken:data.refresh_token,ownerId:me.id,scope:data.scope,createdAt:Date.now()}),'utf8'),cipher.final()]);
    const envelope = {v:1,key:publicEncrypt({key:process.env.OGG_SETUP_PUBLIC_KEY,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64url'),iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),data:ciphertext.toString('base64url')};
    const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
    return page(res,200,'Conexão autorizada. ✦','Volte à conversa e avise que terminou para concluir a ativação. O código abaixo está criptografado; nenhuma chave da sua conta é mostrada aqui.',payload);
  } catch { return page(res,502,'Não deu para concluir agora.','A conexão com o Spotify falhou. Nenhuma credencial do site foi substituída; reabra o link para tentar novamente.'); }
}
