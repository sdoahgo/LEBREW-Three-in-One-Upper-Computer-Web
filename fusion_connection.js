import{CMD}from'./fusion_protocol.js';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
// Opening a serial port can reset a board. An INFO sent before its protocol
// driver starts is lost, so retry only this read-only query within a fixed bound.
export async function readDeviceInfo(client,{serial=false,isConnected=()=>true,onWait=()=>{},timeoutMs=12000,now=()=>performance.now(),wait=delay}={}){
  if(!serial)return client.request(CMD.INFO);
  const deadline=now()+timeoutMs;let waitingNotified=false;
  while(now()<deadline){
    if(!isConnected())throw Error('串口已断开，请重新连接');
    try{return await client.request(CMD.INFO,new Uint8Array(),{timeout:Math.min(1200,Math.max(1,deadline-now()))});}
    catch(e){if(e.code!=='RESPONSE_TIMEOUT'||!isConnected())throw e;
      if(!waitingNotified){waitingNotified=true;onWait('串口已打开，等待设备启动并重新查询设备信息…');}
      const left=deadline-now();if(left>0)await wait(Math.min(150,left));
    }
  }
  throw Object.assign(Error('串口已打开，但未收到设备信息。请重新选择正确的 ESP32-S3 主板串口，并确认设备已开机。'),{code:'HANDSHAKE_TIMEOUT'});
}
