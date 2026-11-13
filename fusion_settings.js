import{CMD,nativeCommand}from'./fusion_protocol.js';
const ops={buzzer:[5,4],language:[6,7]},delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function setNativeToggle(client,key,value,{now=()=>performance.now(),wait=delay,timeoutMs=2500}={}){
  if(!ops[key]||![0,1].includes(value))throw Error('无效的开关选项');
  let info=await client.request(CMD.INFO);
  // Check actual state, including changes made on the physical screen.
  if(info[key]===value)return{info,changed:false};
  await client.request(CMD.NATIVE,nativeCommand(ops[key][value]),{timeout:6000});
  const deadline=now()+timeoutMs;
  do{info=await client.request(CMD.INFO);if(info[key]===value)return{info,changed:true};
    const left=deadline-now();if(left<=0)break;await wait(Math.min(100,left));
  }while(now()<=deadline);
  throw Error('设置尚未得到设备回读确认，请稍后重试');
}
