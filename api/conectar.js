import { randomBytes } from 'node:crypto';
import { available, equals, page, privateHeaders, REDIRECT_URI, SCOPES, sign } from '../lib/owner-auth.js';
export default function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).end(); }
  const url = new URL(req.url, 'https://oggspotify.vercel.app');
  if (!available() || !equals(url.searchParams.get('chave'), process.env.OGG_SETUP_KEY)) return page(res,404,'OGG','Esse link de configuração não está disponível.');
  const nonce = `${Date.now()}.${randomBytes(24).toString('base64url')}`;
  const state = `${nonce}.${sign(nonce)}`;
  res.setHeader('Set-Cookie', `__Host-ogg-spotify-state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=900`);
  const authorize = new URL('https://accounts.spotify.com/authorize');
  authorize.search = new URLSearchParams({ client_id: process.env.SPOTIFY_CLIENT_ID, response_type:'code', redirect_uri:REDIRECT_URI, scope:SCOPES, state, show_dialog:'true' }).toString();
  return res.redirect(302, authorize.href);
}
