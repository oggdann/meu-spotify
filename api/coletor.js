import { equalSecret, validateListeningSnapshot } from '../lib/listening.js';
import { siteStore } from '../lib/site-store.js';

export function createCollectorHandler({ store = siteStore, now = Date.now } = {}) {
  return async function handler(req,res) {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
    const bearer=String(req.headers?.authorization||'').replace(/^Bearer\s+/i,'');
    if(req.method==='GET'){
      const expires=Number(process.env.OGG_COLLECTOR_SETUP_EXPIRES_AT);
      if(!(expires>now())||!equalSecret(bearer,process.env.OGG_SETUP_KEY)||!process.env.OGG_COLLECTOR_TOKEN) return res.status(404).json({error:'not_found'});
      return res.status(200).json({version:1,ownerId:'dq78sjzflg084c1ibpjuo8gjc',pollUrl:'https://oggspotify.vercel.app/api/musica',uploadUrl:'https://oggspotify.vercel.app/api/coletor',token:process.env.OGG_COLLECTOR_TOKEN,pollSeconds:15,uploadSeconds:60});
    }
    if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'method_not_allowed'});}
    if(!equalSecret(bearer,process.env.OGG_COLLECTOR_TOKEN))return res.status(401).json({error:'unauthorized'});
    if(Number(req.headers?.['content-length'])>65536)return res.status(413).json({error:'too_large'});
    let snapshot;
    try{
      const body=typeof req.body==='string'?JSON.parse(req.body):req.body;
      if(Buffer.byteLength(JSON.stringify(body||{}))>65536)throw Error('too_large');
      snapshot=validateListeningSnapshot(body,now());
    }catch{return res.status(400).json({error:'invalid_snapshot'});}
    try{return res.status(200).json({accepted:await store().saveMeasured(snapshot),updatedAt:snapshot.updatedAt});}
    catch{return res.status(503).json({error:'storage_unavailable'});}
  };
}
export default createCollectorHandler();
