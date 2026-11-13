import test from'node:test';import assert from'node:assert/strict';import{Client,BleLink,SerialLink}from'../fusion_link.js';import{CMD,frame,encoder,Parser,Reassembler}from'../fusion_protocol.js';import{SimLink}from'../fusion_sim.js';
test('client matches command and sequence and ignores stray replies',async()=>{const link={write:async()=>{}},c=new Client(link);const request=c.request(CMD.INFO,new Uint8Array(),{timeout:100});link.ondata(frame(0x82,1,encoder.encode('{"ok":true,"data":0}')));assert.equal(c.pending.size,1);link.ondata(frame(0x81,1,encoder.encode('{"ok":true,"data":42}')));assert.equal(await request,42);assert.equal(c.pending.size,0);});
test('request timeout, write error and disconnect release all waiters',async()=>{const link={write:async()=>{}},c=new Client(link);await assert.rejects(c.request(1,new Uint8Array(),{timeout:10}),/超时/);const p=c.request(2);link.ondisconnect();await assert.rejects(p,/断开/);assert.equal(c.pending.size,0);link.write=async()=>{throw Error('Write failed');};await assert.rejects(c.request(3),/Write failed/);assert.equal(c.pending.size,0);});
test('BLE serialized writes restart safely after MTU rejection',async()=>{const link=new BleLink(),out=[],r=new Reassembler(b=>out.push(b));link.server={connected:true};let first=true;link.rx={writeValueWithResponse:async b=>{if(first){first=false;throw Error('Invalid attribute length');}r.push(b);}};const b=frame(1,1,new Uint8Array(600));await Promise.all([link.write(b),link.write(frame(2,2))]);assert.equal(link.writeSize,20);assert.equal(link.fast,false);assert.deepEqual(out[0],b);assert.equal(out.length,2);});
test('old queued GATT writes cannot cross disconnect generation',async()=>{const link=new BleLink();let release;link.chain=new Promise(r=>release=r);link.rx={writeValueWithResponse:async()=>assert.fail('must not write')};const p=link.write(frame(1,1));link.generation++;release();await assert.rejects(p,/变化/);});
test('BLE fast writes use bounded bursts instead of a fixed pause after every fragment',async()=>{
  const pauses=[],packets=[],received=[],reassembly=new Reassembler(b=>received.push(b));
  const link=new BleLink({wait:async ms=>pauses.push(ms)});link.server={connected:true};link.rx={writeValueWithoutResponse:async p=>{packets.push(p);reassembly.push(p);}};
  const bytes=frame(CMD.CHUNK,1,new Uint8Array(3000));await link.write(bytes,{fast:true});
  assert(packets.length>8);assert.deepEqual(pauses,Array(Math.floor((packets.length-1)/2)).fill(1));assert.deepEqual(received,[bytes]);
});
test('BLE disconnect during a burst pause prevents the remaining fragments from sending',async()=>{
  let count=0;const link=new BleLink({wait:async()=>{link.generation++;}});link.server={connected:true};link.rx={writeValueWithoutResponse:async()=>count++};
  await assert.rejects(link.write(frame(CMD.CHUNK,1,new Uint8Array(3000)),{fast:true}),/断开/);assert.equal(count,2);
});
test('a new BLE upgrade clears a stale slow fallback but respects transport capabilities and small MTU',()=>{
  const link=new BleLink();link.fast=false;link.burstPackets=1;link.pacingMs=2;link.prepareUpgrade();assert.equal(link.fast,true);assert.equal(link.burstPackets,2);assert.equal(link.pacingMs,1);
  link.writeSize=20;link.prepareUpgrade();assert.equal(link.fast,false);
  link.writeSize=240;link.fastCapable=false;link.prepareUpgrade();assert.equal(link.fast,false);
});
test('simulator connects through the real framed client, JSON readback and events',async()=>{const link=new SimLink(),events=[],c=new Client(link,{onEvent:e=>events.push(e)});await link.connect();assert.equal((await c.request(CMD.INFO)).sn,'NULL');await c.request(CMD.JSON,encoder.encode('{"calibrat_board":{"powder":12.3,"been":45.6}}'));assert.equal((await c.request(CMD.INFO)).boardBeen,45.6);await c.request(CMD.LEGACY,encoder.encode('sca_get\r\n'));await new Promise(r=>setTimeout(r,100));assert.match(events[0].text,/value 61000/);await c.close();});
test('capture completion is matched to its request rather than late broadcast events',async()=>{const link=new SimLink(),c=new Client(link);const p=c.request(CMD.CAPTURE);link.ondata(frame(CMD.EVENT,0,encoder.encode('{"event":"legacy","text":"old result"}')));assert.equal((await p).raw,61000);await c.close();});
test('serial always asks for the intended board instead of reusing a stale granted port',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try{for(const count of[0,1,2]){let selected=0,resolveRead;const port={open:async o=>assert.equal(o.baudRate,921600),close:async()=>{},readable:{getReader:()=>({read:()=>new Promise(r=>resolveRead=r),cancel:async()=>resolveRead?.({done:true}),releaseLock(){}})},writable:{getWriter:()=>({releaseLock(){}})}};
    const stale={open:async()=>assert.fail('A stale authorization must not select the board')};
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{serial:{getPorts:async()=>Array(count).fill(stale),requestPort:async()=>{selected++;return port;}}}});
    const link=new SerialLink();await link.connect();assert.equal(selected,1);await link.close();
  }}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
test('BLE reconnect only bypasses the chooser for one previously granted Fusion',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try{for(const count of[0,1,2]){let selected=0;const characteristic={properties:{writeWithoutResponse:true},addEventListener(){},removeEventListener(){},startNotifications:async()=>{}};
    const device={name:'RoastSee Fusion',addEventListener(){},removeEventListener(){},gatt:{connect:async()=>({getPrimaryService:async()=>({getCharacteristic:async()=>characteristic})}),disconnect(){}}};
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{bluetooth:{getDevices:async()=>Array(count).fill(device),requestDevice:async()=>{selected++;return device;}}}});
    const link=new BleLink();await link.connect();assert.equal(selected,count===1?0:1);await link.close();
  }}finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;}
});
