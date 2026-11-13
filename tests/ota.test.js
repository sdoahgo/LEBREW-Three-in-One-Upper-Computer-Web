import test from'node:test';import assert from'node:assert/strict';import{upgrade,uploadWifi,transferPlan}from'../fusion_ota.js';import{SimLink}from'../fusion_sim.js';import{Client}from'../fusion_link.js';import{CMD,OP,crc32,concat,u32}from'../fusion_protocol.js';import{image}from'./fixture.js';
function setup(){const link=new SimLink({legacyOta:true}),client=new Client(link);return{link,client};}
test('serial pipeline completes only after flash CRC, FINISH and REBOOT ack',async()=>{const{link,client}=setup();link.kind='serial';let max=0;const original=client.request.bind(client);client.request=(...args)=>{const p=original(...args);max=Math.max(max,client.pending.size);return p;};let last;await upgrade(client,image(100123),{onProgress:p=>last=p});assert.equal(link.state.state,'ready');assert.equal(link.state.offset,100123);assert.equal(max,4);assert.match(last.phase,/校验通过/);await client.close();});
test('BLE uses 221-byte payloads and two in-flight requests',async()=>{const{link,client}=setup();link.kind='ble';link.fast=true;let maxPayload=0,max=0;const original=client.request.bind(client);client.request=(cmd,payload,opts)=>{if(cmd===CMD.CHUNK){maxPayload=Math.max(maxPayload,payload.length-4);assert.equal(opts.fast,true);}const p=original(cmd,payload,opts);max=Math.max(max,client.pending.size);return p;};await upgrade(client,image());assert.equal(maxPayload,221);assert.equal(max,2);await client.close();});
test('resume keeps an unaligned flash checkpoint after validating prefix CRC',async()=>{const{client,link}=setup(),bytes=image();await client.request(CMD.CONTROL,concat(Uint8Array.of(OP.START),u32(bytes.length,crc32(bytes))));await client.request(CMD.CHUNK,concat(u32(0),bytes.subarray(0,777)));const original=client.request.bind(client);let first;client.request=(cmd,payload,options)=>{if(cmd===CMD.CHUNK&&first===undefined)first=new DataView(payload.buffer,payload.byteOffset).getUint32(0,true);return original(cmd,payload,options);};await upgrade(client,bytes);assert.equal(first,777);await client.close();});
test('dropped application ACK drains batch and resumes the exact committed offset',async()=>{const{client,link}=setup();link.kind='serial';let injected=false;const original=client.request.bind(client);client.request=async(cmd,payload,opts)=>{const result=await original(cmd,payload,opts);if(cmd===CMD.CHUNK&&!injected){injected=true;throw Error('Dropped ACK');}return result;};const logs=[];await upgrade(client,image(30001),{log:s=>logs.push(s)});assert.ok(logs.some(x=>x.includes('断点')));assert.equal(link.state.offset,30001);await client.close();});
test('CRC mismatch, incorrect committed offset and missing ready state never report success',async()=>{for(const failure of['crc','offset','ready']){const{client}=setup();const original=client.request.bind(client);client.request=async(cmd,p,opts)=>{const result=await original(cmd,p,opts);if(cmd===CMD.CONTROL&&p[0]===OP.QUERY&&result.offset>0&&failure==='crc')result.crc^=1;if(cmd===CMD.CHUNK&&failure==='offset')result.offset--;if(cmd===CMD.CONTROL&&p[0]===OP.FINISH&&failure==='ready')result.state='receiving';return result;};await assert.rejects(upgrade(client,image()),/确认失败|不一致|未确认/);await client.close();}});
test('cancel aborts receiving session, small MTU keeps useful fragment payload',async()=>{const{client,link}=setup(),signal=new AbortController();link.kind='ble';link.writeSize=20;let payloadSize;const original=client.request.bind(client);client.request=async(cmd,p,opts)=>{if(cmd===CMD.CHUNK){payloadSize=p.length-4;signal.abort();}return original(cmd,p,opts);};await assert.rejects(upgrade(client,image(),{signal:signal.signal}),/中止/);assert.equal(link.state.state,'idle');assert.equal(payloadSize,128);await client.close();});
test('device capabilities bound block sizes and queue windows, retaining legacy defaults',()=>{
  assert.deepEqual(transferPlan({}, {kind:'serial'}),{chunk:2048,window:4});assert.deepEqual(transferPlan({}, {kind:'ble'}),{chunk:221,window:2});
  assert.deepEqual(transferPlan({serialChunk:99999,serialWindow:99999},{kind:'serial'}),{chunk:4092,window:8});
  assert.deepEqual(transferPlan({bleChunk:2048,bleWindow:4},{kind:'ble'}),{chunk:512,window:2});
  for(const invalid of[null,NaN,-1,0,1.5,'2048'])assert.deepEqual(transferPlan({bleChunk:invalid,bleWindow:invalid},{kind:'ble'}),{chunk:221,window:2});
});
test('new firmware uses large blocks with compact checkpoint acknowledgments',async()=>{
  for(const kind of['serial','ble']){const{client,link}=setup();link.kind=kind;Object.assign(link.info,{serialChunk:4092,serialWindow:8,bleChunk:2048,bleWindow:2});
    const original=client.request.bind(client);let max=0,maxData=0;client.request=(cmd,p,opts)=>{const work=original(cmd,p,opts);max=Math.max(max,client.pending.size);if(cmd===CMD.CHUNK){maxData=Math.max(maxData,p.length-4);return work.then(({offset,crc})=>({offset,crc}));}return work;};
    await upgrade(client,image(90017));assert.equal(maxData,kind==='ble'?512:4092);assert.equal(max,kind==='ble'?2:8);await client.close();}
});
test('one lost BLE acknowledgment retains paced fast writes and restores the window after verified blocks',async()=>{
  const{client,link}=setup();Object.assign(link,{kind:'ble',writeSize:240,fast:true});Object.assign(link.info,{bleChunk:2048,bleWindow:2});
  const original=client.request.bind(client),logs=[];let dropped=false;
  client.request=async(cmd,p,opts)=>{const data=await original(cmd,p,opts);if(cmd===CMD.CHUNK&&!dropped){dropped=true;throw Error('Lost ACK');}return data;};
  await upgrade(client,image(30001),{log:s=>logs.push(s)});assert.equal(link.fast,true);assert.equal(link.burstPackets,1);assert.equal(link.pacingMs,2);assert(logs.some(s=>s.includes('恢复 2')));assert.equal(link.state.offset,30001);await client.close();
});
test('repeated BLE failures still use acknowledged writes and never skip the final CRC',async()=>{
  const{client,link}=setup();Object.assign(link,{kind:'ble',writeSize:240,fast:true});Object.assign(link.info,{bleChunk:512,bleWindow:2});const original=client.request.bind(client);let dropped=0,finalQuery=false;
  client.request=async(cmd,p,opts)=>{const data=await original(cmd,p,opts);if(cmd===CMD.CHUNK&&[1,3].includes(++dropped))throw Error('Lost ACK');if(cmd===CMD.CONTROL&&p[0]===OP.QUERY&&data.offset===20000)finalQuery=true;return data;};
  await upgrade(client,image());assert.equal(link.fast,false);assert(finalQuery);assert.equal(link.state.state,'ready');await client.close();
});
test('a slow acknowledgment does not hold back all other acknowledged writes',async()=>{
  const{client,link}=setup();link.kind='serial';const original=client.request.bind(client);let count=0,fourthPending=false,refilled=false,release;
  const held=new Promise(r=>release=r),timer=setTimeout(release,150);
  client.request=async(cmd,p,opts)=>{if(cmd!==CMD.CHUNK)return original(cmd,p,opts);const n=++count,answer=await original(cmd,p,opts);
    if(n===4){fourthPending=true;await held;fourthPending=false;}
    if(n===5){refilled=fourthPending;release();}return answer;};
  try{await upgrade(client,image(20001));assert(refilled);}finally{clearTimeout(timer);release();await client.close();}
});
test('out-of-order replies cannot create an unbounded acknowledgment backlog',async()=>{
  const{client,link}=setup();link.kind='serial';Object.assign(link.info,{serialChunk:4092,serialWindow:8});const original=client.request.bind(client);let count=0,held=true,maxBeforeFirst=0;
  const gate=new Promise(r=>setTimeout(()=>{held=false;r();},30));
  client.request=async(cmd,p,opts)=>{if(cmd!==CMD.CHUNK)return original(cmd,p,opts);const n=++count;if(held)maxBeforeFirst=count;const answer=await original(cmd,p,opts);if(n===1)await gate;return answer;};
  await upgrade(client,image(150001));assert.equal(maxBeforeFirst,8);await client.close();
});
test('bad per-block CRC and invalid resume offsets stop before committing the image',async()=>{
  for(const mode of['crc','offset']){const{client,link}=setup();const original=client.request.bind(client);let finished=false;
    client.request=async(cmd,p,opts)=>{if(cmd===CMD.CONTROL&&p[0]===OP.FINISH)finished=true;const data=await original(cmd,p,opts);
      if(cmd===CMD.CHUNK&&mode==='crc')data.crc=(data.crc^1)>>>0;
      if(cmd===CMD.CONTROL&&p[0]===OP.QUERY&&mode==='offset')Object.assign(data,{state:'receiving',size:20000,expectedCrc:crc32(image()),offset:-1});return data;};
    await assert.rejects(upgrade(client,image()),/CRC|偏移/);assert.equal(finished,false);await client.close();}
});
test('small-MTU fast firmware reduces blocks and cancellation drains writes before ABORT',async()=>{
  const{client,link}=setup();link.kind='ble';link.writeSize=20;Object.assign(link.info,{bleChunk:2048,bleWindow:2});const signal=new AbortController(),original=client.request.bind(client);let inFlight=0,maxData=0;
  client.request=async(cmd,p,opts)=>{if(cmd===CMD.CONTROL&&p[0]===OP.ABORT)assert.equal(inFlight,0);
    if(cmd!==CMD.CHUNK)return original(cmd,p,opts);inFlight++;maxData=Math.max(maxData,p.length-4);try{return await original(cmd,p,opts);}finally{inFlight--;}};
  await assert.rejects(upgrade(client,image(),{signal:signal.signal,onProgress:p=>{if(p.offset>0)signal.abort();}}),/中止/);assert.equal(maxData,256);assert.equal(link.state.state,'idle');await client.close();
});
class FakeXHR{upload={};status=200;responseText='OK-rebooting';open(method,url){this.url=url;}setRequestHeader(){}send(){}abort(){this.onabort();}}
test('WiFi 100% is waiting, exact device success is required',async()=>{const xhr=new FakeXHR(),updates=[],p=uploadWifi('http://192.168.4.1/ota',image(),{createXHR:()=>xhr,onProgress:v=>updates.push(v)});xhr.upload.onprogress({loaded:20000,total:20000,lengthComputable:true});assert.match(updates.at(-1).phase,/等待设备校验/);assert.match(xhr.url,/crc=/);xhr.onload();await p;assert.match(updates.at(-1).phase,/校验通过/);});
test('WiFi HTTP errors, unexpected text, network loss, timeout and cancel fail',async()=>{for(const fail of['http','text','network','timeout','abort']){const xhr=new FakeXHR(),p=uploadWifi('http://192.168.4.1/ota',image(),{createXHR:()=>xhr});if(fail==='http'){xhr.status=500;xhr.onload();}if(fail==='text'){xhr.responseText='OK';xhr.onload();}if(fail==='network')xhr.onerror();if(fail==='timeout')xhr.ontimeout();if(fail==='abort')xhr.abort();await assert.rejects(p);}});
