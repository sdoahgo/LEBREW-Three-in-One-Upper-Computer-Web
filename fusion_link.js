import{BLE,Parser,Reassembler,fragments,frame,decoder,CMD}from'./fusion_protocol.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
export class SerialLink{
  kind='serial';name='串口';
  async connect(){if(!navigator.serial)throw Error('当前浏览器不支持 Web Serial，请用桌面版 Chrome / Edge 打开此页面');this.port=await navigator.serial.requestPort();try{await this.port.open({baudRate:921600,bufferSize:65536});this.writer=this.port.writable.getWriter();this.reader=this.port.readable.getReader();this.running=true;this.reading=this.read();}catch(e){await this.close();throw e;}}
  async read(){try{while(this.running){const{value,done}=await this.reader.read();if(done)break;if(value)this.ondata?.(value);}}catch(e){if(this.running)this.onerror?.(e);}finally{if(this.running){this.running=false;this.ondisconnect?.();}}}
  async write(bytes){await this.writer.write(bytes);}
  async close(){this.running=false;try{await this.reader?.cancel();await this.reading;}catch{}try{this.reader?.releaseLock();this.writer?.releaseLock();await this.port?.close();}catch{}this.ondisconnect?.();}
}
export class BleLink{
  kind='ble';name='蓝牙';writeSize=240;fast=true;fastCapable=true;chain=Promise.resolve();generation=0;
  constructor({wait=delay,burstPackets=2,pacingMs=1}={}){this.wait=wait;this.burstPackets=burstPackets;this.pacingMs=pacingMs;}
  prepareUpgrade(){this.fast=this.fastCapable&&this.writeSize>20;this.burstPackets=2;this.pacingMs=1;}
  async connect(device){
    if(!navigator.bluetooth)throw Error('当前浏览器不支持 Web Bluetooth，请用 Chrome / Edge');
    // Reuse a single previously authorized Fusion; multiple devices still use
    // the browser chooser so reconnect cannot silently pick another unit.
    let known=[];if(!device&&navigator.bluetooth.getDevices)try{known=(await navigator.bluetooth.getDevices()).filter(d=>d.name?.startsWith('RoastSee Fusion'));}catch{}
    this.device=device??(known.length===1?known[0]:await navigator.bluetooth.requestDevice({filters:[{namePrefix:'RoastSee Fusion'}],optionalServices:[BLE.service]}));
    this.disconnectHandler=()=>{this.generation++;this.ondisconnect?.();};this.device.addEventListener('gattserverdisconnected',this.disconnectHandler);
    try{this.server=await this.device.gatt.connect();const svc=await this.server.getPrimaryService(BLE.service);this.rx=await svc.getCharacteristic(BLE.rx);this.tx=await svc.getCharacteristic(BLE.tx);this.fastCapable=this.fast=!!this.rx.properties.writeWithoutResponse;
      this.reassembly=new Reassembler(b=>this.ondata?.(b));this.notify=e=>this.reassembly.push(new Uint8Array(e.target.value.buffer,e.target.value.byteOffset,e.target.value.byteLength));this.tx.addEventListener('characteristicvaluechanged',this.notify);await this.tx.startNotifications();
    }catch(e){await this.close();throw Error(`蓝牙连接失败：${e.message}。旧固件需先通过串口安装支持网页版的固件。`);}
  }
  async write(bytes,{fast=false}={}){
    const generation=this.generation;
    const work=async()=>{if(generation!==this.generation)throw Error('蓝牙连接已变化');
      for(;;){try{let burst=0;const parts=fragments(bytes,this.writeSize);for(const part of parts){
          if(generation!==this.generation)throw Error('蓝牙连接已断开');
          if(fast&&this.fast){await this.rx.writeValueWithoutResponse(part);if(++burst%this.burstPackets===0&&part!==parts.at(-1))await this.wait(this.pacingMs);}else await this.rx.writeValueWithResponse(part);
        }return;
      }catch(e){if(this.server?.connected&&this.writeSize>20&&/length|size|invalid|attribute/i.test(e.message)){this.writeSize=20;this.fast=false;continue;}throw e;}}
    };const p=this.chain.then(work);this.chain=p.catch(()=>{});return p;
  }
  async close(){this.generation++;this.tx?.removeEventListener('characteristicvaluechanged',this.notify);this.device?.removeEventListener('gattserverdisconnected',this.disconnectHandler);this.device?.gatt?.disconnect();this.ondisconnect?.();}
}
export class Client{
  constructor(link,{onEvent=()=>{},onDisconnect=()=>{}}={}){this.link=link;this.next=1;this.pending=new Map();this.closed=false;this.onEvent=onEvent;this.onDisconnect=onDisconnect;this.parser=new Parser(f=>this.receive(f));link.ondata=b=>this.parser.push(b);link.ondisconnect=()=>{this.failAll(Error('设备已断开'));onDisconnect();};link.onerror=e=>this.failAll(e);}
  receive(f){let o;try{o=JSON.parse(decoder.decode(f.payload));}catch{return;}
    if(f.seq===0){this.onEvent(o);return;}
    const p=this.pending.get(f.seq);if(!p||f.cmd!==(p.cmd|128))return;
    clearTimeout(p.timer);this.pending.delete(f.seq);if(o.ok)p.resolve(o.data);else p.reject(Object.assign(Error(o.error||'设备拒绝命令'),{data:o.data,deviceRejected:true}));
  }
  request(cmd,payload=new Uint8Array(),{timeout=8000,fast=false}={}){
    if(this.closed)return Promise.reject(Error('设备连接已关闭'));
    let seq=this.next;while(this.pending.has(seq))seq=(seq%65535)+1;this.next=(seq%65535)+1;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(seq);reject(Object.assign(Error(`命令 0x${cmd.toString(16)} 应答超时`),{code:'RESPONSE_TIMEOUT',cmd}));},timeout);this.pending.set(seq,{resolve,reject,timer,cmd});
      Promise.resolve().then(()=>this.link.write(frame(cmd,seq,payload),{fast})).catch(e=>{const p=this.pending.get(seq);if(p){clearTimeout(p.timer);this.pending.delete(seq);reject(e);}});
    });
  }
  failAll(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  async close(){this.closed=true;this.failAll(Error('连接关闭'));await this.link.close();}
}
