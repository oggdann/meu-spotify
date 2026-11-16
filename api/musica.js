import { cached, readOnly, spotifyGet, publicTrack, sendFailure } from '../lib/spotify.js';

export default async function handler(req, res) {
  if (!readOnly(req, res)) return;
  try {
    const data = await cached('now', 4000, async () => {
      const playback = await spotifyGet('/me/player/currently-playing?additional_types=track,episode');
      const track = publicTrack(playback?.item);
      return { ...(track || {}), isPlaying: Boolean(track && playback?.is_playing), hasTrack: Boolean(track), progressMs: Math.max(0, Number(playback?.progress_ms) || 0), checkedAt: Date.now() };
    });
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
    return res.status(200).json(data);
  } catch (error) { return sendFailure(res, error); }
}
