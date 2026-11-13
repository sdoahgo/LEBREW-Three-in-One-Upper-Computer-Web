export const CMD = Object.freeze({INFO:1, TELEMETRY:2, LEGACY:0x10, JSON:0x11, NATIVE:0x12, CAPTURE:0x13, MEASURE:0x14, MONITOR:0x15, ENVIRONMENT:0x16, WIFI:0x36, CONTROL:0x40, CHUNK:0x41, EVENT:0x90});
export const OP = Object.freeze({START:1, QUERY:2, FINISH:3, ABORT:4, REBOOT:5});
export const BLE = Object.freeze({service:'f0050001-6d2a-4a9b-b3c1-465553494f4e',rx:'f0050002-6d2a-4a9b-b3c1-465553494f4e',tx:'f0050003-6d2a-4a9b-b3c1-465553494f4e'});
export const encoder = new TextEncoder(), decoder = new TextDecoder();
const table = Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++) c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes,previous=0){let c=previous^0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function u32(...values){const b=new Uint8Array(values.length*4),v=new DataView(b.buffer);values.forEach((x,i)=>v.setUint32(i*4,x,true));return b;}
export function concat(...parts){const out=new Uint8Array(parts.reduce((s,p)=>s+p.length,0));let n=0;for(const p of parts){out.set(p,n);n+=p.length;}return out;}
export function frame(cmd,seq,payload=new Uint8Array()){
  if(payload.length>4096)throw Error('命令超过4096字节');
  const b=new Uint8Array(payload.length+14),v=new DataView(b.buffer);b.set([0xf5,0x5f,1,cmd]);v.setUint16(4,seq,true);v.setUint16(6,payload.length,true);b.set(payload,8);v.setUint32(8+payload.length,crc32(b.subarray(2,8+payload.length)),true);b.set([13,10],b.length-2);return b;
}
export class Parser{
  constructor(onFrame){this.onFrame=onFrame;this.pending=new Uint8Array();}
  push(bytes){this.pending=concat(this.pending,bytes);let b=this.pending;
    while(b.length>=2){
      if(b[0]!==0xf5||b[1]!==0x5f){b=b.subarray(1);continue;}
      if(b.length<8)break;const v=new DataView(b.buffer,b.byteOffset,b.byteLength),n=v.getUint16(6,true),total=n+14;
      if(b[2]!==1||n>4096){b=b.subarray(1);continue;}if(b.length<total)break;
      if(b[total-2]!==13||b[total-1]!==10||v.getUint32(n+8,true)!==crc32(b.subarray(2,n+8))){b=b.subarray(1);continue;}
      this.onFrame({cmd:b[3],seq:v.getUint16(4,true),payload:b.slice(8,n+8)});b=b.subarray(total);
    }this.pending=b.slice();
  }
}
export function fragments(bytes,size=240){if(size<2)throw Error('GATT 分片太小');const out=[];for(let pos=0,n=0;pos<bytes.length;pos+=size-1,n++){const end=Math.min(bytes.length,pos+size-1);out.push(concat(Uint8Array.of((n&63)|(pos===0?64:0)|(end===bytes.length?128:0)),bytes.subarray(pos,end)));}return out;}
export class Reassembler{
  constructor(onBytes){this.onBytes=onBytes;this.reset();}
  reset(){this.seq=0;this.parts=[];this.length=0;}
  push(b){if(!b.length)return;if(b[0]&64)this.reset();if((b[0]&63)!==this.seq){this.reset();return;}this.seq=(this.seq+1)&63;this.parts.push(b.slice(1));this.length+=b.length-1;if(this.length>4110){this.reset();return;}if(b[0]&128){this.onBytes(concat(...this.parts));this.reset();}}
}
export function validateFirmware(b){
  if(!(b instanceof Uint8Array)||b.length<288||b.length>0x400000||b[0]!==0xe9)throw Error('请选择 ESP32-S3 应用 .bin（不是合并镜像、bootloader 或分区表）');
  const v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if(v.getUint16(12,true)!==9)throw Error('固件目标芯片不是 ESP32-S3');
  if(v.getUint32(32,true)!==0xabcd5432)throw Error('缺少应用描述符，拒绝 bootloader 或整片镜像');
  const str=(start,len)=>decoder.decode(b.subarray(start,start+len)).replace(/\0.*$/s,'');
  const project=str(80,32);if(project!=='NV3049F')throw Error('固件不属于 Fusion NV3049F 项目');
  return{size:b.length,crc:crc32(b),version:str(48,32),project};
}
// Drafts may be incomplete; validate their shape without imposing point order.
export function parsePointDraft(p){
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('SCAsave 点位结构无效');
  const n=Number(p.sca_point_count);if(!Number.isInteger(n)||n<2||n>15)throw Error('SCAsave 点数无效');
  for(const key of['sca_values','sca_been','sca_powder'])if(!Array.isArray(p[key]))throw Error('SCAsave 缺少 '+key);
  return p;
}
export function validatePoints(p){
  const count=Number(p.sca_point_count);
  if(!Number.isInteger(count)||count<2||count>15)throw Error('下发点数必须是 2–15');
  const keys=['sca_been','sca_powder','sca_values'];const arrays=keys.map(k=>{
    if(!Array.isArray(p[k])||p[k].length<count)throw Error('点位数据不完整');
    return p[k].slice(0,count).map(x=>{if(String(x).trim()===''||!Number.isFinite(Number(x)))throw Error('点位必须填写有效数字');return Number(x);});});
  return{SCA_Piont:{SCA_Parameter_points:count,SCA_Been_Point:arrays[0],SCA_Pink_Point:arrays[1],SCA_Y_Point:arrays[2]}};
}
export function nativeCommand(op,value){
  const prefix=Uint8Array.of(0xa6,0xc3,0xca,0x4b,0x9c,0x1c,0x46,0xb8,0x58,0xe9,0x4b,0xd1,0xd2,0xa5,0x56,0xa6,op);
  if(op===17||op===18){if(!Number.isFinite(Number(value)))throw Error('补偿值无效');const b=new Uint8Array(4);new DataView(b.buffer).setFloat32(0,Number(value),false);return concat(prefix,b);}
  if(op===8||op===9){const n=Number(value);if(!(op===8?[5,25,50]:[1,5,10]).includes(n))throw Error(op===8?'请选择低、中、高亮度档位':'请选择 1、5、10 分钟息屏时间');return concat(prefix,Uint8Array.of(n));}
  return prefix;
}
// Qt binary 0x403430: LB + current date YYMMDD + eight Base36 characters + RF.
export function generateSN(date=new Date(),random=()=>crypto.getRandomValues(new Uint32Array(8))){
  const y=String(date.getFullYear()%100).padStart(2,'0'),m=String(date.getMonth()+1).padStart(2,'0'),d=String(date.getDate()).padStart(2,'0');
  const alphabet='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',values=random();if(values.length!==8)throw Error('SN 随机源无效');
  const suffix=Array.from(values,x=>alphabet[Number((BigInt(x>>>0)*36n)>>32n)]).join('');return`LB${y}${m}${d}${suffix}RF`;
}
