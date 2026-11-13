import test from'node:test';import assert from'node:assert/strict';import{CMD}from'../fusion_protocol.js';import{setNativeToggle}from'../fusion_settings.js';
test('reselecting the actual language or buzzer state avoids NVS writes and screen rebuilds',async()=>{
  for(const key of['language','buzzer']){const calls=[],client={request:async cmd=>{calls.push(cmd);return{[key]:1};}};
    assert.equal((await setNativeToggle(client,key,1)).changed,false);assert.deepEqual(calls,[CMD.INFO]);}
});
test('toggle commands retain original native opcodes and wait for asynchronous GUI readback',async()=>{
  for(const[key,value,op]of[['buzzer',0,5],['buzzer',1,4],['language',0,6],['language',1,7]]){
    let sent=false,reads=0,time=0;const client={request:async(cmd,p)=>{if(cmd===CMD.NATIVE){assert.equal(p[16],op);sent=true;return;}
      assert.equal(cmd,CMD.INFO);if(sent)reads++;return{[key]:sent&&reads>=3?value:1-value};}};
    const result=await setNativeToggle(client,key,value,{now:()=>time,wait:async ms=>{time+=ms;}});assert(result.changed);assert.equal(result.info[key],value);assert.equal(reads,3);
  }
});
test('unconfirmed settings time out and refused language commands never claim success',async()=>{
  let time=0;await assert.rejects(setNativeToggle({request:async()=>({language:0})},'language',1,{now:()=>time,wait:async ms=>{time+=ms;},timeoutMs:250}),/未得到设备回读确认/);
  const error=Error('Measurement active');await assert.rejects(setNativeToggle({request:async cmd=>{if(cmd===CMD.NATIVE)throw error;return{language:0};}},'language',1),e=>e===error);
  await assert.rejects(setNativeToggle({},'other',1),/无效/);
});
