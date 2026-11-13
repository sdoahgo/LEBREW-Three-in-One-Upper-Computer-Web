import test from'node:test';import assert from'node:assert/strict';import dgram from'node:dgram';import net from'node:net';import{once}from'node:events';import{FusionBridge}from'../fusion_bridge.mjs';import{frame}from'../fusion_protocol.js';
test('original UDP discovery and TCP frames round-trip without translation',async()=>{
  const bridge=new FusionBridge({udpPort:0,tcpPort:0,host:'127.0.0.1'}),udp=dgram.createSocket('udp4');let tcp;
  try{await bridge.start();const reply=once(udp,'message');udp.send(Buffer.from('RoastSee Fusion'),bridge.udp.address().port,'127.0.0.1');assert.equal((await reply)[0].toString(),'Hello, ESP32!');
    const discovered=once(bridge,'devices');tcp=net.connect(bridge.tcp.address().port,'127.0.0.1');await once(tcp,'connect');const[id]=await discovered;assert.equal(id.length,1);assert.equal(id[0].address,'127.0.0.1');
    const bytes=once(bridge,'bytes'),packet=frame(1,7);tcp.write(packet);assert.deepEqual(Buffer.from((await bytes)[0].data,'base64'),Buffer.from(packet));
    const incoming=once(tcp,'data');bridge.write(id[0].id,frame(0x81,7));assert.deepEqual((await incoming)[0],Buffer.from(frame(0x81,7)));assert.throws(()=>bridge.write('missing',packet),/断开/);
  }finally{tcp?.destroy();udp.close();await bridge.stop();}
});
test('TCP peers without the original discovery handshake are rejected',async()=>{const bridge=new FusionBridge({udpPort:0,tcpPort:0,host:'127.0.0.1'});let tcp;try{await bridge.start();tcp=net.connect(bridge.tcp.address().port,'127.0.0.1');await once(tcp,'close');assert.equal(bridge.list().length,0);}finally{tcp?.destroy();await bridge.stop();}});
