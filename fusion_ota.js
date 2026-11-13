import{CMD,OP,u32,concat,crc32,validateFirmware}from'./fusion_protocol.js';
// Capabilities come from the device. Old firmware retains its original block
// sizes; unknown or malformed capabilities cannot overrun the v1 frame/queue.
export function transferPlan(info,link){
  const bounded=(v,fallback,low,high)=>Number.isInteger(v)&&v>=low?Math.min(v,high):fallback;
  const ble=link.kind==='ble';return{chunk:bounded(info?.[ble?'bleChunk':'serialChunk'],ble?221:2048,128,ble?512:4092),window:bounded(info?.[ble?'bleWindow':'serialWindow'],ble?2:4,1,ble?2:8)};
}
export async function upgrade(client,bytes,{onProgress=()=>{},log=()=>{},signal}={}){
  const meta=validateFirmware(bytes),ble=client.link.kind==='ble';if(ble)client.link.prepareUpgrade?.();
  const plan=transferPlan(await client.request(CMD.INFO),client.link);
  let window=plan.window,chunk=plan.chunk,retries=0,stableBlocks=0,verified=false;const active=new Set();
  const control=(op,data=new Uint8Array())=>client.request(CMD.CONTROL,concat(Uint8Array.of(op),data),{timeout:60000});
  const check=()=>{if(signal?.aborted)throw Error('升级已中止');};
  const state=await control(OP.QUERY);if(state.state==='ready')throw Error('设备已有校验完成的升级，请先重启设备');
  if(state.state==='receiving'){
    if(state.size!==bytes.length||state.expectedCrc!==meta.crc)throw Error('设备有其他升级会话，请先中止该会话');
    if(!Number.isInteger(state.offset)||state.offset<0||state.offset>bytes.length)throw Error('设备断点偏移无效');
    if(crc32(bytes.subarray(0,state.offset))!==state.crc)throw Error('设备断点与所选文件不一致，请先中止该会话');
  }else{check();await control(OP.START,u32(meta.size,meta.crc));}
  const started=performance.now();let offset=state.state==='receiving'?state.offset:0,sent=offset,rolling=state.state==='receiving'?state.crc:0;const initial=offset,completed=new Map();
  log(`${ble?'蓝牙':'串口'}升级：每块 ${chunk} 字节，最多 ${window} 块在途`);
  if(ble)log(`蓝牙传输：GATT ${client.link.writeSize??240} 字节；${client.link.fast?'无应答快速写':'有应答写'}；每 ${client.link.burstPackets??2} 片短暂停顿`);
  let lastProgress=0,lastPhase='';const progress=(phase)=>{const now=performance.now();if(phase===lastPhase&&now-lastProgress<100&&offset<bytes.length)return;lastProgress=now;lastPhase=phase;const seconds=(now-started)/1000,speed=(offset-initial)/Math.max(seconds,.001);onProgress({phase,offset,total:bytes.length,percent:offset/bytes.length*100,speed,seconds,remaining:speed?(bytes.length-offset)/speed:0});};
  try{
    while(offset<bytes.length){check();
      const block=ble&&client.link.writeSize<=20?Math.min(chunk,plan.chunk>221?256:128):chunk;
      // Refill after every acknowledgment, rather than waiting for a whole batch.
      while(active.size+completed.size<window&&sent<bytes.length){const start=sent,end=Math.min(bytes.length,start+block);sent=end;
        let job;job=client.request(CMD.CHUNK,concat(u32(start),bytes.subarray(start,end)),{timeout:ble?8000:15000,fast:ble&&client.link.fast}).then(data=>({job,start,end,data}),error=>({job,start,end,error}));active.add(job);}
      const result=await Promise.race(active);active.delete(result.job);
      if(result.error){
        await Promise.all(active);active.clear();completed.clear(); // No old writes may cross the checkpoint or an abort.
        if(++retries>5)throw result.error;window=1;chunk=Math.min(chunk,512);stableBlocks=0;
        if(ble){
          log(`蓝牙数据请求失败：${result.error.message}`);
          if(retries===1&&client.link.fast&&client.link.writeSize>20){client.link.burstPackets=1;client.link.pacingMs=2;log('先降低突发速率，保留无应答快速写');}
          else{client.link.fast=false;log('连续异常，切换有应答写以保证数据完整');}
        }
        const checkpoint=await control(OP.QUERY);if(checkpoint.state!=='receiving'||checkpoint.size!==bytes.length||checkpoint.offset>bytes.length||crc32(bytes.subarray(0,checkpoint.offset))!==checkpoint.crc)throw Error('断点 CRC 校验失败，停止升级');
        if(!Number.isInteger(checkpoint.offset)||checkpoint.offset<0||checkpoint.expectedCrc!==meta.crc)throw Error('断点 CRC 校验失败，停止升级');
        offset=sent=checkpoint.offset;rolling=checkpoint.crc;log(`从 Flash 校验断点 ${offset} 继续；每块 ${chunk} 字节，${window} 块在途`);
      }else{
        if(result.data?.offset!==result.end)throw Error('设备应答偏移与发送字节数不一致');completed.set(result.start,result);
        while(completed.has(offset)){const ack=completed.get(offset);completed.delete(offset);rolling=crc32(bytes.subarray(offset,ack.end),rolling);
          if(ack.data.crc!=null&&ack.data.crc!==rolling)throw Error('数据块 CRC 确认失败');offset=ack.end;stableBlocks++;}
        if(ble&&retries===1&&client.link.fast&&window===1&&stableBlocks>=16){window=plan.window;log(`连续校验通过，恢复 ${window} 块在途`);}
      }progress('传输中');
    }
    check();const final=await control(OP.QUERY);
    if(final.offset!==bytes.length||final.crc!==meta.crc)throw Error('整包写入确认失败');
    progress('设备校验中');const done=await control(OP.FINISH);
    if(done.state!=='ready'||done.crc!==meta.crc||done.offset!==bytes.length)throw Error('设备未确认镜像校验和启动分区');
    verified=true;await control(OP.REBOOT);progress('校验通过，重启已确认');return meta;
  }catch(e){
    await Promise.all(active);active.clear();
    if(signal?.aborted&&!verified){try{await control(OP.ABORT);}catch{} }
    throw e;
  }
}
export function uploadWifi(url,bytes,{onProgress=()=>{},signal,createXHR=()=>new XMLHttpRequest()}={}){
  validateFirmware(bytes);const target=new URL(url);if(!['http:','https:'].includes(target.protocol))throw Error('WiFi 地址必须是 HTTP 地址');target.searchParams.set('crc',crc32(bytes).toString(16));
  return new Promise((resolve,reject)=>{
    const xhr=createXHR(),start=performance.now();let finished=false;
    const abort=()=>xhr.abort(),finish=(err)=>{if(finished)return;finished=true;signal?.removeEventListener('abort',abort);err?reject(err):resolve();};
    xhr.open('POST',target.href);xhr.timeout=300000;xhr.setRequestHeader('Content-Type','application/octet-stream');
    xhr.upload.onprogress=e=>{const total=e.lengthComputable?e.total:bytes.length,seconds=(performance.now()-start)/1000,speed=e.loaded/Math.max(seconds,.001);onProgress({phase:e.loaded>=total?'上传完成，等待设备校验':'WiFi 上传中',offset:e.loaded,total,percent:e.loaded/total*100,speed,seconds,remaining:speed?(total-e.loaded)/speed:0});};
    xhr.onload=()=>{if(xhr.status>=200&&xhr.status<300&&xhr.responseText.trim()==='OK-rebooting'){onProgress({phase:'校验通过，设备正在重启',offset:bytes.length,total:bytes.length,percent:100});finish();}else finish(Error(`设备未确认成功：HTTP ${xhr.status} ${xhr.responseText.slice(0,160)}`));};
    xhr.onerror=()=>finish(Error('WiFi 连接失败；请连接设备热点，并允许浏览器访问本地网络'));xhr.ontimeout=()=>finish(Error('WiFi 上传超时，未确认成功'));xhr.onabort=()=>finish(Error('WiFi 上传已中止，未确认成功'));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){finish(Error('上传已中止'));return;}xhr.send(bytes);
  });
}
