import { cacheInfo, cached, getToken, imageUrl, plainDescription, publicTrack, readOnly, sendFailure, spotifyGet, spotifyUrl } from '../lib/spotify.js';

async function publicPlaylists(profile) {
  const items = []; let base = '/me/playlists', stale = false, retryAfter = 0;
  for (let offset = 0; offset < 500; offset += 50) {
    let page;
    try { page = await spotifyGet(`${base}?limit=50&offset=${offset}`); }
    catch (error) {
      if (offset === 0 && error.code === 'permission_required') {
        base = `/users/${encodeURIComponent(profile.id)}/playlists`;
        page = await spotifyGet(`${base}?limit=50&offset=0`);
      } else throw error;
    }
    stale ||= Boolean(cacheInfo(page).stale);
    retryAfter = Math.max(retryAfter, cacheInfo(page).retryAfter || 0);
    for (const p of page?.items || []) {
      if (!p || p.public !== true || p.owner?.id !== profile.id || !/^[a-zA-Z0-9]{22}$/.test(p.id || '')) continue;
      items.push({ id: p.id, uri: `spotify:playlist:${p.id}`, name: String(p.name || 'Playlist'), description: plainDescription(p.description), image: imageUrl(p.images?.[0]?.url), url: spotifyUrl(p.external_urls?.spotify), total: Number(p.items?.total ?? p.tracks?.total) || 0 });
    }
    if (!page?.next || !page.items?.length) return { items, truncated: false, stale, retryAfter };
  }
  return { items, truncated: true, stale, retryAfter };
}
export default async function handler(req, res) {
  if (!readOnly(req, res)) return;
  try {
    const data = await cached('library', 300000, async () => {
      const owner = await spotifyGet('/me');
      if (!owner?.id) throw new Error('Profile unavailable');
      const profile = { id: owner.id, name: String(owner.display_name || 'Daniel Victor'), image: imageUrl(owner.images?.[0]?.url), url: spotifyUrl(owner.external_urls?.spotify), followers: Number(owner.followers?.total) || 0 };
      const token = await getToken();
      const [playlists, recent] = await Promise.allSettled([
        publicPlaylists(profile),
        token.scopes && !token.scopes.has('user-read-recently-played')
          ? Promise.reject(Object.assign(new Error('permission_required'), { code: 'permission_required' }))
          : spotifyGet('/me/player/recently-played?limit=50')
      ]);
      return { profile, playlists: playlists.status === 'fulfilled' ? playlists.value.items : [],
        recent: recent.status === 'fulfilled' ? (recent.value?.items || []).map(row => ({ ...publicTrack(row.track), playedAt: row.played_at })).filter(row => row.id) : [],
        availability: { playlists: playlists.status === 'fulfilled' ? (playlists.value.stale ? 'stale' : 'ready') : playlists.reason?.code || 'temporarily_unavailable', recent: recent.status === 'fulfilled' ? (cacheInfo(recent.value).stale ? 'stale' : 'ready') : recent.reason?.code || 'temporarily_unavailable' },
        retryAfter: Math.max(playlists.reason?.retryAfter || playlists.value?.retryAfter || 0, recent.reason?.retryAfter || cacheInfo(recent.value).retryAfter || 0),
        playlistsTruncated: playlists.status === 'fulfilled' && playlists.value.truncated, checkedAt: Date.now() };
    });
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json(data);
  } catch (error) { return sendFailure(res, error); }
}
