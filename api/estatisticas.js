import { measuredSnapshot } from '../lib/site-store.js';
import { cached, getToken, imageUrl, publicTrack, readOnly, sendFailure, spotifyGet, spotifyUrl } from '../lib/spotify.js';

export function summarizeRecent(items, now = Date.now()) {
  const unique = new Map();
  for (const item of items || []) {
    const track = publicTrack(item.track), at = Date.parse(item.played_at);
    if (!track || !Number.isFinite(at) || at > now) continue;
    unique.set(track.id + ':' + at, { track, at, artists: item.track.artists || [] });
  }
  return [7, 30].map(days => {
    const rows = [...unique.values()].filter(row => row.at >= now - days * 86400000);
    const tracks = new Map(), artists = new Map();
    for (const row of rows) {
      const song = tracks.get(row.track.id) || { ...row.track, count: 0 };
      song.count++; tracks.set(song.id, song);
      for (const artist of row.artists) {
        if (!/^[A-Za-z0-9]{22}$/.test(artist.id || '')) continue;
        const entry = artists.get(artist.id) || { id: artist.id, name: String(artist.name || 'Artista'), url: 'https://open.spotify.com/artist/' + artist.id, count: 0 };
        entry.count++; artists.set(entry.id, entry);
      }
    }
    return { days, plays: rows.length, minutes: null, sampleOnly: true,
      oldestRecord: rows.length ? new Date(Math.min(...rows.map(row => row.at))).toISOString() : null,
      artists: [...artists.values()].sort((a, b) => b.count - a.count).slice(0, 5),
      tracks: [...tracks.values()].sort((a, b) => b.count - a.count).slice(0, 5) };
  });
}
export default async function handler(req, res) {
  if (!readOnly(req, res)) return;
  try {
    const data = await cached('listening-stats', 300000, async () => {
      const token = await getToken();
      const canTop = !token.scopes || token.scopes.has('user-top-read');
      const jobs = await Promise.allSettled([
        spotifyGet('/me/player/recently-played?limit=50'),
        canTop ? spotifyGet('/me/top/artists?time_range=short_term&limit=5') : Promise.reject({ code: 'permission_required' }),
        canTop ? spotifyGet('/me/top/tracks?time_range=short_term&limit=5') : Promise.reject({ code: 'permission_required' })
      ]);
      const recent = jobs[0];
      const topReady = jobs[1].status === 'fulfilled' && jobs[2].status === 'fulfilled';
      const top = {
        availability: topReady ? 'ready' : (jobs.find(job => job.status === 'rejected')?.reason?.code || 'temporarily_unavailable'),
        period: 'last_four_weeks',
        artists: topReady ? (jobs[1].value?.items || []).filter(item => /^[A-Za-z0-9]{22}$/.test(item.id || '')).map(item => ({ id: item.id, name: String(item.name || 'Artista'), image: imageUrl(item.images?.[0]?.url), url: spotifyUrl(item.external_urls?.spotify) })) : [],
        tracks: topReady ? (jobs[2].value?.items || []).map(publicTrack).filter(Boolean) : []
      };
      const now = Date.now();
      return { sampleSize: recent.status === 'fulfilled' ? recent.value?.items?.length || 0 : 0,
        periods: summarizeRecent(recent.status === 'fulfilled' ? recent.value?.items : [], now),
        recentAvailability: recent.status === 'fulfilled' ? 'ready' : recent.reason?.code || 'temporarily_unavailable',
        exactMinutesAvailability: 'extended_history_required', top, checkedAt: now };
    });
    const measured = await measuredSnapshot();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=30');
    return res.status(200).json({...data, measured});
  } catch (error) { return sendFailure(res, error); }
}
