import { cached, ownerNow, publicTrack, readOnly, sendFailure, spotifyGet } from '../lib/spotify.js';
import { resolveVideo, verifiedVideos } from '../lib/youtube.js';

export default async function handler(req, res) {
  if (!readOnly(req, res)) return;
  const id = new URL(req.url, 'https://oggspotify.vercel.app').searchParams.get('track');
  if (!/^[A-Za-z0-9]{22}$/.test(id || '')) return res.status(400).json({ error: 'invalid_track' });
  try {
    let result;
    if (verifiedVideos[id]) result = await resolveVideo({ id });
    else if (!process.env.YOUTUBE_API_KEY) result = { videoId: null, reason: 'search_not_configured' };
    else {
      // Public requests may only search the owner's current/recent tracks.
      // Never become an arbitrary search proxy that consumes the owner's quota.
      const now = await ownerNow();
      let track = now.id === id && now.type === 'track' ? now : null;
      if (!track) {
        const recent = await cached('video-recent', 60000, async () => {
          const data = await spotifyGet('/me/player/recently-played?limit=50');
          return (data?.items || []).map(row => publicTrack(row.track)).filter(item => item?.type === 'track');
        });
        track = recent.find(item => item.id === id);
      }
      if (!track) { res.setHeader('Cache-Control', 'no-store'); return res.status(404).json({ error: 'track_not_in_collection' }); }
      result = await resolveVideo(track);
    }
    res.setHeader('Cache-Control', result.videoId ? 'public, max-age=3600, s-maxage=86400' : 'public, max-age=0, s-maxage=60');
    return res.status(200).json({ trackId: id, ...result });
  } catch (error) { return sendFailure(res, error); }
}
