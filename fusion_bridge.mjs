// Optional original UDP discovery / TCP connection. Frames pass through unchanged.
import dgram from'node:dgram';import net from'node:net';import{EventEmitter}from'node:events';
export class FusionBridge extends EventEmitter{
  constructor({udpPort=12345,tcpPort=1234,host='0.0.0.0'}={}){super();this.udpPort=udpPort;this.tcpPort=tcpPort;this.host=host;this.devices=new Map();this.seen=new Map();this.next=1;this.started=false;}
  list(){return[...this.devices].map(([id,d])=>({id,address:d.address}));}
  async start(){if(this.started)return this.list();if(this.starting)return this.starting;this.starting=this.open();try{return await this.starting;}finally{this.starting=null;}}
  async open(){this.udp=dgram.createSocket('udp4');this.tcp=net.createServer(socket=>{
      if(!this.started||Date.now()-(this.seen.get(socket.remoteAddress)??0)>30000||this.devices.size>=8){socket.destroy();return;}
      const id=String(this.next++),device={socket,address:socket.remoteAddress};this.devices.set(id,device);socket.setNoDelay(true);socket.setTimeout(180000);socket.on('timeout',()=>socket.destroy());
      socket.on('data',b=>this.emit('bytes',{id,data:b.toString('base64')}));socket.on('error',()=>{});socket.on('close',()=>{this.devices.delete(id);this.emit('devices',this.list());});this.emit('devices',this.list());
    });
    this.udp.on('message',(msg,rinfo)=>{if(msg.toString().trim()!=='RoastSee Fusion')return;this.seen.set(rinfo.address,Date.now());if(this.seen.size>64)for(const[ip,time]of this.seen)if(Date.now()-time>30000)this.seen.delete(ip);this.udp.send(Buffer.from('Hello, ESP32!'),rinfo.port,rinfo.address);});
    try{await new Promise((resolve,reject)=>{this.tcp.once('error',reject);this.tcp.listen(this.tcpPort,this.host,()=>{this.tcp.removeListener('error',reject);resolve();});});await new Promise((resolve,reject)=>{this.udp.once('error',reject);this.udp.bind(this.udpPort,this.host,()=>{this.udp.removeListener('error',reject);resolve();});});this.started=true;this.udp.on('error',e=>this.emit('bridgeError',e));this.tcp.on('error',e=>this.emit('bridgeError',e));return this.list();}
    catch(e){await this.stop();throw Error(`无法开启局域网搜索：${e.message}。若原 Qt 上位机正在搜索，请先关闭它的搜索。`);}
  }
  write(id,bytes){const d=this.devices.get(id);if(!d)throw Error('局域网设备已断开');if(bytes.length>4110)throw Error('数据帧过大');d.socket.write(bytes);}
  async stop(){this.started=false;for(const d of this.devices.values())d.socket.destroy();this.devices.clear();try{this.udp?.close();}catch{}if(this.tcp?.listening)await new Promise(r=>this.tcp.close(r));this.emit('devices',[]);}
}
