import { deflateSync } from 'node:zlib';
import { crc32, parts } from './data.mjs';
// Built-in 5x7 pixel alphabet: no font download or operating-system dependency.
const glyphs={
 A:'01110/10001/10001/11111/10001/10001/10001',B:'11110/10001/10001/11110/10001/10001/11110',C:'01111/10000/10000/10000/10000/10000/01111',D:'11110/10001/10001/10001/10001/10001/11110',E:'11111/10000/10000/11110/10000/10000/11111',F:'11111/10000/10000/11110/10000/10000/10000',G:'01111/10000/10000/10111/10001/10001/01111',H:'10001/10001/10001/11111/10001/10001/10001',I:'11111/00100/00100/00100/00100/00100/11111',J:'00111/00010/00010/00010/10010/10010/01100',K:'10001/10010/10100/11000/10100/10010/10001',L:'10000/10000/10000/10000/10000/10000/11111',M:'10001/11011/10101/10101/10001/10001/10001',N:'10001/11001/10101/10011/10001/10001/10001',O:'01110/10001/10001/10001/10001/10001/01110',P:'11110/10001/10001/11110/10000/10000/10000',Q:'01110/10001/10001/10001/10101/10010/01101',R:'11110/10001/10001/11110/10100/10010/10001',S:'01111/10000/10000/01110/00001/00001/11110',T:'11111/00100/00100/00100/00100/00100/00100',U:'10001/10001/10001/10001/10001/10001/01110',V:'10001/10001/10001/10001/10001/01010/00100',W:'10001/10001/10001/10101/10101/10101/01010',X:'10001/10001/01010/00100/01010/10001/10001',Y:'10001/10001/01010/00100/00100/00100/00100',Z:'11111/00001/00010/00100/01000/10000/11111',
 '0':'01110/10001/10011/10101/11001/10001/01110','1':'00100/01100/00100/00100/00100/00100/01110','2':'01110/10001/00001/00010/00100/01000/11111','3':'11110/00001/00001/01110/00001/00001/11110','4':'00010/00110/01010/10010/11111/00010/00010','5':'11111/10000/10000/11110/00001/00001/11110','6':'01110/10000/10000/11110/10001/10001/01110','7':'11111/00001/00010/00100/01000/01000/01000','8':'01110/10001/10001/01110/10001/10001/01110','9':'01110/10001/10001/01111/00001/00001/01110',
 ':':'00000/00100/00100/00000/00100/00100/00000','-':'00000/00000/00000/11111/00000/00000/00000','>':'10000/01000/00100/00010/00100/01000/10000','/':'00001/00010/00010/00100/01000/01000/10000','+':'00000/00100/00100/11111/00100/00100/00000','.':'00000/00000/00000/00000/00000/00100/00100','#':'01010/01010/11111/01010/11111/01010/01010','!':'00100/00100/00100/00100/00100/00000/00100','?':'01110/10001/00001/00010/00100/00000/00100',' ':'00000/00000/00000/00000/00000/00000/00000'
};
export const clock = ms => {const p=parts(ms);return `${String(p.hour).padStart(2,'0')}:${String(p.minute).padStart(2,'0')}`;};
function shortStop(s) {return s.replace(/^Ithaca Commons\s*[-/]\s*/i,'').replace('Tioga Street (10)','TIOGA').replace('Carpenter Hall','CARPENTER').replace('Sage Hall','SAGE').replace('Anabel Taylor Hall','ANABEL').toUpperCase();}
function chunk(type,data){const t=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([len,t,data,crc]);}
export function render(board) {
  const w=400,h=300,pix=Buffer.alloc(w*h,255);
  function box(x,y,bw,bh,c=0){for(let j=Math.max(0,y);j<Math.min(h,y+bh);j++)for(let i=Math.max(0,x);i<Math.min(w,x+bw);i++)pix[j*w+i]=c;}
  function text(t,x,y,s=1,c=0,max=1000){t=String(t).toUpperCase();if(t.length*s*6>max)t=t.slice(0,Math.max(0,Math.floor(max/(s*6))-2))+'..';for(const ch of t){const g=(glyphs[ch]||glyphs['?']).split('/');g.forEach((row,j)=>[...row].forEach((b,i)=>{if(b==='1')box(x+i*s,y+j*s,s,s,c);}));x+=6*s;}}
  box(0,0,w,44);text('ITHACA COMMONS',12,7,2,255);text('TO RHODES HALL',12,26,2,255);text('TCAT',338,15,2,255);
  text('ALIGHT NEAR RHODES HALL + WALK',12,49,1);
  if(board.error){text('DATA UNAVAILABLE',16,95,3,0,368);text('CHECK TCAT BEFORE TRAVEL',16,139,2,0,368);text('RETRYING ON NEXT UPDATE',16,171,2,0,368);}
  else if(!board.departures.length){text('NO DIRECT BUS',16,95,3);text('IN NEXT '+board.lookAheadHours+' HOURS',16,137,2);text('CHECK TCAT FOR OTHER OPTIONS',16,173,2,0,368);}
  else board.departures.slice(0,3).forEach((d,i)=>{
    const y=66+i*59;box(10,y-3,60,29);text(d.route,16,y,3,255,52);
    text(clock(d.departure),88,y,3);const delta=d.minutes>99?`${Math.floor(d.minutes/60)}H${d.minutes%60}M`:`${d.minutes} MIN`;
    text(delta,246,y,3,0,146);text(shortStop(d.origin)+' > '+shortStop(d.alight),12,y+32,2,0,310);text(d.source,348,y+33,1);
    box(10,y+52,380,1);
  });
  const p=parts(board.generatedAt), date=`${String(p.month).padStart(2,'0')}/${String(p.day).padStart(2,'0')}`;
  text(`AS OF ${date} ${clock(board.generatedAt)} ET / WAIT AT UPDATE`,12,248,1);
  text('STATIC SNAPSHOT - CHECK DEPARTURE CLOCK',12,263,1);
  const notice=board.error?'DATA ERROR / CHECK TCAT':board.alertsUnavailable?'ALERTS UNAVAILABLE / CHECK TCAT':board.alerts?.length?`TCAT ALERTS: ${board.alerts.length} / CHECK STOP CHANGES`:'LIVE=PREDICTED  SCHED=TIMETABLE';
  text(notice,12,281,1,0,376);
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=0;
  const scan=Buffer.alloc((w+1)*h);for(let y=0;y<h;y++)pix.copy(scan,y*(w+1)+1,y*w,(y+1)*w);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
