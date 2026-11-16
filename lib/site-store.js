import { getCache } from '@vercel/functions';
import { get, put, list, del } from '@vercel/blob';

const namespace = 'prj_oEwb70wsoYApnceCEz3cc5QzWcjp:ogg';
export function createSiteStore({ cache, read, write, listing, remove, now = Date.now }) {
  return {
    async measured() {
      try { const value = await cache.get('measured'); if (value) return value.unavailable ? null : value; } catch {}
      const stored = await read('listening/latest.json').catch(() => null);
      if (stored?.value) { try { await cache.set('measured', stored.value, { ttl: 86400 }); } catch {} }
      else { try { await cache.set('measured', {unavailable:true}, {ttl:60}); } catch {} }
      return stored?.value || null;
    },
    async saveMeasured(value) {
      let previous, durable;
      try { previous = await cache.get('measured'); } catch {}
      if (!previous?.updatedAt) {
        durable = await read('listening/latest.json').catch(() => null);
        previous = durable?.value;
      }
      if (previous?.updatedAt > value.updatedAt) return false;
      await cache.set('measured', value, { ttl: 86400 });
      let checkpoint = 0;
      try { checkpoint = Number(await cache.get('checkpoint')) || 0; } catch {}
      if (now() - checkpoint >= 3600000) {
        const old = durable || await read('listening/latest.json').catch(() => null);
        if (!old?.value || old.value.updatedAt <= value.updatedAt) {
          try { await write('listening/latest.json', value, old?.etag); } catch (error) { if (error?.name !== 'BlobPreconditionFailedError') throw error; }
        }
        await cache.set('checkpoint', now(), { ttl: 86400 });
      }
      return true;
    },
    async presences(refresh = false) {
      if (!refresh) { try { const value = await cache.get('presences'); if (value) return value; } catch {} }
      const files = await listing('presence/');
      const entries = await Promise.all(files.map(file => read(file.pathname).catch(() => null)));
      const items = entries.map(item => item?.value).filter(item => item?.presentAt > now() - 30 * 86400000).sort((a,b) => b.presentAt - a.presentAt).slice(0, 30);
      try { await cache.set('presences', items, { ttl: 3600 }); } catch {}
      return items;
    },
    async mark(profile, key) {
      const previous = (await this.presences()).find(item => item.id === profile.id);
      if (previous?.presentAt > now() - 900000) return this.presences();
      await write('presence/' + key + '.json', { ...profile, presentAt: now() });
      return this.presences(true);
    },
    async removePresence(key) { await remove('presence/' + key + '.json'); return this.presences(true); }
  };
}
let store;
export function siteStore() {
  if (!store) {
    const cache = getCache({ namespace });
    store = createSiteStore({
      cache,
      read: async path => {
        const result = await get(path, { access: 'private', useCache: false });
        if (!result || result.statusCode !== 200) return null;
        return { value: await new Response(result.stream).json(), etag: result.blob.etag };
      },
      write: async (path, value, etag) => put(path, JSON.stringify(value), {
        access:'private', addRandomSuffix:false, allowOverwrite:true, contentType:'application/json',
        ...(etag ? {ifMatch:etag} : {})
      }),
      listing: async prefix => (await list({prefix,limit:1000})).blobs,
      remove: path => del(path)
    });
  }
  return store;
}
export async function measuredSnapshot() {
  if (!process.env.VERCEL && !process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return null;
  try { return await siteStore().measured(); } catch { return null; }
}
