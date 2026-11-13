import test from'node:test';import assert from'node:assert/strict';
import{CMD}from'../fusion_protocol.js';import{environmentValues,altitudeValue,stepAltitude,writeInitialAltitude}from'../fusion_environment.js';
import{SimLink}from'../fusion_sim.js';import{Client}from'../fusion_link.js';
test('environment uses firmware engineering values, with exact legacy temperature/humidity fallback',()=>{
  assert.deepEqual(environmentValues({link:true,temperature:24.5,humidity:58.3,altitude:-15}),{temperature:24.5,humidity:58.3,altitude:-15});
  for(const raw of[0,28439,33000,65535]){const got=environmentValues({link:true,temperatureRaw:raw,humidityRaw:raw});assert.equal(got.temperature,((21875*raw>>13)-45000)/1000);assert.equal(got.humidity,((15625*raw>>13)-6000)/1000);assert.equal(got.altitude,null);}
  assert.deepEqual(environmentValues({link:false,temperature:20,humidity:60,altitude:99}),{temperature:null,humidity:null,altitude:null});
  assert.equal(environmentValues({link:true,temperatureRaw:null}).temperature,null);
});
test('initial altitude accepts signed integer metres and adjustment cannot wrap int32',()=>{
  for(const value of['',null,'1.5',NaN,Infinity,2147483648,-2147483649])assert.throws(()=>altitudeValue(value));
  assert.equal(altitudeValue('-12'),-12);assert.equal(stepAltitude(0,-1),-1);assert.equal(stepAltitude(2147483647,1),2147483647);assert.equal(stepAltitude(-2147483648,-1),-2147483648);
});
test('altitude writes signed little-endian and requires a separate saved-reference readback',async()=>{
  const calls=[];let reads=0;const client={request:async(cmd,p)=>{calls.push(cmd);if(cmd===CMD.INFO)return ++reads===1?{environmentCalibration:true}:{initialAltitude:-123,pressureReference:101000};assert.equal(cmd,CMD.ENVIRONMENT);assert.deepEqual([...p],[133,255,255,255]);return{};}};
  assert.equal((await writeInitialAltitude(client,-123)).initialAltitude,-123);assert.deepEqual(calls,[CMD.INFO,CMD.ENVIRONMENT,CMD.INFO]);
});
test('unsupported firmware, refused saves and mismatched readbacks cannot announce success',async()=>{
  const calls=[];await assert.rejects(writeInitialAltitude({request:async cmd=>{calls.push(cmd);return{};}},12),/升级/);assert.deepEqual(calls,[CMD.INFO]);
  let reads=0;await assert.rejects(writeInitialAltitude({request:async cmd=>{if(cmd===CMD.INFO)return ++reads===1?{environmentCalibration:true}:{initialAltitude:99,pressureReference:101325};}},12),/回读确认/);
  await assert.rejects(writeInitialAltitude({request:async cmd=>{if(cmd===CMD.INFO)return{environmentCalibration:true};throw Error('Pressure sensor unavailable');}},12),/Pressure sensor/);
});
test('framed simulator supports setting and reading altitude, and refuses it during measurements',async()=>{
  const link=new SimLink(),client=new Client(link);await link.connect();try{const info=await writeInitialAltitude(client,1250);assert.equal(info.initialAltitude,1250);const live=await client.request(CMD.TELEMETRY);assert.ok(Math.abs(live.altitude-1250)<1e-6);await client.request(CMD.MEASURE,Uint8Array.of(3,0));await assert.rejects(writeInitialAltitude(client,0),/busy/);}finally{await client.close();}
});
