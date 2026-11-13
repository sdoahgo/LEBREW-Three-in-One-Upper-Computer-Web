import{CMD,OP,Parser,frame,encoder,decoder,crc32}from'./fusion_protocol.js';
// Explicit demonstration only. It never touches real radios, ports or flash.
export class SimLink{
  kind='sim';name='模拟设备';writeSize=240;
  constructor({legacyOta=false}={}){this.info={name:'RoastSee Fusion [模拟]',mac:'DE:MO:00:00:00:01',sn:'NULL',hw:'0.0.1',fw:'0.1.2-web-demo',webProtocol:1,webFirmware:legacyOta?'1.0.4':'1.0.19',serialChunk:legacyOta?2048:4092,serialWindow:legacyOta?4:8,bleChunk:legacyOta?221:512,bleWindow:2,rawMonitor:true,environmentCalibration:!legacyOta,initialAltitude:0,pressureReference:101325,buzzer:1,language:0,measurementProfiles:true,measureMode:0,scaMode:0,boardPowder:50,boardBeen:50,linearA:0,linearB:0,brightness:25,sleep:5,makeupPowder:0,makeupBeen:0,build:'SIMULATION'};this.state={state:'idle',offset:0,size:0,crc:0};this.parser=new Parser(f=>this.handle(f));this.sample=60000;}
  async connect(){}
  async write(bytes){this.parser.push(bytes);}
  send(cmd,seq,ok,data,error){queueMicrotask(()=>this.ondata?.(frame(cmd|128,seq,encoder.encode(JSON.stringify({ok,data,error})))));}
  event(text){setTimeout(()=>this.ondata?.(frame(CMD.EVENT,0,encoder.encode(JSON.stringify({event:'legacy',text})))),80);}
  handle(f){const v=new DataView(f.payload.buffer,f.payload.byteOffset,f.payload.byteLength);let data,error;
    try{switch(f.cmd){
      case CMD.INFO:data=this.info;break;
      case CMD.TELEMETRY:data={measurementBusy:!!this.measureUntil&&Date.now()<this.measureUntil,measureMode:this.info.measureMode,scaMode:this.info.scaMode,link:true,weightADC:123456,capacitance:16.52,scaADC:this.sample,pressure:101325,altitude:44330*(1-Math.pow(101325/this.info.pressureReference,1/5.255)),initialAltitude:this.info.initialAltitude,pressureReference:this.info.pressureReference,temperatureRaw:26000,humidityRaw:33000,moisture:10.2,density:682,aw:.56,sca:52.85,battery:3970};break;
      case CMD.ENVIRONMENT:{if(f.payload.length!==4)throw Error('Invalid initial altitude');if(this.monitor||this.measureUntil>Date.now()||this.state.state!=='idle')throw Error('Device busy');this.info.initialAltitude=v.getInt32(0,true);this.info.pressureReference=101325/Math.pow(Math.max(.0001,1-this.info.initialAltitude/44330),5.255);data=this.info;break;}
      case CMD.MEASURE:{const [kind,profile]=f.payload;if(f.payload.length!==2||![1,2,3].includes(kind)||profile>(kind===1?3:kind===3?1:0))throw Error("Invalid measurement profile");if(this.measureUntil>Date.now())throw Error("Measurement or calibration already active");if(kind===1)this.info.measureMode=profile;if(kind===3)this.info.scaMode=profile;this.measureUntil=Date.now()+1500;data=this.info;break;}
      case CMD.MONITOR:{const[op,kind]=f.payload;if(op===1){if(this.monitor)throw Error('Device busy');this.monitor={kind,seq:0,start:Date.now()};}else if(op===3){this.monitor=null;data={active:false};break;}else if(!this.monitor||this.monitor.kind!==kind)throw Error('Monitor stopped');
        const m=this.monitor;data={active:true,kind,valid:true,seq:++m.seq,deviceMs:Date.now()-m.start,value:kind===1?123456+m.seq:kind===2?16.52+m.seq/10000:60000+m.seq};break;}
      case CMD.CAPTURE:this.sample+=1000;setTimeout(()=>this.send(f.cmd,f.seq,true,{raw:this.sample,powder:52.85,been:53.12}),80);return;
      case CMD.LEGACY:{const s=decoder.decode(f.payload);if(s==='sca_get\r\n'){this.sample+=1000;this.event(`powder 52.85,been 53.12,value ${this.sample}\r\n`);}else if(s==='weigh_get\r\n')this.event('demarcate,weigh,123456\r\n');else if(s==='cap_get\r\n')this.event('demarcate,cap,16.52,\r\n');else if(s==='device_get\r\n')this.event('device_band,DE:MO:00:00:00:01,0,0,0,0,0,0,0,0');else throw Error('Unknown command');break;}
      case CMD.JSON:{const o=JSON.parse(decoder.decode(f.payload));if(o.SN){if(this.info.sn==='NULL'){this.info.sn=o.SN;this.info.mode=2;}}
        if(o.calibrat_board){this.info.boardPowder=o.calibrat_board.powder;this.info.boardBeen=o.calibrat_board.been;}
        if(o.linearFit){this.info.linearA=o.linearFit.A;this.info.linearB=o.linearFit.B;}
        if(o.SCA_Piont){const p=o.SCA_Piont;this.info.points={count:p.SCA_Parameter_points,been:p.SCA_Been_Point,powder:p.SCA_Pink_Point,values:p.SCA_Y_Point};}data=this.info;break;}
      case CMD.NATIVE:{const op=f.payload[16];if(op===4)this.info.buzzer=1;if(op===5)this.info.buzzer=0;if(op===6)this.info.language=0;if(op===7)this.info.language=1;if(op===8)this.info.brightness=f.payload[17];if(op===9)this.info.sleep=f.payload[17];if(op===17)this.info.makeupPowder=v.getFloat32(17,false);if(op===18)this.info.makeupBeen=v.getFloat32(17,false);break;}
      case CMD.WIFI:data={ssid:'RoastSee-Fusion-OTA',url:'http://192.168.4.1/ota'};break;
      case CMD.CONTROL:{const op=f.payload[0];if(op===OP.START){if(this.state.state!=='idle')throw Error('Busy');this.state={state:'receiving',size:v.getUint32(1,true),expectedCrc:v.getUint32(5,true),offset:0,crc:0};this.expected=v.getUint32(5,true);}
        if(op===OP.FINISH){if(this.state.offset!==this.state.size||this.state.crc!==this.expected)throw Error('CRC mismatch');this.state.state='ready';}
        if(op===OP.ABORT)this.state={state:'idle',size:0,offset:0,crc:0};
        data={...this.state};if(op===OP.REBOOT)setTimeout(()=>this.close(),200);break;}
      case CMD.CHUNK:{if(this.state.state!=='receiving'||v.getUint32(0,true)!==this.state.offset)throw Error('Offset mismatch');this.state.offset+=f.payload.length-4;this.state.crc=crc32(f.payload.subarray(4),this.state.crc);data={...this.state};break;}
      default:throw Error('Unsupported command');
    }}catch(e){error=e.message;}this.send(f.cmd,f.seq,!error,data,error);
  }
  async close(){this.ondisconnect?.();}
}
