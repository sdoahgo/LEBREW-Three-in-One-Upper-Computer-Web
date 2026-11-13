import{RawRecorder,recordingsCSV}from'./fusion_recording.js';
import{readDeviceInfo}from'./fusion_connection.js';
import{setNativeToggle}from'./fusion_settings.js';
import{environmentValues,stepAltitude,writeInitialAltitude}from'./fusion_environment.js';
import{MOISTURE_PROFILES,SCA_PROFILES,parseRawSample,requestMeasurement}from'./fusion_measurement.js';
import{LanLink,bridgeAction}from'./fusion_lan.js';
import{CMD,OP,encoder,u32,nativeCommand,parsePointDraft,validatePoints,validateFirmware,generateSN}from'./fusion_protocol.js';
import{SerialLink,BleLink,Client}from'./fusion_link.js';
import{upgrade,uploadWifi}from'./fusion_ota.js';
import{waitForWifi}from'./fusion_wifi.js';
import{SimLink}from'./fusion_sim.js';
const $=id=>document.getElementById(id),sessions=new Map();let lanEvents=null,lanDevices=[],selected=null,nextId=1,busy=false,connecting=false,capture=null,firmware=null,aborter=null,logs=[],history=[];
const storageKey='fusion-sca-v1';let points={sca_point_count:'9',sca_been:Array(15).fill(''),sca_powder:Array(15).fill(''),sca_values:Array(15).fill('')};
let wifiExpectedMac=null,wifiDevice=null;
const isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
if (!isLocal) {
  $('lanHelp').textContent = '原版 UDP / TCP 搜索需要运行本机上位机服务。';
  $('lanControls').hidden = true;
  $('lanLocal').hidden = false;
  $('wifiBrowserHelp').hidden = false;
  $('installHelp').href = 'https://github.com/sdoahgo/LEBREW-Three-in-One-Upper-Computer-Web#首次安装及恢复';
}
function log(text){const line=`[${new Date().toLocaleTimeString('zh-CN',{hour12:false})}] ${text}`;logs.push(line);if(logs.length>1500)logs.shift();$('log').textContent=logs.join('\n');$('log').scrollTop=$('log').scrollHeight;}
function notice(text,success=false){$('notice').hidden=false;$('notice').className=success?'notice success':'notice';$('notice').textContent=text;log(text);}
function current(){const s=sessions.get(selected);if(!s?.connected)throw Error('请先连接设备');return s;}
function controls(){const s=sessions.get(selected),connected=!!s?.connected;
  document.querySelectorAll('[data-device]').forEach(b=>b.disabled=!connected||busy||!!capture);
  for(const id of['connectSerial','connectBle','simulate'])$(id).disabled=busy||connecting||!!capture;
  $('searchWifi').disabled=busy||!!capture||connecting;$('stopSearchWifi').disabled=busy||!!capture||!lanEvents;$('disconnect').disabled=!connected||busy||!!capture;$('upgradeStart').disabled=!firmware||busy||!!capture||(!connected&&document.querySelector('[name=upgradeMethod]:checked').value!=='wifi');
  $('firmware').disabled=busy;$('upgradeCancel').disabled=!busy;
  const wifi=document.querySelector('[name=upgradeMethod]:checked').value==='wifi';
  $('wifiOptions').hidden=!wifi;$('wifiUrl').disabled=busy;$('wifiBack').disabled=busy;
  $('startWifi').disabled=!connected||busy||!!capture||!firmware||!!s?.live?.measurementBusy||!!s?.measurementWatch;
  document.querySelectorAll('[name=upgradeMethod]').forEach(e=>e.disabled=busy);
  $('importPoints').disabled=busy||!!capture;$('pointCount').disabled=busy||!!capture;
  document.querySelectorAll('#pointsTable input').forEach(e=>e.disabled=busy||!!capture||Number(e.dataset.index)>=Number(points.sca_point_count));
  document.querySelectorAll('[data-capture]').forEach(e=>e.disabled=!connected||busy||!!capture||Number(e.dataset.index)>=Number(points.sca_point_count));
  document.querySelectorAll('[data-measure],[data-raw],[data-profile]').forEach(e=>e.disabled=!connected||busy||!!capture||!!s?.live?.measurementBusy||!!s?.measurementWatch);
  document.querySelectorAll('[data-toggle="language"]').forEach(e=>e.disabled=!connected||busy||!!capture||!!s?.live?.measurementBusy||!!s?.measurementWatch);
  document.querySelectorAll('[data-altitude]').forEach(e=>e.disabled=!connected||busy||!!capture||!s?.info?.environmentCalibration||!!s?.live?.measurementBusy||!!s?.measurementWatch);
  document.querySelectorAll('[data-stop-raw]').forEach(b=>b.disabled=!s?.recording?.active||b.dataset.stopRaw!==s.recording.kind);
  document.querySelectorAll('[data-export-raw]').forEach(b=>b.disabled=!s?.recordings?.[b.dataset.exportRaw]?.rows.length);
  document.querySelectorAll('[data-record-history]').forEach(b=>b.disabled=!s?.recordingHistory?.some(r=>r.kind===b.dataset.recordHistory));
  $('deviceCount').textContent=[...sessions.values()].filter(s=>s.connected).length;
  $('connectionState').textContent=connected?`${s.link.name}已连接${s.link.kind==='sim'?' · 模拟':''}`:'未连接设备';$('connectionState').className=connected?'badge connected':'badge';
}
function displayInfo(info){$('snValue').textContent=info.sn??'—';$('deviceMac').textContent=info.mac??'—';$('versionValue').textContent=`${info.fw??'—'} / ${info.hw??'—'}`;$('buildValue').textContent=`网页协议 v${info.webProtocol??'?'}${info.webFirmware?' · 适配 '+info.webFirmware:''} · ${info.build??''}`;
  const fields={boardPowder:'boardPowder',boardBeen:'boardBeen',linearA:'linearA',linearB:'linearB',brightness:'brightness',sleep:'sleep',measureMode:'measureMode',scaMode:'scaMode'};
  for(const[id,key]of Object.entries(fields))if(info[key]!=null)$(id).value=info[key];
  for(const id of['measureMode','scaMode'])if(info[id]==null)$(id).value='';
  document.querySelectorAll('[data-toggle]').forEach(b=>{const active=info[b.dataset.toggle]===Number(b.dataset.value);b.classList.toggle('is-selected',active);b.setAttribute('aria-pressed',String(active));});
  const session=sessions.get(selected);renderRaw(session);$('rawStatus').textContent=session?.rawStatus??'读取结果显示在对应卡片；原始应答也会保留在下方通信记录。';$('measurementStatus').textContent=session?.measurementText??'等待测量。下方显示设备最近一次返回的测量结果。';showActiveProfiles(info);
  showAltitudeReference(session,info);
}
function showAltitudeReference(session,data={}){const height=data.initialAltitude??session?.info?.initialAltitude;
  $('altitudeSaved').textContent=Number.isFinite(height)?`设备保存的初始海拔：${height} m`:'设备初始海拔：待读取';
  $('initialAltitude').value=session?.altitudeDraft??(Number.isFinite(height)?height:'');
  $('altitudeHint').textContent=session?.info?.environmentCalibration?'输入当地已知海拔，点击保存；使用设备原有气压校准并保存。加减和归零只修改输入值。':'连接支持海拔设置的配套固件后可调节。旧版固件需升级。';
}
function renderSession(s){
  history=s.history??=[];
  if(s.info)displayInfo(s.info);
  if(s.live)telemetry(s.live,{cached:true});
  else {$('scaValue').textContent='—';$('sensorState').textContent='待读取';$('lastUpdate').textContent='尚未收到数据';$('telemetry').replaceChildren();$('sensorRawTelemetry').replaceChildren();$('environmentTelemetry').replaceChildren();for(const name of['温度 °C','湿度 %RH','海拔 m']){const item=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent='—';item.append(dt,dd);$('environmentTelemetry').append(item);}drawTrend();}
  if(!s.connected)$('sensorState').textContent='连接已断开';
  $('environmentNote').textContent=s.connected?'与设备主屏幕使用相同换算；初始海拔可在“设备设置”中调整。':'连接已断开，以下为最后收到的环境数据。';
}
function deviceList(){$('deviceList').replaceChildren();for(const[id,s]of sessions){const b=document.createElement('button');b.textContent=`${s.info?.name??'Fusion'} · ${s.link.name}\n${s.info?.sn??'—'} · ${s.connected?'在线':'已断开'}`;b.className=id===selected?'selected':'';b.disabled=busy||!!capture;b.onclick=()=>{selected=id;renderSession(s);deviceList();controls();};$('deviceList').append(b);}controls();}
function showActiveProfiles(data){$('activeProfiles').textContent=`设备当前模式：含水率 / 密度 · ${MOISTURE_PROFILES[data.measureMode]??'待读取'}；色度 · ${SCA_PROFILES[data.scaMode]??'待读取'}`;}
function renderRaw(session){for(const[k,id]of[['weight','rawWeight'],['cap','rawCap'],['sca','rawSca']]){const r=session?.rawSamples?.[k],record=session?.recordings?.[k];$(id).textContent=r?String(r.value):'尚未读取';$(id+'Time').textContent=r?`读取于 ${new Date(r.time).toLocaleTimeString('zh-CN',{hour12:false})}`:'本次读取值将在这里显示';$(id+'Count').textContent=record?`${record.active?'记录中':'已结束'} · ${record.rows.length} 条 · ${((Date.parse(record.ended??new Date().toISOString())-Date.parse(record.started))/1000).toFixed(1)} 秒`:'0 条记录';}}
function eventFor(session,event){if(event.event==='legacy'){log(`RX ${session.link.name} ${(event.text??'').trim()}`);const sample=parseRawSample(event.text);if(sample){session.rawSamples??={};session.rawSamples[sample.kind]={value:sample.value,time:Date.now()};if(session.rawWaiter?.kind===sample.kind)session.rawWaiter.resolve(sample);if(selected===session.id)renderRaw(session);}}}
function showRecording(session,record){
  const last=record.rows.at(-1);if(last){session.rawSamples??={};session.rawSamples[record.kind]={value:last.value,time:last.time};if(record.kind==='sca'&&session.trendLastSample!==last){session.trendLastSample=last;const trend=session.history??=[];trend.push(last.value);if(trend.length>120)trend.shift();if(selected===session.id){history=trend;drawTrend();}}}
  if(selected===session.id){renderRaw(session);const id={weight:'rawWeight',cap:'rawCap',sca:'rawSca'}[record.kind];
    $(id+'Count').textContent=`${record.active?'记录中':'已结束'} · ${record.rows.length} 条 · ${((Date.parse(record.ended??new Date().toISOString())-Date.parse(record.started))/1000).toFixed(1)} 秒`;
    $('rawStatus').textContent=session.rawStatus=record.error?`记录中断：${record.error}。已收到的 ${record.rows.length} 条仍可导出。`:record.active?'正在持续监测；点击“结束记录”停止，再导出本段 CSV。':`记录结束，共 ${record.rows.length} 条，可导出本段 CSV。`;
  }
  if(!record.active&&capture?.key==='recording'&&capture.session===session)capture=null;
  controls();
}
async function collectRaw(kind){const session=current();if(session.live?.measurementBusy||session.measurementWatch)throw Error('请等待当前测量或校准结束');
  capture={session,key:'recording'};controls();const record=new RawRecorder(session.client,{onChange:r=>showRecording(session,r),onError:e=>log(`连续监测中断：${e.message}`)});
  try{await record.start(kind,session.info,session.link.name);session.recordings??={};session.recordingHistory??=[];
    if(session.recordings[kind])session.recordingHistory.push(session.recordings[kind]);session.recordings[kind]=record;session.recording=record;controls();
    log(`开始 ${kind} 连续监测，不写入标定参数`);
  }catch(e){capture=null;controls();throw e;}}
