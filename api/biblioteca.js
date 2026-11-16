import { cacheInfo, cached, getToken, imageUrl, publicTrack, readOnly, sendFailure, spotifyGet, spotifyUrl } from '../lib/spotify.js';
import {featuredPlaylists} from '../lib/featured-playlists.js';

export default async function handler(req, res) {
  if (!readOnly(req, res)) return;
  try {
    const data = await cached('library', 300000, async () => {
      const owner = await spotifyGet('/me').catch(() => ({id:'dq78sjzflg084c1ibpjuo8gjc',display_name:'ogg',external_urls:{spotify:'https://open.spotify.com/user/dq78sjzflg084c1ibpjuo8gjc'}}));
      if (!owner?.id) throw new Error('Profile unavailable');
      const profile = { id: owner.id, name: String(owner.display_name || 'Daniel Victor'), image: imageUrl(owner.images?.[0]?.url), url: spotifyUrl(owner.external_urls?.spotify), followers: Number(owner.followers?.total) || 0 };
      const [playlists, recent] = await Promise.allSettled([
        featuredPlaylists(),
        (async()=>{const token=await getToken();if(token.scopes&&!token.scopes.has('user-read-recently-played'))throw {code:'permission_required'};return spotifyGet('/me/player/recently-played?limit=50');})()
      ]);
      return { profile, playlists: playlists.status === 'fulfilled' ? playlists.value.items : [],
        recent: recent.status === 'fulfilled' ? (recent.value?.items || []).map(row => ({ ...publicTrack(row.track), playedAt: row.played_at })).filter(row => row.id) : [],
        availability: { playlists: playlists.status === 'fulfilled' ? (playlists.value.stale ? 'stale' : 'ready') : playlists.reason?.code || 'temporarily_unavailable', recent: recent.status === 'fulfilled' ? (cacheInfo(recent.value).stale ? 'stale' : 'ready') : recent.reason?.code || 'temporarily_unavailable' },
        // Recent-history cooldown must not stop automatic playlist cover refresh.
        retryAfter: playlists.reason?.retryAfter || playlists.value?.retryAfter || 0,
        playlistsTruncated: playlists.status === 'fulfilled' && playlists.value.truncated, checkedAt: Date.now() };
    });
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (error) { return sendFailure(res, error); }
}
