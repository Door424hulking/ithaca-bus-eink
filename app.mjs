import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSchedule, decodeRealtime, decodeAlerts, departures } from './lib/data.mjs';
import { render, clock } from './lib/screen.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const URLS={schedule:'https://s3.amazonaws.com/tcat-gtfs/tcat-ny-us.zip',realtime:'https://realtimetcatbus.availtec.com/InfoPoint/GTFS-Realtime.ashx?Type=TripUpdate',alerts:'https://realtimetcatbus.availtec.com/InfoPoint/GTFS-Realtime.ashx?Type=Alert'};
const CLOUD='https://cloud.zectrix.com/open/v1';
async function getBytes(url){const r=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Ithaca-Bus-Eink/0.1 (personal transit display)'},redirect:'error'});if(!r.ok)throw Error(`Data server HTTP ${r.status}`);const b=Buffer.from(await r.arrayBuffer());if(b.length>30e6)throw Error('Response is too large');return b;}
async function atomic(file,bytes){await fs.writeFile(file+'.tmp',bytes);await fs.rename(file+'.tmp',file);}
async function loadEnv(){try{const s=await fs.readFile(path.join(ROOT,'.env'),'utf8');for(const line of s.split(/\r?\n/)){const m=line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}catch(e){if(e.code!=='ENOENT')throw e;}}
function credentials(){const key=process.env.ZECTRIX_API_KEY,device=process.env.ZECTRIX_DEVICE_ID;if(!key || !device)throw Error('Fill ZECTRIX_API_KEY and ZECTRIX_DEVICE_ID in .env first');return {key,device};}
async function cloud(endpoint,options={}) {const {key}=credentials();const r=await fetch(CLOUD+endpoint,{...options,redirect:'error',signal:AbortSignal.timeout(20000),headers:{'X-API-Key':key,...options.headers}});if(!r.ok)throw Error(`Zectrix HTTP ${r.status}`);const j=await r.json();if(j.code!==0)throw Error(`Zectrix returned error code ${j.code}`);return j.data;}
async function push(png,pageId) {const {device}=credentials(),form=new FormData();form.append('images',new Blob([png],{type:'image/png'}),'ithaca-bus.png');form.append('dither','false');form.append('pageId',pageId);return cloud(`/devices/${encodeURIComponent(device)}/display/image`,{method:'POST',body:form});}
function validate(c){for(const [k,min,max] of [['pollSeconds',30,3600],['pushEverySeconds',60,86400],['lookAheadHours',1,48],['maxRideMinutes',1,90],['maxRows',1,3],['maxRealtimeAgeSeconds',30,600]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error(`Invalid config: ${k}`);if(!/^[1-5]$/.test(c.pageId)||!Array.isArray(c.destinationStops)||!c.destinationStops.length)throw Error('Invalid pageId or destinationStops');}
export async function run(args=process.argv.slice(2)) {
  await loadEnv();const config=JSON.parse(await fs.readFile(path.join(ROOT,'config.json'),'utf8'));validate(config);
  if(args.includes('--devices')) {if(!process.env.ZECTRIX_API_KEY)throw Error('Set ZECTRIX_API_KEY in .env');process.env.ZECTRIX_DEVICE_ID||='list-only';console.log(JSON.stringify(await cloud('/devices'),null,2));return;}
  const scheduled=args.includes('--scheduled');
  const doPush=args.includes('--push')||scheduled,watch=args.includes('--watch');if(doPush)credentials();
  await fs.mkdir(path.join(ROOT,'cache'),{recursive:true});await fs.mkdir(path.join(ROOT,'output'),{recursive:true});
  if(args.includes('--sync10')) {console.log(await cloud(`/devices/${encodeURIComponent(credentials().device)}/sync-interval`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({syncInterval:10})}));return;}
  let schedule=null,scheduleLoaded=0,lastPushed=0;
  if(scheduled){try{const prior=JSON.parse(await fs.readFile(path.join(ROOT,'output/last-push.json'),'utf8'));const t=Date.parse(prior.pushedAt);if(prior.pageId===config.pageId&&Number.isFinite(t)&&t<=Date.now())lastPushed=t;}catch{}}
  const cache=path.join(ROOT,'cache/tcat.zip');
  async function getSchedule(){
    if(schedule && Date.now()-scheduleLoaded<6*3600000)return schedule;
    try {const stat=await fs.stat(cache);if(Date.now()-stat.mtimeMs<6*3600000){schedule=loadSchedule(await fs.readFile(cache));scheduleLoaded=stat.mtimeMs;return schedule;}}catch{}
    try{const bytes=await getBytes(URLS.schedule);const parsed=loadSchedule(bytes);await atomic(cache,bytes);schedule=parsed;scheduleLoaded=Date.now();return schedule;}
    catch(e){if(!schedule){try{schedule=loadSchedule(await fs.readFile(cache));}catch{throw e;}}console.warn('Schedule refresh failed; using cached timetable within its validity period.');return schedule;}
  }
  do {
    let board,failed=false;
    try {
      const [s,rt,alerts]=await Promise.allSettled([getSchedule(),getBytes(URLS.realtime).then(decodeRealtime),getBytes(URLS.alerts).then(b=>decodeAlerts(b,Date.now()))]);
      if(s.status==='rejected')throw s.reason;
      const now=Date.now(),r=departures(s.value,rt.status==='fulfilled'?rt.value:null,config,now);
      board={generatedAt:now,timeZone:'America/New_York',lookAheadHours:config.lookAheadHours,...r,
        feedVersion:s.value.info.feed_version,feedValidThrough:s.value.info.feed_end_date,
        realtimeTimestamp:rt.status==='fulfilled'?rt.value.timestamp:null,
        alerts:alerts.status==='fulfilled'?alerts.value:[],alertsUnavailable:alerts.status==='rejected',
        note:'Waiting minutes are calculated at generatedAt. Alight at the listed Cornell stop, then walk to Rhodes Hall.',sources:URLS};
      if(!r.fresh)console.warn('Realtime unavailable or stale: showing SCHED times only.');
    }catch(e){failed=true;board={generatedAt:Date.now(),error:String(e.message),departures:[],alerts:[],alertsUnavailable:true};console.error('Transit update failed:',e.message);}
    const png=render(board);await atomic(path.join(ROOT,'output/board.png'),png);await atomic(path.join(ROOT,'output/board.json'),JSON.stringify(board,null,2));
    console.log(`${clock(board.generatedAt)} ET | `+(board.error?'DATA UNAVAILABLE':board.departures.map(d=>`${d.route} ${clock(d.departure)} (${d.minutes} min ${d.source}) ${d.origin} -> ${d.alight}`).join(' | ')||'No direct buses in search window'));
    if(doPush && Date.now()-lastPushed>=config.pushEverySeconds*1000){try{const result=await push(png,config.pageId);lastPushed=Date.now();await atomic(path.join(ROOT,'output/last-push.json'),JSON.stringify({pushedAt:new Date(lastPushed).toISOString(),pageId:config.pageId,generatedAt:new Date(board.generatedAt).toISOString(),cloudResponse:result},null,2));console.log(`Uploaded to page ${config.pageId}; device refresh still depends on firmware / connectivity.`);}catch(e){failed=true;console.error('Display push failed:',e.message);}}
    if(!watch){if(failed)process.exitCode=1;break;}
    await new Promise(resolve=>setTimeout(resolve,config.pollSeconds*1000));
  } while(watch);
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{console.error(e.message);process.exitCode=1;});