async function stopRaw(){const session=current(),r=session.recording;if(!r?.active)return;
  capture={session,key:'stopping'};controls();try{await r.stop();log(`${r.kind} 已停止，共 ${r.rows.length} 条`);}finally{capture=null;controls();}}
function exportRaw(kind,previous=false){const s=sessions.get(selected);const records=previous?s.recordingHistory.filter(r=>r.kind===kind):[s.recordings[kind]];
  exportFile(`Fusion_${kind}_${previous?'history':records[0].started.replaceAll(/[:.]/g,'-')}.csv`,recordingsCSV(records),'text/csv;charset=utf-8');}
async function beginMeasurement(kind){const session=current();if(session.measurementWatch||session.live?.measurementBusy)throw Error('请等待当前测量完成');const profile=kind===1?number('measureMode'):kind===3?number('scaMode'):0;capture={session,key:'measurement'};controls();
  try{const data=await requestMeasurement(session.client,session.info,kind,profile);session.info=data;session.measurementWatch={started:Date.now(),sawBusy:false};session.measurementText=`${kind===1?'含水率 / 密度 · '+MOISTURE_PROFILES[profile]:kind===3?'色度 · '+SCA_PROFILES[profile]:'水活度'}：请求已接收，等待设备开始测量…`;displayInfo(data);log(session.measurementText);}finally{capture=null;controls();}}

