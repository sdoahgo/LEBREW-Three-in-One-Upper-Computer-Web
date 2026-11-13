import{CMD}from'./fusion_protocol.js';
export function environmentValues(data){
  if(!data?.link)return{temperature:null,humidity:null,altitude:null};
  const raw=(value,multiplier,offset)=>Number.isInteger(value)&&value>=0&&value<=65535?((multiplier*value>>13)-offset)/1000:null;
  return{temperature:Number.isFinite(data.temperature)?data.temperature:raw(data.temperatureRaw,21875,45000),
    humidity:Number.isFinite(data.humidity)?data.humidity:raw(data.humidityRaw,15625,6000),
    altitude:Number.isFinite(data.altitude)?data.altitude:null};
}
export function altitudeValue(value){
  if(value==null||String(value).trim()==='')throw Error('请输入初始海拔高度（整数米）');
  const n=Number(value);if(!Number.isInteger(n)||n< -2147483648||n>2147483647)throw Error('初始海拔必须是有效的整数米');return n;
}
export function stepAltitude(value,step){return Math.min(2147483647,Math.max(-2147483648,altitudeValue(value)+step));}
export async function writeInitialAltitude(client,value){
  const height=altitudeValue(value),before=await client.request(CMD.INFO);
  if(!before.environmentCalibration)throw Error('当前固件不支持网页海拔设置，请升级配套固件');
  const payload=new Uint8Array(4);new DataView(payload.buffer).setInt32(0,height,true);
  await client.request(CMD.ENVIRONMENT,payload,{timeout:15000});
  const info=await client.request(CMD.INFO);
  if(info.initialAltitude!==height||!Number.isFinite(info.pressureReference)||info.pressureReference<=0)throw Error('初始海拔或气压基准未得到设备回读确认');
  return info;
}
