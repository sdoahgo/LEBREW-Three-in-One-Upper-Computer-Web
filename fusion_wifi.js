// The computer joins the device SSID through its normal WiFi menu.
// This module detects the selected Fusion before any firmware bytes are sent.
export async function probeWifi(url,{expectedMac,signal,fetchImpl=globalThis.fetch,requestTimeout=1800}={}){
  const endpoint=new URL('/info',url),controller=new AbortController();
  const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,requestTimeout);
  try{
    if(signal?.aborted)throw Error('已取消等待设备热点');
    const response=await fetchImpl(endpoint.href,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw Error('设备热点尚未就绪');
    const info=await response.json();
    if(info.device!=='RoastSee Fusion'||info.webProtocol!==1)throw Error('尚未检测到 Fusion 升级热点');
    let error;
    if(info.mode!=='ap-ota')error='设备尚未进入专用热点升级模式，请使用配套固件并重新进入热点模式';
    else if(!/^[\da-f]{2}(?::[\da-f]{2}){5}$/i.test(info.mac??''))error='热点未返回有效设备标识';
    else if(expectedMac&&info.mac.toUpperCase()!==expectedMac.toUpperCase())error='电脑连接的是另一台 Fusion 的热点，请连接刚才选择的设备';
    if(error){const e=Error(error);e.code='WIFI_TARGET';throw e;}
    return info;
  }catch(e){
    if(signal?.aborted)throw Error('已取消等待设备热点');
    if(controller.signal.aborted)throw Error('设备热点暂未响应，请确认电脑已连接 RoastSee-Fusion-OTA');
    throw e;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function pause(ms,signal){return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(Error('已取消等待设备热点'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});}
export async function waitForWifi(url,{signal,expectedMac,onStatus=()=>{},timeout=300000,interval=1500,
  now=Date.now,sleep=pause,...options}={}){
  const started=now();
  while(now()-started<timeout){
    if(signal?.aborted)throw Error('已取消等待设备热点');
    onStatus('请在电脑 WiFi 列表中连接 RoastSee-Fusion-OTA（密码 12345678）；连接后自动检测并上传。');
    try{
      const info=await probeWifi(url,{...options,signal,expectedMac});
      if(signal?.aborted)throw Error('已取消等待设备热点');
      onStatus(`已检测到 ${info.sn??info.mac}，开始上传固件…`);return info;
    }catch(e){if(signal?.aborted)throw Error('已取消等待设备热点');if(e.code==='WIFI_TARGET')throw e;}
    await sleep(Math.min(interval,Math.max(0,timeout-(now()-started))),signal);
  }
  throw Error('等待热点超时；请确认电脑已连接 RoastSee-Fusion-OTA，再点击开始升级重试');
}
