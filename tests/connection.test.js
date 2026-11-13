import test from'node:test';import assert from'node:assert/strict';import{CMD}from'../fusion_protocol.js';import{readDeviceInfo}from'../fusion_connection.js';
const timeout=()=>Object.assign(Error('命令 0x1 应答超时'),{code:'RESPONSE_TIMEOUT'});
test('serial handshake retries only INFO while the protocol driver is starting',async()=>{
  let clock=0,attempts=0;const notices=[],info={webProtocol:1,webFirmware:'1.0.5'};
  const client={request:async(cmd,payload,options)=>{assert.equal(cmd,CMD.INFO);if(++attempts<4){clock+=options.timeout;throw timeout();}return info;}};
  const value=await readDeviceInfo(client,{serial:true,now:()=>clock,wait:async ms=>{clock+=ms;},onWait:text=>notices.push(text)});
  assert.equal(value,info);assert.equal(attempts,4);assert.equal(notices.length,1);
});
test('an unresponsive port reaches a fixed deadline and does not recommend reflashing',async()=>{
  let clock=0,attempts=0;const client={request:async(cmd,p,o)=>{attempts++;clock+=o.timeout;throw timeout();}};
  await assert.rejects(readDeviceInfo(client,{serial:true,timeoutMs:3500,now:()=>clock,wait:async ms=>{clock+=ms;}}),e=>e.code==='HANDSHAKE_TIMEOUT'&&e.message.includes('重新选择')&&!e.message.includes('install_firmware'));
  assert.equal(clock,3500);assert.equal(attempts,3);
});
test('disconnects, refused commands and write errors are not retried',async()=>{
  for(const error of[Object.assign(Error('拒绝'),{deviceRejected:true}),Error('设备已断开'),Error('Write failed')]){
    let attempts=0;await assert.rejects(readDeviceInfo({request:async()=>{attempts++;throw error;}},{serial:true}),e=>e===error);assert.equal(attempts,1);
  }
  await assert.rejects(readDeviceInfo({request:async()=>{throw timeout();}},{serial:true,isConnected:()=>false}),/断开/);
});
test('Bluetooth and LAN retain their existing single INFO query',async()=>{
  let count=0;const info={webProtocol:1},client={request:async cmd=>{assert.equal(cmd,CMD.INFO);count++;return info;}};
  assert.equal(await readDeviceInfo(client),info);assert.equal(count,1);
});
