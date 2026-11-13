import{CMD}from'./fusion_protocol.js';
export const RAW_KINDS=Object.freeze({weight:1,cap:2,sca:3});
const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
export function recordingCSV(record){return recordingsCSV([record]);}
export function recordingsCSV(records){
  const rows=[['记录开始','记录结束','设备SN','连接','通道','采集时间','经过毫秒','设备毫秒','帧序号','原始值'],
    ...records.flatMap(record=>record.rows.map(r=>[record.started,record.ended??'',record.sn,record.transport,record.kind,r.time,r.elapsedMs,r.deviceMs,r.seq,r.value]))];
  return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
}
// Poll one genuine latest frame at a time. Never append stale snapshots or replies
// that arrive after stop. Device-side lease also stops acquisition after 5 s.
export class RawRecorder{
  constructor(client,{now=()=>Date.now(),onChange=()=>{},onError=()=>{}}={}){Object.assign(this,{client,now,onChange,onError});this.active=false;this.rows=[];}
  async start(kind,info,transport){
    if(this.active)throw Error('请先结束当前记录');
    if(!info?.rawMonitor)throw Error('连续监测需要配套 1.0.4 固件');
    if(!RAW_KINDS[kind])throw Error('未知传感器');
    await this.client.request(CMD.MONITOR,Uint8Array.of(1,RAW_KINDS[kind]));
    Object.assign(this,{kind,sn:info.sn,transport,started:new Date(this.now()).toISOString(),ended:null,startedMs:this.now(),rows:[],lastSeq:0,active:true,error:null});
    this.onChange(this);this.tick();
  }
  async tick(){
    if(!this.active)return;
    try{const s=await this.client.request(CMD.MONITOR,Uint8Array.of(2,RAW_KINDS[this.kind]),{timeout:2500});
      if(!this.active)return;
      if(!s.active)throw Error('设备已停止监测');
      if(s.valid&&Number.isFinite(s.value)&&Number.isInteger(s.seq)&&s.seq>this.lastSeq){
        const ms=this.now();this.rows.push({time:new Date(ms).toISOString(),elapsedMs:ms-this.startedMs,deviceMs:s.deviceMs,seq:s.seq,value:s.value});this.lastSeq=s.seq;this.onChange(this);
      }
      if(this.active)this.timer=setTimeout(()=>this.tick(),200);
    }catch(e){if(this.active){this.finish(e.message);this.onError(e);this.client.request(CMD.MONITOR,Uint8Array.of(3,RAW_KINDS[this.kind]),{timeout:2500}).catch(()=>{});}}
  }
  finish(error=null){this.active=false;clearTimeout(this.timer);this.ended=new Date(this.now()).toISOString();this.error=error;this.onChange(this);}
  async stop(){if(!this.active)return;this.finish();await this.client.request(CMD.MONITOR,Uint8Array.of(3,RAW_KINDS[this.kind]),{timeout:2500});}
}
