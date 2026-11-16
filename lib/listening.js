import { timingSafeEqual } from 'node:crypto';
export function equalSecret(a,b) {
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);
}
const spotifyLink = value => {
  try { const u=new URL(value);return u.protocol==='https:'&&u.hostname==='open.spotify.com'?u.href:null; } catch {return null;}
};
const picture = value => {
  try { const u=new URL(value);return u.protocol==='https:'&&(u.hostname.endsWith('.scdn.co')||u.hostname.endsWith('.spotifycdn.com'))?u.href:null; } catch {return null;}
};
export function validateListeningSnapshot(input, now=Date.now()) {
  if (!input || input.version!==1 || input.mode!=='playback_progress') throw new Error('invalid_snapshot');
  const updatedAt=Number(input.updatedAt),startedAt=Number(input.startedAt);
  if (!Number.isFinite(updatedAt)||updatedAt>now+300000||updatedAt<now-7*86400000||!Number.isFinite(startedAt)||startedAt<=0||startedAt>updatedAt) throw new Error('invalid_date');
  if (!Array.isArray(input.periods)||input.periods.length<2||input.periods.length>4) throw new Error('invalid_periods');
  if (new Set(input.periods.map(period=>period.days)).size!==2) throw new Error('invalid_periods');
  const periods=input.periods.map(period=>{
    const start=Number(period.start),end=Number(period.end),heardMs=Number(period.heardMs),plays=Number(period.plays);
    if (![7,30].includes(period.days)||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end>updatedAt+1000||start<updatedAt-32*86400000||end-start>32*86400000||heardMs<0||heardMs>end-start+60000||!Number.isFinite(heardMs)||!Number.isInteger(plays)||plays<0||plays>100000) throw new Error('invalid_period');
    const top=type=>(Array.isArray(period[type])?period[type]:[]).slice(0,5).map(row=>{
      if (!Number.isFinite(row.heardMs)||row.heardMs<0||row.heardMs>heardMs+1000) throw new Error('invalid_ranking');
      const common={name:String(row.name||'').slice(0,180),title:String(row.title||'').slice(0,300),heardMs:Math.round(row.heardMs),count:Math.max(0,Math.min(100000,Math.round(Number(row.count)||0)))};
      return {...common,url:spotifyLink(row.url),songUrl:spotifyLink(row.songUrl),albumImageUrl:picture(row.albumImageUrl)};
    });
    return {days:period.days,start,end,heardMs:Math.round(heardMs),minutes:Math.floor(heardMs/60000),plays,artists:top('artists'),tracks:top('tracks'),source:'monitored',sampleOnly:false};
  });
  return {version:1,mode:'playback_progress',updatedAt,startedAt,periods};
}
