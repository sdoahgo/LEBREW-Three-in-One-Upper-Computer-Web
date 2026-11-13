import test from'node:test';import assert from'node:assert/strict';
import{RawRecorder,recordingCSV,recordingsCSV}from'../fusion_recording.js';
import{CMD,nativeCommand}from'../fusion_protocol.js';import{Client}from'../fusion_link.js';import{SimLink}from'../fusion_sim.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('recording accepts genuine new frame sequences and CSV includes identity and interval',async()=>{
  let seq=0,clock=100000;const client={request:async(c,p)=>p[0]===2?{active:true,valid:true,seq:++seq,deviceMs:seq*100,value:10+seq}:{}};
  const r=new RawRecorder(client,{now:()=>clock+=200});await r.start('weight',{rawMonitor:true,sn:'SN,"1'},'串口');await wait(10);await r.stop();
  assert.equal(r.rows.length,1);assert.equal(r.rows[0].value,11);assert(r.ended);const csv=recordingCSV(r);
  assert(csv.startsWith('\ufeff'));assert(csv.includes('"SN,""1"'));assert(csv.includes('"11"'));assert(csv.includes(r.started));assert(csv.includes(r.ended));
  const joined=recordingsCSV([r,{...r,started:'second interval'}]);assert.equal(joined.split('记录开始').length,2);assert(joined.includes('second interval'));assert.equal(joined.trim().split('\r\n').length,3);
});
test('stopping discards an in-flight sample and preserves recorded rows',async()=>{
  let resolve;const client={request:async(c,p)=>p[0]===2?new Promise(r=>resolve=r):{}};
  const r=new RawRecorder(client);await r.start('sca',{rawMonitor:true},'BLE');await r.stop();resolve({active:true,valid:true,seq:1,value:99});await wait(10);assert.equal(r.rows.length,0);assert.equal(r.active,false);
});
test('duplicate and invalid frames are not recorded; errors freeze an exportable record',async()=>{
  let step=0;const client={request:async(c,p)=>{if(p[0]!==2)return{};step++;if(step===1)return{active:true,valid:true,seq:1,value:12};if(step===2)return{active:true,valid:true,seq:1,value:99};if(step===3)return{active:true,valid:false,seq:2,value:NaN};throw Error('link lost');}};
  const r=new RawRecorder(client);await r.start('cap',{rawMonitor:true},'BLE');clearTimeout(r.timer);await wait(1);clearTimeout(r.timer);
  await r.tick();clearTimeout(r.timer);await r.tick();clearTimeout(r.timer);await r.tick();assert.equal(r.active,false);assert.equal(r.error,'link lost');assert.equal(r.rows.length,1);assert(recordingCSV(r).includes('"12"'));
});
test('old firmware cannot silently substitute one-shot reads for continuous monitoring',async()=>{
  const r=new RawRecorder({request:()=>assert.fail()});await assert.rejects(r.start('weight',{},'serial'),/1.0.4/);
});
test('framed simulator exercises all channels and readback of both toggle settings',async()=>{
  const link=new SimLink(),client=new Client(link),info=await client.request(CMD.INFO);
  for(const kind of ['weight','cap','sca']){const r=new RawRecorder(client);await r.start(kind,info,link.name);await wait(10);await r.stop();assert.equal(r.rows.length,1);assert.equal(link.monitor,null);}
  for(const[op,key,value]of[[4,'buzzer',1],[5,'buzzer',0],[6,'language',0],[7,'language',1]]){await client.request(CMD.NATIVE,nativeCommand(op));assert.equal((await client.request(CMD.INFO))[key],value);}
  await client.close();
});
