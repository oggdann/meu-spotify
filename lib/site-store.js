import { getCache } from '@vercel/functions';
import { get, put, list, del } from '@vercel/blob';

const namespace = 'prj_oEwb70wsoYApnceCEz3cc5QzWcjp:ogg';
export function createSiteStore({ cache, read, write, listing, remove, now = Date.now }) {
  return {
    async presences(refresh = false) {
      if (!refresh) { try { const value = await cache.get('presences-v2'); if (value) return value; } catch {} }
      const files = await listing('presence/');
      const entries = await Promise.all(files.map(file => read(file.pathname)));
      const items = entries.map(item => item?.value).filter(item => item?.presentAt > now() - 30 * 86400000).sort((a,b) => b.presentAt - a.presentAt).slice(0, 30);
      try { await cache.set('presences-v2', items, { ttl: 60 }); } catch {}
      return items;
    },
    async mark(profile, key) {
      const items=await this.presences(profile.source==='guest');
      const previous = items.find(item => item.id === profile.id);
      if(profile.source==='guest'){
        if(previous)return items;
        const identities=value=>[value.instagramUrl,value.spotifyUrl,value.url].filter(url=>typeof url==='string'&&(/instagram\.com\//.test(url)||/open\.spotify\.com\/user\//.test(url))).map(url=>url.replace(/\/$/,''));
        const profiles=identities(profile);
        if(items.some(item=>identities(item).some(url=>profiles.includes(url))))throw Object.assign(new Error('profile_already_present'),{code:'profile_already_present'});
      }
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
        if (!result) return null;
        if (result.statusCode !== 200) throw new Error('presence_read_unavailable');
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
