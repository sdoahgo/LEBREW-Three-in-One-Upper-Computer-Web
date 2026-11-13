import{CMD}from'./fusion_protocol.js';

export const MOISTURE_PROFILES=Object.freeze(['生豆','熟豆','带壳豆','干果']);
export const SCA_PROFILES=Object.freeze(['咖啡粉','咖啡豆']);
export function measurementCommand(kind,profile){
  const k=Number(kind),p=Number(profile);
  if(profile==null||String(profile).trim()===''||!Number.isInteger(p)||
    ![1,2,3].includes(k)||p<0||p>(k===1?3:k===3?1:0))throw Error('请选择设备支持的样品类型');
  return Uint8Array.of(k,p);
}
export function parseRawSample(text){
  const match=String(text).trim().match(/^demarcate,(weigh|cap),([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?),?$/);
  if(!match||!Number.isFinite(Number(match[2])))return null;
  return{kind:match[1]==='weigh'?'weight':'cap',value:Number(match[2])};
}
export async function requestMeasurement(client,info,kind,profile){
  if(!info?.measurementProfiles)throw Error('此设备固件尚不支持网页样品选择，请安装配套 1.0.3 固件');
  return client.request(CMD.MEASURE,measurementCommand(kind,profile),{timeout:15000});
}
