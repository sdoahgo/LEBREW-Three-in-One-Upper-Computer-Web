import test from'node:test';import assert from'node:assert/strict';
import{probeWifi,waitForWifi}from'../fusion_wifi.js';
const target={device:'RoastSee Fusion',webProtocol:1,mode:'ap-ota',mac:'02:00:00:00:00:34',sn:'TEST-SN',webFirmware:'1.0.10'};
const response=info=>({ok:true,json:async()=>info});
test('WiFi probe checks the Fusion identity and MAC using a read-only info request',async()=>{
  let called;const info=await probeWifi('http://192.168.4.1/ota?crc=abc',{expectedMac:target.mac.toLowerCase(),fetchImpl:async(url,options)=>{called={url,options};return response(target);}});
  assert.deepEqual(info,target);assert.equal(called.url,'http://192.168.4.1/info');assert.equal(called.options.cache,'no-store');assert.equal(called.options.method,undefined);
});
test('another Fusion or normal-mode response cannot start an automatic upload',async()=>{
  for(const info of[{...target,mac:'00:11:22:33:44:55'},{...target,mode:'normal'},{...target,mac:''}]){
    await assert.rejects(waitForWifi('http://192.168.4.1/ota',{expectedMac:target.mac,fetchImpl:async()=>response(info)}),e=>e.code==='WIFI_TARGET');
  }
});
test('hotspot detection retries network loss and an unrelated gateway, then returns the correct device once',async()=>{
  let clock=0,attempts=0,active=0,maximum=0;const states=[];
  const found=await waitForWifi('http://192.168.4.1/ota',{expectedMac:target.mac,now:()=>clock,sleep:async ms=>{clock+=ms;},interval:10,timeout:100,onStatus:x=>states.push(x),fetchImpl:async()=>{
    active++;maximum=Math.max(maximum,active);try{if(++attempts===1)throw Error('offline');return response(attempts===2?{device:'router'}:target);}finally{active--;}
  }});
  assert.deepEqual(found,target);assert.equal(attempts,3);assert.equal(maximum,1);assert.match(states.at(-1),/TEST-SN/);
});
test('hotspot timeout and cancellation stop detection without sending any firmware',async()=>{
  let clock=0;await assert.rejects(waitForWifi('http://192.168.4.1/ota',{now:()=>clock,sleep:async ms=>{clock+=ms;},interval:10,timeout:20,fetchImpl:async()=>{throw Error('offline');}}),/超时/);
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(waitForWifi('http://192.168.4.1/ota',{signal:controller.signal,fetchImpl:async()=>{calls++;return response(target);}}),/取消/);assert.equal(calls,0);
});
test('each WiFi probe aborts stalled fetches and frees its timer',async()=>{
  let aborted=false;await assert.rejects(probeWifi('http://192.168.4.1/ota',{requestTimeout:5,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(Error('request timed out'));},{once:true});})}),/暂未响应/);
  assert.equal(aborted,true);
});
