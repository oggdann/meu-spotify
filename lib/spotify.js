// Server-only. Warm-instance caches are optional optimizations, not durable state.
let tokenCache, refreshing;
let blockedUntil = 0;
const snapshots = new Map(), pending = new Map(), cooldowns = new Map();

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
    snapshots.set(key, { value, expires: Date.now() + ttl }); return value;
  }).finally(() => pending.delete(key));
  pending.set(key, task); return task;
}
async function request(url, options) {
  try { return await fetch(url, { ...options, signal: AbortSignal.timeout(8000) }); }
  catch { throw new SpotifyError('temporarily_unavailable'); }
}
function retrySeconds(response) {
  return Math.min(300, Math.max(1, Number(response.headers.get('Retry-After')) || 15));
}
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
  const until = cooldowns.get(path) || 0;
  if (until > Date.now()) throw new SpotifyError('rate_limited', 503, Math.ceil((until - Date.now()) / 1000));
  const token = await getToken();
  const response = await request(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token.value}` } });
  if (response.status === 204) return null;
  if (response.status === 401 && !retried) { tokenCache = null; return spotifyGet(path, true); }
  if (response.status === 403) throw new SpotifyError('permission_required', 403);
  if (response.status === 429) {
    const wait = retrySeconds(response); cooldowns.set(path, Date.now() + wait * 1000);
    throw new SpotifyError('rate_limited', 503, wait);
  }
  if (!response.ok) throw new SpotifyError('temporarily_unavailable');
  try { return await response.json(); } catch { throw new SpotifyError('temporarily_unavailable'); }
}
export function spotifyUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'open.spotify.com' ? u.href : null; }
  catch { return null; }
}
export function imageUrl(value) {
  try {
    const u = new URL(value), h = u.hostname;
    return u.protocol === 'https:' && (h.endsWith('.scdn.co') || h.endsWith('.spotifycdn.com') || h === 'platform-lookaside.fbsbx.com') ? u.href : null;
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
    primaryArtist: String(item.type === 'episode' ? item.show?.name || 'Podcast' : item.artists?.[0]?.name || ''),
    album: item.album?.name || item.show?.name || '', albumImageUrl: imageUrl(item.album?.images?.[0]?.url || item.images?.[0]?.url),
    songUrl: spotifyUrl(item.external_urls?.spotify), durationMs: Number(item.duration_ms) || 0 };
}
export function ownerNow() {
  return cached('now', 4000, async () => {
    const playback = await spotifyGet('/me/player/currently-playing?additional_types=track,episode');
    const track = publicTrack(playback?.item);
    return { ...(track || {}), isPlaying: Boolean(track && playback?.is_playing), hasTrack: Boolean(track), progressMs: Math.max(0, Number(playback?.progress_ms) || 0), checkedAt: Date.now() };
  });
}
export function sendFailure(res, error) {
  const known = error instanceof SpotifyError;
  res.setHeader('Cache-Control', 'no-store');
  if (known && error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
  return res.status(known && error.status === 400 ? 400 : 503).json({ error: known ? error.code : 'temporarily_unavailable' });
}