async function connect(kind,lanId){if(busy||connecting)return;connecting=true;controls();const link=kind==='lan'?new LanLink(lanId):$('simulate').checked?new SimLink():kind==='serial'?new SerialLink():new BleLink();let session;
  try{await link.connect();session={id:nextId++,link,connected:true};session.client=new Client(link,{onEvent:e=>eventFor(session,e),onDisconnect:()=>{session.connected=false;if(!sessions.has(session.id))return;if(session.recording?.active)session.recording.finish('设备连接已断开');log(`${link.name}连接已断开`);if(selected===session.id)renderSession(session);deviceList();}});
    const info=await readDeviceInfo(session.client,{serial:link.kind==='serial',isConnected:()=>session.connected,onWait:log});if(info?.webProtocol!==1)throw Error('设备未提供网页版协议 v1');session.info=info;sessions.set(session.id,session);selected=session.id;renderSession(session);notice(`${link.name}连接成功${link.kind==='sim'?'（模拟设备，所有数据均为演示）':''}`,true);$('connectionHint').textContent=`${info.name} · ${info.mac} · 串口和蓝牙共用相同设备功能；连接串口时请明确选择主板端口`;deviceList();
  }catch(e){if(session)await session.client.close();else await link.close();notice(`${e.message}${e.code==='HANDSHAKE_TIMEOUT'?'\n已安装网页固件时无需重新刷机，请优先核对串口。':''}`);}
  finally{connecting=false;controls();}
}
function savePoints(){try{localStorage.setItem(storageKey,JSON.stringify(points));}catch(e){log(`本地保存失败：${e.message}，请导出数据备份`);}}
function renderPoints(){const count=Number(points.sca_point_count);$('pointCount').value=count;$('pointBadge').textContent=`${count} 个有效点`;$('pointHeaders').innerHTML='<th>点位</th>';
  for(let i=0;i<15;i++){const th=document.createElement('th');th.textContent=String(i+1).padStart(2,'0');if(i>=count)th.className='inactive';$('pointHeaders').append(th);}
  $('pointRows').replaceChildren();for(const row of[{key:'sca_values',name:'色值',edit:true},{key:'sca_been',name:'豆子原始数据'},{key:'sca_been',name:'豆子读取',capture:true},{key:'sca_powder',name:'粉原始数据'},{key:'sca_powder',name:'粉读取',capture:true}]){
    const tr=document.createElement('tr'),th=document.createElement('th');th.textContent=row.name;tr.append(th);
    for(let i=0;i<15;i++){const td=document.createElement('td');if(row.capture){const b=document.createElement('button');b.textContent=row.key==='sca_been'?'读豆':'读粉';b.dataset.capture=row.key;b.dataset.index=i;b.setAttribute('aria-label',`第${i+1}点${b.textContent}`);b.onclick=()=>run(()=>capturePoint(row.key,i));td.append(b);}
      else{const input=document.createElement('input');input.type='number';input.step='any';input.value=points[row.key][i]??'';input.dataset.index=i;input.readOnly=!row.edit;input.setAttribute('aria-label',`第${i+1}点${row.name}`);input.onchange=()=>{points[row.key][i]=input.value;savePoints();};td.append(input);}tr.append(td);
    }$('pointRows').append(tr);
  }controls();
}
async function capturePoint(key,index=0){
  if(capture)throw Error('请等待当前采集结束');if(busy)throw Error('升级期间不能采集');const session=current();
  capture={session,key,index};controls();
  $('captureStatus').textContent=key==='board'?'正在读取校准板…':`正在采集第 ${index+1} 点${key==='sca_been'?'豆子':'粉'}，请保持样品稳定…`;
  try{
    const result=await session.client.request(CMD.CAPTURE,new Uint8Array(),{timeout:45000});
    if(!Number.isFinite(result?.raw))throw Error('设备采集结果无效');
    if(key==='board'){
      if(!Number.isFinite(result.powder)||!Number.isFinite(result.been))throw Error('校准板色值无效，请检查设备参数');
      $('boardPowder').value=result.powder.toFixed(2);$('boardBeen').value=result.been.toFixed(2);
      $('boardResult').textContent=`粉色值 ${result.powder.toFixed(2)} · 豆色值 ${result.been.toFixed(2)} · 原始 ADC ${result.raw}`;
    }
    else{points[key][index]=String(result.raw);savePoints();renderPoints();}
    $('captureStatus').textContent=key==='board'?'校准板读取完成':`第 ${index+1} 点${key==='sca_been'?'豆子':'粉'}采集完成 · ADC ${result.raw}`;
    log(`SCA 采集应答：原始 ADC ${result.raw}`);return result;
  }finally{capture=null;controls();}
}
function number(id){const text=$(id).value;if(text.trim()===''||!Number.isFinite(Number(text)))throw Error('请填写有效数字');return Number(text);}
async function readInfo(){const s=current();s.info=await s.client.request(CMD.INFO);displayInfo(s.info);deviceList();return s.info;}
async function sendJSON(o){const s=current();log(`TX ${JSON.stringify(o)}`);const data=await s.client.request(CMD.JSON,encoder.encode(JSON.stringify(o)),{timeout:20000});s.info=data;displayInfo(data);deviceList();return data;}
function exportFile(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function run(fn){try{await fn();}catch(e){notice(e.message);}}
function telemetry(data,{cached=false}={}){const session=sessions.get(selected);if(session){if(!cached){session.live=data;session.updatedAt=Date.now();}const watch=cached?null:session.measurementWatch;if(watch){if(data.measurementBusy)watch.sawBusy=true;if(watch.sawBusy&&!data.measurementBusy){session.measurementText='设备测量已结束，下方结果已更新。';session.measurementWatch=null;}else if(Date.now()-watch.started>180000||(!watch.sawBusy&&Date.now()-watch.started>8000)){session.measurementText='未确认本次测量完成，请检查设备屏幕状态。';session.measurementWatch=null;}else session.measurementText=watch.sawBusy?'设备正在测量，请保持样品稳定；下方仍为上次返回值。':session.measurementText;}$('measurementStatus').textContent=session.measurementText??(data.measurementBusy?'设备正在测量或校准…':'下方为设备最近一次返回的测量结果。');}
  $('scaValue').textContent=Number.isFinite(data.sca)?data.sca.toFixed(2):'—';$('sensorState').textContent=data.link?'在线':'离线';$('lastUpdate').textContent=session?.updatedAt?`更新于 ${new Date(session.updatedAt).toLocaleTimeString('zh-CN',{hour12:false})}`:'尚未收到数据';showActiveProfiles(data);
  const draw=(id,fields,values=data)=>{$(id).replaceChildren();for(const[key,name,digits]of fields){const item=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=Number.isFinite(values[key])?values[key].toFixed(digits):'—';dd.title=String(values[key]??'');item.append(dt,dd);$(id).append(item);}};
  draw('environmentTelemetry',[['temperature','温度 °C',1],['humidity','湿度 %RH',1],['altitude','海拔 m',0]],environmentValues(data));
  if(Number.isFinite(data.initialAltitude)){if(session?.info){session.info.initialAltitude=data.initialAltitude;session.info.pressureReference=data.pressureReference;}showAltitudeReference(session,data);}
  $('environmentNote').textContent=session?.connected?(data.link?'与设备主屏幕使用相同换算；初始海拔可在“设备设置”中调整。':'采集板离线，环境读数暂不可用。'):'连接已断开，以下为最后收到的环境数据。';
  draw('telemetry',[['moisture','含水率 %',2],['density','密度 g/L',0],['aw','水活度',3],['sca','色度 SCA',2]]);
  draw('sensorRawTelemetry',[['weightADC','重量 ADC',0],['capacitance','电容原始值',6],['scaADC','SCA 原始 ADC',0],['pressure','气压 Pa',2],['temperatureRaw','温度原码',0],['humidityRaw','湿度原码',0],['battery','电池电压 mV',1]]);
  history=session?(session.history??=[]):[];if(!cached){history.push(Number(data.scaADC)||0);if(history.length>120)history.shift();}drawTrend();controls();
}
function drawTrend(){const c=$('trend'),ctx=c.getContext('2d');c.width=Math.max(c.clientWidth,300)*devicePixelRatio;c.height=170*devicePixelRatio;ctx.scale(devicePixelRatio,devicePixelRatio);const w=c.width/devicePixelRatio,h=170;ctx.strokeStyle='#e2eaf5';for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4);ctx.stroke();}if(history.length<2)return;const min=Math.min(...history),max=Math.max(...history),range=Math.max(max-min,1);ctx.strokeStyle='#3478d9';ctx.lineWidth=1.5;ctx.beginPath();history.forEach((v,i)=>{const x=i/(history.length-1)*w,y=h-17-(v-min)/range*(h-34);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
function updateProgress(p){$('upgradePhase').textContent=p.phase;$('upgradePercent').textContent=`${p.percent.toFixed(1)}%`;$('upgradeProgress').value=p.percent;if(p.speed!=null)$('upgradeStats').textContent=`${(p.offset/1024).toFixed(1)} / ${(p.total/1024).toFixed(1)} KiB · ${(p.speed/1024).toFixed(1)} KiB/s · 已用 ${p.seconds.toFixed(0)}s · 预计剩余 ${p.remaining.toFixed(0)}s`;}
async function startUpgrade(){if(!firmware||busy)return;const method=document.querySelector('[name=upgradeMethod]:checked').value,selectedSession=sessions.get(selected),s=method==='link'?current():selectedSession?.connected?selectedSession:null;
  if(method==='wifi'&&s?.link.kind==='sim')throw Error('WiFi 热点升级需要真实设备；模拟设备不创建热点');
  if(method==='wifi'&&(s?.live?.measurementBusy||s?.measurementWatch))throw Error('请等待测量或校准结束后再进入热点升级');
  if(s?.link.kind==='sim')log('模拟升级演练：不代表真实设备速度');busy=true;aborter=new AbortController();controls();deviceList();
  try{if(method==='wifi'){
    wifiDevice=null;updateProgress({phase:'等待连接设备热点',percent:0});
    if(s){
      wifiExpectedMac=s.info.mac;
      const data=await s.client.request(CMD.WIFI,new Uint8Array(),{timeout:10000});
      if(!data.rebooting)throw Error('当前固件不支持专用热点模式，请先安装 1.0.10 或更新配套固件');
      $('wifiUrl').value=data.url;
      $('wifiStatus').textContent='设备正在重启为升级热点；原串口 / 蓝牙连接断开，屏幕暂时不刷新均属正常。';log($('wifiStatus').textContent);
      await s.client.close();
    }
    wifiDevice=await waitForWifi($('wifiUrl').value,{signal:aborter.signal,expectedMac:wifiExpectedMac,onStatus:text=>{$('wifiStatus').textContent=text;}});
    await uploadWifi($('wifiUrl').value,firmware.bytes,{onProgress:updateProgress,signal:aborter.signal});wifiDevice=null;wifiExpectedMac=null;
    $('wifiStatus').textContent='设备已确认镜像校验通过，正在退出热点并重启回正常模式。';
  }else {
    await upgrade(s.client,firmware.bytes,{onProgress:p=>{if(s.link.kind==='sim'){$('upgradeStats').textContent='模拟设备演练，不代表真实串口、蓝牙或 Flash 速度。';updateProgress({...p,phase:'模拟 · '+p.phase,speed:undefined});}else updateProgress(p);},signal:aborter.signal,log});
    // The REBOOT ACK ends this connection; do not poll a device that is restarting.
    if(s.link.kind!=='sim') {s.connected=false;await s.client.close();}
  }
  notice(`${s?.link.kind==='sim'&&method==='link'?'模拟演练完成':'镜像校验通过，设备已确认重启'}。重连后请核对版本和 SN。`,true);}
  catch(e){$('upgradePhase').textContent='未确认升级成功';if(method==='wifi')$('wifiStatus').textContent=e.message;notice(`${e.message}。${method==='wifi'?'保留固件文件，连接热点后可重新上传。':'保留固件文件，可查询断点后重试。'}`);}finally{busy=false;aborter=null;controls();deviceList();}
}
document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tab').forEach(t=>t.hidden=t.id!==b.dataset.tab);document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n===b));$('pageTitle').textContent=b.querySelector('span').textContent;if(b.dataset.tab==='monitor')drawTrend();});
$('connectSerial').onclick=()=>connect('serial');$('connectBle').onclick=()=>connect('ble');$('disconnect').onclick=()=>run(async()=>{await current().client.close();controls();});
$('readParameters').onclick=()=>run(async()=>{await readInfo();notice('设备参数已回读',true);});$('readBoard').onclick=()=>run(()=>capturePoint('board'));
$('writeBoard').onclick=()=>run(async()=>{const powder=number('boardPowder'),been=number('boardBeen');const data=await sendJSON({calibrat_board:{powder,been}});if(Math.abs(data.boardPowder-powder)>1e-4||Math.abs(data.boardBeen-been)>1e-4)throw Error('校准板参数回读不一致');notice('校准板参数已写入并回读确认',true);});
$('writeLinear').onclick=()=>run(async()=>{const A=number('linearA'),B=number('linearB');const data=await sendJSON({linearFit:{A,B}});if(Math.abs(data.linearA-A)>Math.max(1e-6,Math.abs(A)*1e-6)||Math.abs(data.linearB-B)>Math.max(1e-6,Math.abs(B)*1e-6))throw Error('线性补偿回读不一致');notice('线性补偿参数已写入并回读确认',true);});
$('pointCount').onchange=()=>{const n=Number($('pointCount').value);if(!Number.isInteger(n)||n<2||n>15){notice('点数必须为 2–15');$('pointCount').value=points.sca_point_count;return;}points.sca_point_count=String(n);savePoints();renderPoints();};
$('importPoints').onchange=()=>run(async()=>{const file=$('importPoints').files[0];if(!file)return;const p=JSON.parse(await file.text());if(!Number.isInteger(Number(p.sca_point_count))||Number(p.sca_point_count)<2||Number(p.sca_point_count)>15)throw Error('SCAsave 点数无效');for(const k of['sca_values','sca_been','sca_powder']){if(!Array.isArray(p[k]))throw Error('SCAsave 缺少 '+k);p[k]=Array.from({length:15},(_,i)=>String(p[k][i]??''));}points=p;savePoints();renderPoints();notice(`已导入 ${file.name}，尚未下发设备`,true);});
$('exportPoints').onclick=()=>exportFile('SCAsave.txt',JSON.stringify(points,null,2));
$('sendPoints').onclick=()=>run(async()=>{const payload=validatePoints(points);const data=await sendJSON(payload),p=data.points,expected=payload.SCA_Piont;if(!p||p.count!==expected.SCA_Parameter_points)throw Error('点数回读不一致');for(const[key,source]of[['been','SCA_Been_Point'],['powder','SCA_Pink_Point'],['values','SCA_Y_Point']])for(let i=0;i<p.count;i++)if(Math.abs(p[key][i]-expected[source][i])>Math.max(1e-5,Math.abs(expected[source][i])*1e-6))throw Error(`第${i+1}点回读不一致`);notice(`${p.count} 点参数已下发，并回读核对通过`,true);});
$('readPoints').onclick=()=>run(async()=>{const info=await readInfo(),p=info.points;if(!p||p.count<2||p.count>15)throw Error('设备未保存 2–15 点参数');points={sca_point_count:String(p.count),sca_values:p.values.map(String),sca_been:p.been.map(String),sca_powder:p.powder.map(String)};savePoints();renderPoints();notice('已回读设备点位数据',true);});
$('openMdCalibration').onclick=()=>{$('mdCalibrationStatus').textContent='';$('mdCalibrationDialog').showModal();};
$('initialAltitude').oninput=()=>{const s=sessions.get(selected);if(s)s.altitudeDraft=$('initialAltitude').value;};
document.querySelectorAll('[data-altitude-step]').forEach(b=>b.onclick=()=>run(()=>{const s=current();$('initialAltitude').value=stepAltitude($('initialAltitude').value,Number(b.dataset.altitudeStep));s.altitudeDraft=$('initialAltitude').value;}));
$('zeroAltitude').onclick=()=>{const s=current();$('initialAltitude').value='0';s.altitudeDraft='0';};
$('writeAltitude').onclick=()=>run(async()=>{const s=current(),value=$('initialAltitude').value;capture={session:s,key:'environment'};controls();
  try{const info=await writeInitialAltitude(s.client,value);delete s.altitudeDraft;s.info=info;displayInfo(info);telemetry(await s.client.request(CMD.TELEMETRY));notice(`初始海拔 ${info.initialAltitude} m 已保存并回读确认`,true);}finally{capture=null;controls();}});
document.querySelectorAll('[data-native]').forEach(b=>b.onclick=()=>run(async()=>{if(b.dataset.toggle){const key=b.dataset.toggle,value=Number(b.dataset.value),session=current();capture={session,key:'setting'};controls();
  try{const result=await setNativeToggle(session.client,key,value);session.info=result.info;displayInfo(result.info);deviceList();notice(`${key==='buzzer'?'蜂鸣器':'语言'}${result.changed?'已切换并回读确认':'已是所选状态，无需重复设置'}`,true);}finally{capture=null;controls();}return;}
  const inMd=b.closest('#mdCalibrationDialog');if(inMd)$('mdCalibrationStatus').textContent='正在发送…';try{await current().client.request(CMD.NATIVE,nativeCommand(Number(b.dataset.native)));const message=`${b.textContent}：设备已接收，请查看设备状态`;log(message);if(inMd)$('mdCalibrationStatus').textContent=message;}catch(e){if(inMd)$('mdCalibrationStatus').textContent=e.message;throw e;}}));
document.querySelectorAll('[data-setting]').forEach(b=>b.onclick=()=>run(async()=>{const key=b.dataset.setting,value=number(key);await current().client.request(CMD.NATIVE,nativeCommand(Number(b.dataset.op),value));const info=await readInfo();if(info[key]!==value)throw Error('设置值与设备回读不一致，请重试');notice(`${key==='brightness'?'屏幕亮度':'息屏时间'}已设置并回读确认`,true);}));
document.querySelectorAll('[data-measure]').forEach(b=>b.onclick=()=>run(()=>beginMeasurement(Number(b.dataset.measure))));
document.querySelectorAll('[data-raw]').forEach(b=>b.onclick=()=>run(()=>collectRaw(b.dataset.raw)));
document.querySelectorAll('[data-stop-raw]').forEach(b=>b.onclick=()=>run(stopRaw));
document.querySelectorAll('[data-export-raw]').forEach(b=>b.onclick=()=>run(()=>exportRaw(b.dataset.exportRaw)));
document.querySelectorAll('[data-record-history]').forEach(b=>b.onclick=()=>run(()=>exportRaw(b.dataset.recordHistory,true)));
$('rawDiagnostics').ontoggle=drawTrend;
document.querySelectorAll('[data-legacy]').forEach(b=>b.onclick=()=>run(async()=>{const cmd=b.dataset.legacy+'\r\n';await current().client.request(CMD.LEGACY,encoder.encode(cmd));log(`TX ${cmd.trim()}`);}));
$('generateSN').onclick=()=>{$('snInput').value=generateSN();log('已按原 Qt 规则生成 SN，尚未写入设备');};
$('writeSN').onclick=()=>run(async()=>{if(!$('snInput').value.trim())$('snInput').value=generateSN();const sn=$('snInput').value.trim();if(encoder.encode(sn).length>19)throw Error('SN 必须是 1–19 字节');const info=await readInfo();if(info.sn!=='NULL')throw Error('设备已有 SN，不能覆盖');const data=await sendJSON({SN:sn});if(data.sn!==sn||data.mode!==2)throw Error('SN 或产品模式回读失败');notice('SN 写入并精确回读成功，设备已切换产品模式',true);});
$('firmware').onchange=()=>run(async()=>{firmware=null;controls();const file=$('firmware').files[0];if(!file)return;const bytes=new Uint8Array(await file.arrayBuffer()),meta=validateFirmware(bytes);firmware={bytes,meta,name:file.name};$('firmwareInfo').textContent=`${file.name} · ${(meta.size/1024).toFixed(1)} KiB · ${meta.project} ${meta.version} · CRC32 ${meta.crc.toString(16).padStart(8,'0')}`;controls();});
$('upgradeStart').onclick=()=>run(startUpgrade);$('upgradeCancel').onclick=()=>aborter?.abort();document.querySelectorAll('[name=upgradeMethod]').forEach(e=>e.onchange=controls);
$('startWifi').onclick=()=>run(startUpgrade);
$('wifiBack').onclick=()=>run(async()=>{
  if(busy)return;busy=true;aborter=new AbortController();controls();
  try{
    await waitForWifi($('wifiUrl').value,{expectedMac:wifiDevice?.mac??wifiExpectedMac,signal:aborter.signal,timeout:15000,onStatus:()=>{$('wifiStatus').textContent='正在等待电脑连接设备热点，确认后退出热点模式…';}});
    const response=await fetch(new URL('/back',$('wifiUrl').value),{method:'POST',signal:AbortSignal.any([aborter.signal,AbortSignal.timeout(5000)])});
    if(!response.ok||(await response.text()).trim()!=='OK-back-rebooting')throw Error('设备未确认退出热点，请稍后重试');
    wifiDevice=null;wifiExpectedMac=null;$('wifiStatus').textContent='设备正在重启回正常模式，请重新连接串口或蓝牙。';
  }catch(e){$('wifiStatus').textContent=`退出热点未确认：${e.message}`;throw e;}
  finally{busy=false;aborter=null;controls();}
});
$('abortSession').onclick=()=>run(async()=>{await current().client.request(CMD.CONTROL,Uint8Array.of(OP.ABORT));notice('未完成的升级会话已清除',true);});
$('sendCustom').onclick=()=>run(async()=>{const text=$('customCommand').value.trim();if(!text)throw Error('请输入命令');if(text.startsWith('{'))await sendJSON(JSON.parse(text));else await current().client.request(CMD.LEGACY,encoder.encode(text+'\r\n'),{timeout:20000});log(`TX ${text}`);});
$('customCommand').onkeydown=e=>{if(e.key==='Enter'&&!$('sendCustom').disabled)$('sendCustom').click();};$('clearLog').onclick=()=>{logs=[];$('log').textContent='';};$('exportLog').onclick=()=>exportFile('fusion-log.txt',logs.join('\n'),'text/plain');
async function poll(){const s=sessions.get(selected);if((!$('autoPoll').checked&&!s?.measurementWatch)||busy||capture||connecting)return;if(!s?.connected||s.polling)return;s.polling=true;try{const data=await s.client.request(CMD.TELEMETRY,new Uint8Array(),{timeout:3000});if(selected===s.id)telemetry(data);}catch(e){log(`监控：${e.message}`);}finally{s.polling=false;}}
setInterval(poll,1000);setInterval(()=>{$('clock').textContent=new Date().toLocaleString('zh-CN',{hour12:false});},1000);
try{const saved=localStorage.getItem(storageKey);if(saved)points=parsePointDraft(JSON.parse(saved));else if(isLocal){const res=await fetch('SCAsave.txt');if(res.ok)points=parsePointDraft(await res.json());}}catch(e){log(`未加载已有点位文件：${e.message}`);}renderPoints();log('Fusion 网页上位机 v1.0.0 已就绪。默认真实设备模式。');
if(!isSecureContext)notice('串口与蓝牙需要安全上下文。请使用 http://127.0.0.1:8770 或 HTTPS 打开页面。');

function renderLan(){
  $('lanDeviceList').replaceChildren();for(const d of lanDevices){const b=document.createElement('button');b.textContent=`连接 ${d.address}`;b.disabled=busy||!!capture||connecting;b.onclick=()=>{const existing=[...sessions.values()].find(s=>s.connected&&s.link.kind==='lan'&&s.link.id===d.id);if(existing){selected=existing.id;renderSession(existing);deviceList();}else connect('lan',d.id);};$('lanDeviceList').append(b);}
}
$('searchWifi').onclick=()=>run(async()=>{
  const data=await bridgeAction('start');lanDevices=data.devices;lanEvents?.close();lanEvents=new EventSource('/bridge/events');
  lanEvents.addEventListener('devices',e=>{lanDevices=JSON.parse(e.data);$('lanState').textContent=`正在搜索 · ${lanDevices.length} 台局域网设备`;renderLan();});
  lanEvents.addEventListener('bridgeError',e=>notice(JSON.parse(e.data).error));$('lanState').textContent='正在搜索，请保持设备与电脑在同一局域网';renderLan();controls();log('原版 UDP 12345 / TCP 1234 搜索已开启');
});
$('stopSearchWifi').onclick=()=>run(async()=>{await bridgeAction('stop');lanEvents?.close();lanEvents=null;lanDevices=[];renderLan();controls();$('lanState').textContent='搜索已关闭';});
