import { ownerNow, readOnly, sendFailure } from '../lib/spotify.js';

export default async function handler(req, res) {
  if (!readOnly(req, res)) return;
  try {
    const data = await ownerNow();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=5, stale-while-revalidate=5');
    return res.status(200).json(data);
  } catch (error) { return sendFailure(res, error); }
}
