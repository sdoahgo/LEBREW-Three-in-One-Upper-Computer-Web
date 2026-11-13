import test from'node:test';import assert from'node:assert/strict';
import{CMD,encoder}from'../fusion_protocol.js';import{measurementCommand,parseRawSample,requestMeasurement}from'../fusion_measurement.js';import{SimLink}from'../fusion_sim.js';import{Client}from'../fusion_link.js';
test('measurement profiles use the firmware mapping and reject unsupported selections',()=>{
  for(let p=0;p<4;p++)assert.deepEqual([...measurementCommand(1,p)],[1,p]);
  assert.deepEqual([...measurementCommand(3,0)],[3,0]);assert.deepEqual([...measurementCommand(3,1)],[3,1]);
  assert.deepEqual([...measurementCommand(2,0)],[2,0]);
  for(const[k,p]of [[1,4],[1,-1],[3,2],[2,1],[0,0],[1,''],[1,null],[1,NaN],[3,.5]])assert.throws(()=>measurementCommand(k,p));
});
test('legacy diagnostics parse signed values but ignore unrelated or malformed events',()=>{
  assert.deepEqual(parseRawSample('demarcate,weigh,-29528\r\n'),{kind:'weight',value:-29528});
  assert.deepEqual(parseRawSample('demarcate,cap,2.79,\r\n'),{kind:'cap',value:2.79});
  for(const text of ['powder 50,been 50,value 60000','demarcate,cap,NaN','demarcate,weigh,1oops','noise demarcate,weigh,1'])assert.equal(parseRawSample(text),null);
});
test('old firmware is never silently measured using an unselected profile',async()=>{
  const client={request:()=>assert.fail('must not send')};await assert.rejects(requestMeasurement(client,{},3,1),/1.0.3/);
});
test('profile selection and start are one framed request; busy repeats are rejected',async()=>{
  const link=new SimLink(),client=new Client(link),info=await client.request(CMD.INFO);
  const result=await requestMeasurement(client,info,3,1);assert.equal(result.scaMode,1);
  await assert.rejects(requestMeasurement(client,info,1,2),/active/);
  assert.equal((await client.request(CMD.INFO)).measureMode,0);
  await client.close();
});
test('weight and capacitance events retain their own labels and values',async()=>{
  const samples=[],link=new SimLink(),client=new Client(link,{onEvent:e=>{const r=parseRawSample(e.text);if(r)samples.push(r);}});
  await client.request(CMD.LEGACY,encoder.encode('weigh_get\r\n'));await client.request(CMD.LEGACY,encoder.encode('cap_get\r\n'));await new Promise(r=>setTimeout(r,100));
  assert.deepEqual(samples,[{kind:'weight',value:123456},{kind:'cap',value:16.52}]);await client.close();
});
