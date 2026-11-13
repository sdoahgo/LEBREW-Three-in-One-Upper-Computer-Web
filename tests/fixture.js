import{encoder}from'../fusion_protocol.js';
export function image(size=20000){const b=new Uint8Array(size);b[0]=0xe9;const v=new DataView(b.buffer);v.setUint16(12,9,true);v.setUint32(32,0xabcd5432,true);b.set(encoder.encode('1.0.0'),48);b.set(encoder.encode('NV3049F'),80);for(let i=288;i<size;i++)b[i]=i%251;return b;}
