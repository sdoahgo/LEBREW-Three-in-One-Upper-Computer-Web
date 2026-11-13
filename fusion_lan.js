export async function bridgeAction(path,body){const response=await fetch(`/bridge/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})});const data=await response.json();if(!response.ok)throw Error(data.error??'局域网桥接失败');return data;}
export class LanLink{
  kind='lan';name='局域网 WiFi';
  constructor(id){this.id=id;this.chain=Promise.resolve();this.closed=false;}
  async connect(){this.events=new EventSource('/bridge/events');this.bytes=e=>{const o=JSON.parse(e.data);if(o.id!==this.id||this.closed)return;const text=atob(o.data);this.ondata?.(Uint8Array.from(text,c=>c.charCodeAt(0)));};this.devices=e=>{if(!JSON.parse(e.data).some(d=>d.id===this.id))this.close();};this.events.addEventListener('bytes',this.bytes);this.events.addEventListener('devices',this.devices);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.close();reject(Error('本机桥接连接超时'));},4000);this.events.onopen=()=>{clearTimeout(timer);this.closed?reject(Error('局域网设备已断开')):resolve();};this.events.onerror=()=>{clearTimeout(timer);this.close();reject(Error('本机桥接服务不可用'));};});}
  async write(bytes){const send=async()=>{if(this.closed)throw Error('局域网连接已关闭');let text='';for(const b of bytes)text+=String.fromCharCode(b);await bridgeAction('write',{id:this.id,data:btoa(text)});};const p=this.chain.then(send);this.chain=p.catch(()=>{});return p;}
  async close(){if(this.closed)return;this.closed=true;this.events?.close();this.ondisconnect?.();}
}
