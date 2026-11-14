import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { activeServices, csv, decodeRealtime, departures, serviceStart, dateKey, seconds, wire, parts } from '../lib/data.mjs';
import { render } from '../lib/screen.mjs';

const cfg={destinationStops:['Carpenter Hall','Sage Hall'],maxRealtimeAgeSeconds:180,lookAheadHours:24,maxRideMinutes:40,maxRows:3};
const now=Date.parse('2026-11-13T15:00:00Z'); // 10:00 in Ithaca.
function fixture(){
 const stop=(id,name)=>({stop_id:id,stop_name:name,stop_lat:'42.44',stop_lon:'-76.48'});
 const item=(id,time,seq)=>({stop_id:id,arr:seconds(time),dep:seconds(time),seq,pickup_type:'0',drop_off_type:'0'});
 return {info:{feed_start_date:'20261101',feed_end_date:'20261219'},maxSeconds:86400,
   stops:new Map([['A',stop('A','Ithaca Commons - Green St')],['B',stop('B','Carpenter Hall')],['C',stop('C','Sage Hall')]]),routes:new Map([['30',{route_short_name:'30'}]]),
   trips:new Map([['out',{trip_id:'out',route_id:'30',service_id:'fri',trip_headsign:'Cornell',stops:[item('A','10:05:00',0),item('B','10:15:00',10),item('C','10:18:00',20)]}],
   ['back',{trip_id:'back',route_id:'30',service_id:'fri',stops:[item('B','10:06:00',0),item('A','10:16:00',10)]}]]),
   calendar:[{service_id:'fri',start_date:'20261101',end_date:'20261219',friday:'1'}],exceptions:[]};
}
function rt(overrides={}){return {timestamp:now/1000,updates:new Map([['out|20261113',{timestamp:now/1000,relationship:0,stops:[],...overrides}]])};}
function stu(seq,extras={}){return {sequence:seq,id:'',relationship:0,arrival:{},departure:{},...extras};}
test('CSV quoted names, embedded newline and escaped quote',()=>{assert.deepEqual(csv('id,name\r\n1,"a,b"\r\n2,"a""b\nc"'),[{id:'1',name:'a,b'},{id:'2',name:'a"b\nc'}]);});
test('Only downstream destination is eligible, never return trip',()=>{const d=departures(fixture(),null,cfg,now).departures;assert.equal(d.length,1);assert.equal(d[0].tripId,'out');assert.equal(d[0].minutes,5);assert.equal(d[0].source,'SCHED');});
test('Live departure is used, including negative delay and sequence zero',()=>{let d=departures(fixture(),rt({stops:[stu(0,{departure:{delay:-60}})]}),cfg,now).departures;assert.equal(d[0].minutes,4);assert.equal(d[0].source,'LIVE');});
test('Late bus scheduled in the past remains eligible',()=>{const s=fixture();s.trips.get('out').stops[0].dep=seconds('09:58:00');const d=departures(s,rt({stops:[stu(0,{departure:{time:now/1000+120}})]}),cfg,now).departures;assert.equal(d[0].minutes,2);});
test('Cancelled trips are excluded',()=>{assert.equal(departures(fixture(),rt({relationship:3}),cfg,now).departures.length,0);});
test('Skipped boarding stop is excluded',()=>{assert.equal(departures(fixture(),rt({stops:[stu(0,{relationship:1})]}),cfg,now).departures.length,0);});
test('Skipped destination is replaced only by an allowed later stop',()=>{const d=departures(fixture(),rt({stops:[stu(10,{relationship:1})]}),cfg,now).departures;assert.equal(d[0].alight,'Sage Hall');});
test('NO_DATA never uses a misleading stale prediction',()=>{const d=departures(fixture(),rt({stops:[stu(0,{relationship:2,departure:{delay:900}})]}),cfg,now).departures;assert.equal(d[0].source,'SCHED');assert.equal(d[0].minutes,5);});
test('Stale feed and stale trip updates fall back to timetable',()=>{for(const r of [{...rt(),timestamp:now/1000-500},rt({timestamp:now/1000-500,stops:[stu(0,{departure:{delay:900}})]})]){const d=departures(fixture(),r,cfg,now).departures;assert.equal(d[0].source,'SCHED');assert.equal(d[0].minutes,5);}});
test('Predictions from a different service date are not applied',()=>{const r=rt();r.updates=new Map([['out|20261112',{relationship:3}]]);assert.equal(departures(fixture(),r,cfg,now).departures.length,1);});
test('Calendar exceptions override normal weekdays, including added service',()=>{const s=fixture();s.exceptions=[{service_id:'fri',date:'20261113',exception_type:'2'},{service_id:'extra',date:'20261113',exception_type:'1'}];assert.deepEqual([...activeServices(s,'20261113')],['extra']);assert.equal(departures(s,null,cfg,now).departures.length,0);});
test('Overnight departure uses the previous service day',()=>{const s=fixture();s.maxSeconds=25*3600;s.trips.get('out').stops[0].dep=seconds('24:05:00');s.trips.get('out').stops[1].arr=seconds('24:15:00');const d=departures(s,null,cfg,Date.parse('2026-11-14T05:02:00Z')).departures;assert.equal(d[0].minutes,3);assert.equal(d[0].serviceDate,'20261113');});
test('DST service anchor stays twelve elapsed hours before local noon',()=>{for(const d of ['20260308','20261101']){assert.equal(parts(serviceStart(d)+12*3600000).hour,12);assert.equal(dateKey(serviceStart(d)+12*3600000),d);}});
test('Expired GTFS is rejected instead of showing obsolete buses',()=>{const s=fixture();s.info.feed_end_date='20261112';assert.throws(()=>departures(s,null,cfg,now),/validity/);});
test('A bus which has already departed is omitted',()=>{const d=departures(fixture(),rt({stops:[stu(0,{departure:{time:now/1000-1}})]}),cfg,now).departures;assert.equal(d.length,0);});
test('Malformed protobuf is rejected',()=>{assert.throws(()=>wire(Buffer.from([10,99,1])));});
function varint(n){n=BigInt(n);const a=[];do{let x=Number(n&127n);n>>=7n;a.push(x|(n?128:0));}while(n);return Buffer.from(a);}
function field(n,v){if(typeof v==='number'||typeof v==='bigint')return Buffer.concat([varint(n*8),varint(v)]);v=Buffer.isBuffer(v)?v:Buffer.from(v);return Buffer.concat([varint(n*8+2),varint(v.length),v]);}
test('Real protobuf schema handles signed delay and cancellation codes',()=>{
 const head=Buffer.concat([field(1,'2.0'),field(3,now/1000)]),desc=Buffer.concat([field(1,'out'),field(3,'20261113')]);
 const stop=Buffer.concat([field(1,0),field(3,field(1,BigInt.asUintN(64,-60n)))]);
 const upd=Buffer.concat([field(1,desc),field(2,stop),field(4,now/1000)]);
 const decoded=decodeRealtime(Buffer.concat([field(1,head),field(2,field(3,upd))]));
 assert.equal(decoded.updates.get('out|20261113').stops[0].departure.delay,-60);
 assert.equal(departures(fixture(),decoded,cfg,now).departures[0].minutes,4);
});
test('PNG dimensions are exactly 400 by 300, grayscale contains only black and white',()=>{
 const b=render({generatedAt:now,departures:departures(fixture(),null,cfg,now).departures,alerts:[]});
 assert.equal(b.readUInt32BE(16),400);assert.equal(b.readUInt32BE(20),300);
 let p=8,idat=[];while(p<b.length){const len=b.readUInt32BE(p),kind=b.subarray(p+4,p+8).toString();if(kind==='IDAT')idat.push(b.subarray(p+8,p+8+len));p+=12+len;}
 const pixels=inflateSync(Buffer.concat(idat));assert.equal(pixels.length,401*300);assert.ok([...new Set(pixels)].every(x=>x===0||x===255));
});
