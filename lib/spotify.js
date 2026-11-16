import { readShared, writeShared } from './service-cache.js';
// Server-only. Shared snapshots reduce calls across visitors and functions.
let tokenCache, refreshing;
let blockedUntil = 0;
const snapshots = new Map(), pending = new Map();

export class SpotifyError extends Error {
  constructor(code, status = 503, retryAfter = 0) {
    super(code); this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}
export function readOnly(req, res) {
  if (['GET', 'HEAD'].includes(req.method)) return true;
  res.setHeader('Allow', 'GET, HEAD'); res.setHeader('Cache-Control', 'no-store');
  res.status(405).json({ error: 'method_not_allowed' }); return false;
}
export async function cached(key, ttl, work) {
  const entry = snapshots.get(key);
  if (entry && entry.expires > Date.now()) return entry.value;
  if (pending.has(key)) return pending.get(key);
  const task = Promise.resolve().then(work).then(value => {
    const lifetime = typeof ttl === 'function' ? ttl(value) : ttl;
    snapshots.set(key, { value, expires: Date.now() + lifetime }); return value;
  }).finally(() => pending.delete(key));
  pending.set(key, task); return task;
}
async function request(url, options) {
  try { return await fetch(url, { ...options, signal: AbortSignal.timeout(8000) }); }
  catch { throw new SpotifyError('temporarily_unavailable'); }
}
export function retrySeconds(response) {
  const raw = response.headers.get('Retry-After');
  const seconds = Number(raw) || (Date.parse(raw) - Date.now()) / 1000;
  return Math.max(1, Math.ceil(Number.isFinite(seconds) && seconds > 0 ? seconds : 60));
}
const limitKey = path => 'spotify:limit:' + (process.env.SPOTIFY_CLIENT_ID || '') + ':' + path.split('?')[0];
export async function spotifyCooldown(path) {
  const entry = await readShared(limitKey(path));
  if (entry?.until > Date.now()) return new SpotifyError(entry.code, 503, Math.ceil((entry.until - Date.now()) / 1000));
  return null;
}
export async function rememberSpotifyLimit(path, response) {
  let body; try { body = await response.json(); } catch {}
  const code = body?.error?.reason === 'QUOTA_EXCEEDED' ? 'quota_exceeded' : 'rate_limited';
  const wait = retrySeconds(response);
  await writeShared(limitKey(path), { code, until: Date.now() + wait * 1000 }, wait);
  return new SpotifyError(code, 503, wait);
}
function snapshotLifetime(path) {
  if (path === '/me') return 3600000;
  if (path.includes('/top/')) return 7200000;
  if (path.includes('recently-played')) return 300000;
  if (path.includes('/playlists?')) return 900000;
  return 0;
}
export const cacheInfo = value => value?.__oggCache || {};
export async function getToken() {
  if (tokenCache && tokenCache.expires > Date.now() + 30000) return tokenCache;
  if (refreshing) return refreshing;
  if (blockedUntil > Date.now()) throw new SpotifyError('authorization_required', 503, 30);
  refreshing = (async () => {
    const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret, SPOTIFY_REFRESH_TOKEN: refresh } = process.env;
    if (!id || !secret || !refresh) throw new SpotifyError('configuration_required');
    const response = await request('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh })
    });
    let data;
    try { data = await response.json(); } catch { throw new SpotifyError('temporarily_unavailable'); }
    if (!response.ok || !data.access_token) {
      if (data.error === 'invalid_grant' || response.status === 401) {
        blockedUntil = Date.now() + 30000; throw new SpotifyError('authorization_required', 503, 30);
      }
      throw new SpotifyError('temporarily_unavailable', 503, retrySeconds(response));
    }
    tokenCache = { value: data.access_token, expires: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000, scopes: typeof data.scope === 'string' ? new Set(data.scope.split(' ')) : null };
    return tokenCache;
  })().finally(() => { refreshing = null; });
  return refreshing;
}
export async function spotifyGet(path, retried = false) {
  // Never proxy visitor-supplied URLs or forward credentials to another host.
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw new SpotifyError('invalid_resource', 400);
  const lifetime = snapshotLifetime(path), key = 'spotify:data:' + (process.env.SPOTIFY_CLIENT_ID || '') + ':' + path;
  const saved = lifetime ? await readShared(key) : null;
  if (saved?.savedAt + lifetime > Date.now()) return saved.data;
  try {
  const limit = await spotifyCooldown(path);
  if (limit) throw limit;
  const token = await getToken();
  const response = await request(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token.value}` } });
  if (response.status === 204) return null;
  if (response.status === 401 && !retried) { tokenCache = null; return spotifyGet(path, true); }
  if (response.status === 403) throw new SpotifyError('permission_required', 403);
  if (response.status === 429) throw await rememberSpotifyLimit(path, response);
  if (!response.ok) throw new SpotifyError('temporarily_unavailable');
  let data;
  try { data = await response.json(); } catch { throw new SpotifyError('temporarily_unavailable'); }
  if (lifetime) await writeShared(key, { data, savedAt: Date.now() }, 86400);
  return data;
  } catch (error) {
    // Permission/auth failures must not revive revoked data. Transient failures
    // can use a bounded previous snapshot, explicitly labelled by the API.
    if (saved?.savedAt + 86400000 > Date.now() && ['rate_limited', 'quota_exceeded', 'temporarily_unavailable'].includes(error.code)) {
      return { ...saved.data, __oggCache: { stale: true, savedAt: saved.savedAt, reason: error.code, retryAfter: error.retryAfter || 60 } };
    }
    throw error;
  }
}
export function spotifyUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'open.spotify.com' ? u.href : null; }
  catch { return null; }
}
export function imageUrl(value) {
  try {
    const u = new URL(value), h = u.hostname;
    return u.protocol === 'https:' && (h.endsWith('.scdn.co') || h.endsWith('.spotifycdn.com') || h.endsWith('.cdninstagram.com') || h.endsWith('.fbcdn.net') || h === 'platform-lookaside.fbsbx.com') ? u.href : null;
  } catch { return null; }
}
export function plainDescription(value) {
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (!key.startsWith('#')) return entities[key] || match;
    const point = key.startsWith('#x') ? parseInt(key.slice(2),16) : parseInt(key.slice(1),10);
    return point >= 32 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  }).replace(/<[^>]*>/g, '').slice(0,300);
}
export function publicTrack(item) {
  if (!item || !['track', 'episode'].includes(item.type) || !/^[a-zA-Z0-9]{22}$/.test(item.id || '')) return null;
  return { id: item.id, type: item.type, uri: `spotify:${item.type}:${item.id}`, title: String(item.name || 'Sem título'),
    artist: item.type === 'episode' ? String(item.show?.name || 'Podcast') : (item.artists || []).map(a => a.name).filter(Boolean).join(', '),
    artists: (item.artists || []).filter(a => /^[A-Za-z0-9]{22}$/.test(a.id || '')).map(a => ({id:a.id,name:String(a.name || '')})),
    primaryArtist: String(item.type === 'episode' ? item.show?.name || 'Podcast' : item.artists?.[0]?.name || ''),
    album: item.album?.name || item.show?.name || '', albumImageUrl: imageUrl(item.album?.images?.[0]?.url || item.images?.[0]?.url),
    songUrl: spotifyUrl(item.external_urls?.spotify), durationMs: Number(item.duration_ms) || 0 };
}
async function publicPlaylistContext(context) {
  if (context?.type !== 'playlist') return null;
  const id = /^spotify:playlist:([A-Za-z0-9]{22})$/.exec(context.uri || '')?.[1];
  if (!id) return null;
  try {
    return await cached('playing-playlist:' + id, 60000, async () => {
      const playlist = await spotifyGet('/playlists/' + id + '?fields=id,name,public,images');
      // Never publish raw contexts: they can refer to a private collection.
      if (playlist?.id !== id || playlist.public !== true) return null;
      return { id, name: String(playlist.name || 'Playlist').slice(0, 200), image: imageUrl(playlist.images?.[0]?.url), url: 'https://open.spotify.com/playlist/' + id };
    });
  } catch { return null; }
}
export function ownerNow() {
  return cached('now', 4000, async () => {
    const playback = await spotifyGet('/me/player/currently-playing?additional_types=track,episode');
    const track = publicTrack(playback?.item);
    const checkedAt = Date.now();
    const playlist = track ? await publicPlaylistContext(playback?.context) : null;
    return { ...(track || {}), isPlaying: Boolean(track && playback?.is_playing), hasTrack: Boolean(track), progressMs: Math.max(0, Number(playback?.progress_ms) || 0), checkedAt, playlist };
  });
}
export function sendFailure(res, error) {
  const known = error instanceof SpotifyError;
  res.setHeader('Cache-Control', 'no-store');
  if (known && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
  return res.status(known && error.status === 400 ? 400 : 503).json({ error: known ? error.code : 'temporarily_unavailable', ...(known && error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
}
