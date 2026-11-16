import { createHmac, timingSafeEqual } from 'node:crypto';
export const REDIRECT_URI = 'https://oggspotify.vercel.app/api/retorno';
export const OWNER_ID = 'dq78sjzflg084c1ibpjuo8gjc';
export const SCOPES = 'user-read-currently-playing user-read-recently-played playlist-read-private user-top-read';
export function equals(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
export function available() {
  return Boolean(process.env.OGG_SETUP_KEY && process.env.OGG_SETUP_PUBLIC_KEY && Number(process.env.OGG_SETUP_EXPIRES_AT) > Date.now());
}
export function sign(value) { return createHmac('sha256', process.env.OGG_SETUP_KEY).update(value).digest('base64url'); }
export function privateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
}
export function page(res, status, heading, message, payload = '') {
  privateHeaders(res); res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const code = payload ? `<textarea id="activation-code" readonly aria-label="Código de ativação protegido">${payload}</textarea>` : '';
  return res.status(status).send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OGG • Conexão Spotify</title><style>body{background:#101110;color:#f2f2e9;font:16px/1.6 system-ui;margin:0;min-height:100vh;display:grid;place-items:center}main{max-width:640px;padding:35px}h1{letter-spacing:-1px;color:#c9f76b}p{color:#b0bba3}textarea{width:100%;height:140px;background:#20251a;color:#c9f76b;border:1px solid #485c30;border-radius:8px;padding:12px;box-sizing:border-box;margin-top:18px;font-size:10px;resize:vertical}</style><main><h1>${heading}</h1><p>${message}</p>${code}</main></html>`);
}
