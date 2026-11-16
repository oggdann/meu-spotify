import { getCache } from '@vercel/functions';

// Shared by deployed functions; no tokens or browser sessions belong here.
const cache = getCache({ namespace: 'ogg:services:v1' });
export async function readShared(key) {
  try { return await cache.get(key); } catch { return null; }
}
export async function writeShared(key, value, seconds) {
  try { await cache.set(key, value, { ttl: Math.max(1, Math.ceil(seconds)), name: '' }); } catch {}
}
