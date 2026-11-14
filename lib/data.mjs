import { inflateRawSync } from 'node:zlib';

export const ZONE = 'America/New_York';
export function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) { c ^= x; for (let i=0;i<8;i++) c = (c>>>1) ^ ((c&1)?0xedb88320:0); }
  return (c^0xffffffff)>>>0;
}
// Read the ZIP central directory; never extract arbitrary paths to disk.
export function unzip(b) {
  let e = b.length-22;
  while (e>=Math.max(0,b.length-65557) && b.readUInt32LE(e)!==0x06054b50) e--;
  if(e<0 || b.readUInt32LE(e)!==0x06054b50) throw Error('Invalid GTFS ZIP');
  const files = {}; let p=b.readUInt32LE(e+16), total=0;
  for(let i=0;i<b.readUInt16LE(e+10);i++) {
    if(b.readUInt32LE(p)!==0x02014b50) throw Error('Invalid ZIP directory');
    const n=b.readUInt16LE(p+28), x=b.readUInt16LE(p+30), c=b.readUInt16LE(p+32);
    const name=b.subarray(p+46,p+46+n).toString(), method=b.readUInt16LE(p+10);
    const len=b.readUInt32LE(p+20), size=b.readUInt32LE(p+24), pos=b.readUInt32LE(p+42);
    if((total+=size)>150e6 || size>80e6 || b.readUInt16LE(p+8)&1) throw Error('Unsupported ZIP');
    const start=pos+30+b.readUInt16LE(pos+26)+b.readUInt16LE(pos+28);
    const raw=b.subarray(start,start+len);
    const out=method===8?inflateRawSync(raw,{maxOutputLength:80e6}):method===0?raw:null;
    if(!out || out.length!==size || crc32(out)!==b.readUInt32LE(p+16)) throw Error('GTFS ZIP checksum failed');
    files[name]=out; p+=46+n+x+c;
  }
  return files;
}
export function csv(text) {
  const rows=[]; let row=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') { if(quoted && text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(!quoted && (c===',' || c==='\n')) {row.push(cell);cell='';if(c==='\n'){rows.push(row);row=[];}}
    else if(c!=='\r' || quoted) cell+=c;
  }
  if(quoted) throw Error('Unterminated CSV field');
  if(cell || row.length){row.push(cell);rows.push(row);}
  const keys=(rows.shift()||[]).map(s=>s.replace(/^\uFEFF/,''));
  return rows.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[i]??''])));
}
// Minimal, bounded protobuf wire reader. Unknown fields are safely ignored.
export function wire(b) {
  let p=0; const fields={};
  function variable(){let n=0n,s=0n;for(let i=0;i<10;i++){if(p>=b.length)throw Error('Truncated protobuf');const x=b[p++];n|=BigInt(x&127)<<s;if(!(x&128))return n;s+=7n;}throw Error('Invalid protobuf varint');}
  while(p<b.length) {
    const k=Number(variable()), n=k>>>3, w=k&7; let v;
    if(!n) throw Error('Invalid protobuf field');
    if(w===0)v=variable();
    else {const len=w===2?Number(variable()):w===1?8:w===5?4:-1;if(len<0 || p+len>b.length)throw Error('Invalid protobuf length');v=b.subarray(p,p+len);p+=len;}
    (fields[n]??=[]).push(v);
  }
  return fields;
}
const msg=(f,n)=>f[n]?.[0] ? wire(f[n][0]) : {};
const num=(f,n,def=undefined)=>f[n]?.[0]===undefined?def:Number(f[n][0]);
const str=(f,n)=>f[n]?.[0]?.toString()||'';
function event(f) {return {time:num(f,2),delay:f[1]?Number(BigInt.asIntN(32,f[1][0])):undefined};}
export function decodeRealtime(bytes) {
  const f=wire(bytes), h=msg(f,1), stamp=num(h,3);
  if(!stamp || num(h,2,0)!==0) throw Error('Realtime snapshot missing timestamp or is incremental');
  const updates=new Map();
  for(const b of f[2]||[]) {
    const en=wire(b); if(!en[3] || num(en,2,0))continue;
    const t=msg(en,3), d=msg(t,1), tripId=str(d,1), date=str(d,3);
    if(!tripId || !date)continue; // Ambiguous service dates must not be guessed.
    updates.set(`${tripId}|${date}`, {tripId,date,relationship:num(d,4,0),timestamp:num(t,4,stamp),
      stops:(t[2]||[]).map(b=>{const s=wire(b);return {sequence:num(s,1),id:str(s,4),relationship:num(s,5,0),arrival:event(msg(s,2)),departure:event(msg(s,3))};})});
  }
  return {timestamp:stamp,updates};
}
function translation(f){const options=(f[1]||[]).map(b=>wire(b));return str(options.find(t=>str(t,2)==='en')||options[0]||{},1);}
export function decodeAlerts(bytes, now) {
  const f=wire(bytes), header=msg(f,1), timestamp=num(header,3);
  if(!timestamp || Math.abs(now/1000-timestamp)>600) throw Error('Alerts feed is stale');
  return (f[2]||[]).flatMap(b=>{
    const en=wire(b); if(!en[5] || num(en,2,0))return [];
    const a=msg(en,5), periods=(a[1]||[]).map(b=>wire(b));
    if(periods.length && !periods.some(p=>num(p,1,0)<=now/1000 && num(p,2,Infinity)>now/1000))return [];
    return [{title:translation(msg(a,10)),description:translation(msg(a,11)),effect:num(a,7),
      selectors:(a[5]||[]).map(b=>{const s=wire(b);return {routeId:str(s,2),stopId:str(s,5),tripId:str(msg(s,4),1)};})}];
  });
}
const partsFormat = new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function parts(ms) {return Object.fromEntries(partsFormat.formatToParts(ms).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));}
export function dateKey(ms) {const p=parts(ms);return `${p.year}${String(p.month).padStart(2,'0')}${String(p.day).padStart(2,'0')}`;}
export function offsetDate(date, days) {const d=new Date(Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8)+days));return d.toISOString().slice(0,10).replaceAll('-','');}
// GTFS measures a service day's seconds from local noon minus twelve hours.
// This also handles overnight 24:xx times and daylight-saving transitions.
export function serviceStart(date) {
  const target=Date.UTC(+date.slice(0,4),+date.slice(4,6)-1,+date.slice(6,8),12); let t=target;
  for(let i=0;i<3;i++){const p=parts(t);t+=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);}
  return t-12*3600000;
}
export function seconds(s) {if(!/^\d+:\d\d:\d\d$/.test(s))return NaN;const [h,m,v]=s.split(':').map(Number);return m<60&&v<60?h*3600+m*60+v:NaN;}
export function loadSchedule(bytes) {
  const z=unzip(bytes), read=n=>csv((z[n+'.txt']||Buffer.alloc(0)).toString('utf8'));
  const stops=new Map(read('stops').map(s=>[s.stop_id,s])), routes=new Map(read('routes').map(r=>[r.route_id,r]));
  const trips=new Map(read('trips').map(t=>[t.trip_id,{...t,stops:[]} ])); let maxSeconds=86400;
  if(read('frequencies').length)throw Error('This version requires scheduled GTFS trips, not frequency-only service');
  for(const s of read('stop_times')) {s.seq=+s.stop_sequence;s.arr=seconds(s.arrival_time);s.dep=seconds(s.departure_time);maxSeconds=Math.max(maxSeconds,s.dep||0);trips.get(s.trip_id)?.stops.push(s);}
  for(const t of trips.values()) t.stops.sort((a,b)=>a.seq-b.seq);
  if(!stops.size || !trips.size)throw Error('Incomplete GTFS schedule');
  const agency=read('agency');if(agency.some(a=>a.agency_timezone!==ZONE))throw Error('Unexpected agency time zone');
  return {stops,routes,trips,maxSeconds,calendar:read('calendar'),exceptions:read('calendar_dates'),info:read('feed_info')[0]||{}};
}
export function activeServices(schedule,date) {
  const day=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T12:00:00Z`).getUTCDay()];
  const ids=new Set(schedule.calendar.filter(c=>c.start_date<=date && c.end_date>=date && c[day]==='1').map(c=>c.service_id));
  for(const x of schedule.exceptions.filter(x=>x.date===date)){if(x.exception_type==='1')ids.add(x.service_id);else if(x.exception_type==='2')ids.delete(x.service_id);}
  return ids;
}
export function stopUpdate(update,s) {return update?.stops.find(x=>x.sequence!==undefined?x.sequence===s.seq:x.id===s.stop_id);}
function predicted(scheduled,update,kind) {
  if(!update || update.relationship===2)return {time:scheduled,source:'SCHED'};
  // Use only a prediction for this precise stop; no invented route-wide delay.
  const e=update[kind];
  if(e?.time>0)return {time:e.time*1000,source:'LIVE'};
  if(Number.isFinite(e?.delay))return {time:scheduled+e.delay*1000,source:'LIVE'};
  return {time:scheduled,source:'SCHED'};
}
export function departures(schedule,realtime,config,now=Date.now()) {
  const today=dateKey(now), start=schedule.info.feed_start_date, end=schedule.info.feed_end_date;
  if((start&&today<start)||(end&&today>end))throw Error('GTFS timetable is outside its validity period');
  const origins=new Set([...schedule.stops.values()].filter(s=>/^Ithaca Commons\s*[-/]/i.test(s.stop_name)).map(s=>s.stop_id));
  const targets=new Set([...schedule.stops.values()].filter(s=>config.destinationStops.includes(s.stop_name)).map(s=>s.stop_id));
  if(!origins.size || !targets.size)throw Error('Configured Commons / Cornell stops not found');
  const fresh=!!realtime && now/1000-realtime.timestamp<=config.maxRealtimeAgeSeconds && realtime.timestamp-now/1000<=30;
  const found=[], horizon=now+config.lookAheadHours*3600000;
  for(let day=-Math.ceil(schedule.maxSeconds/86400);day<=Math.ceil(config.lookAheadHours/24);day++) {
    const date=offsetDate(today,day), base=serviceStart(date), services=activeServices(schedule,date);
    for(const trip of schedule.trips.values()) {
      if(!services.has(trip.service_id))continue;
      let update=fresh?realtime.updates.get(`${trip.trip_id}|${date}`):null;
      if(update && (now/1000-update.timestamp>config.maxRealtimeAgeSeconds || update.timestamp>now/1000+30))update=null;
      if(update && [3,7].includes(update.relationship))continue; // cancelled/deleted
      if(update && update.relationship!==0)continue; // unscheduled/changed patterns need routing support
      for(let i=0;i<trip.stops.length;i++) {
        const from=trip.stops[i];if(!origins.has(from.stop_id) || !['','0'].includes(from.pickup_type) || !Number.isFinite(from.dep))continue;
        const fu=stopUpdate(update,from);if(fu?.relationship===1)continue;
        const p=predicted(base+from.dep*1000,fu,'departure');if(p.time<now || p.time>horizon)continue;
        for(const to of trip.stops.slice(i+1)) {
          if(!targets.has(to.stop_id) || !['','0'].includes(to.drop_off_type) || !Number.isFinite(to.arr))continue;
          const tu=stopUpdate(update,to);if(tu?.relationship===1)continue;
          const ride=(to.arr-from.dep)/60;if(ride<0 || ride>config.maxRideMinutes)continue;
          const stop=schedule.stops.get(from.stop_id), target=schedule.stops.get(to.stop_id);
          found.push({tripId:trip.trip_id,serviceDate:date,routeId:trip.route_id,route:schedule.routes.get(trip.route_id)?.route_short_name||trip.route_id,
            headsign:trip.trip_headsign,origin:stop.stop_name,originId:stop.stop_id,alight:target.stop_name,alightId:target.stop_id,
            departure:p.time,scheduledDeparture:base+from.dep*1000,source:p.source,minutes:Math.ceil((p.time-now)/60000),
            alightLatitude:+target.stop_lat,alightLongitude:+target.stop_lon});
          break;
        }
      }
    }
  }
  found.sort((a,b)=>a.departure-b.departure);
  // A loop can contain more than one Commons stop: show the vehicle only once.
  const seen=new Set();return {fresh,departures:found.filter(x=>{const k=`${x.tripId}|${x.serviceDate}`;if(seen.has(k))return false;seen.add(k);return true;}).slice(0,config.maxRows)};
}
