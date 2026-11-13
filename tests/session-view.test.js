import test from'node:test';import assert from'node:assert/strict';import vm from'node:vm';import{readFileSync}from'node:fs';
import{environmentValues}from'../fusion_environment.js';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
const render=source.slice(source.indexOf('function renderSession('),source.indexOf('function deviceList('));
const telemetry=source.slice(source.indexOf('function telemetry('),source.indexOf('function drawTrend('));
function setup(){
 const elements=new Map(),sessions=new Map([[1,{connected:true,info:{name:'one'}}],[2,{connected:true,info:{name:'two'}}]]);
 const element=()=>({textContent:'',children:[],replaceChildren(...c){this.children=c;},append(...c){this.children.push(...c);}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
 const context=vm.createContext({sessions,selected:1,history:[],document:{createElement:element},$:get,displayInfo:()=>{},showActiveProfiles:()=>{},showAltitudeReference:()=>{},environmentValues,controls:()=>{},drawTrend:()=>{}});
 vm.runInContext(render+telemetry,context);return{context,sessions,get};
}
const sample=n=>({sca:n,scaADC:n,link:true,moisture:n,density:n,aw:n});
test('a newly selected device clears the previous telemetry before its first reply',()=>{const{context:c,get}=setup();c.telemetry(sample(11));assert.equal(get('scaValue').textContent,'11.00');c.selected=2;c.renderSession(c.sessions.get(2));assert.equal(get('scaValue').textContent,'—');assert.equal(get('sensorRawTelemetry').children.length,0);assert.equal(c.history.length,0);});
test('switching with polling disabled renders each device cache without mixing or appending trends',()=>{const{context:c,sessions:s,get}=setup();c.telemetry(sample(11));const when=get('lastUpdate').textContent;c.selected=2;c.telemetry(sample(22));c.selected=1;c.renderSession(s.get(1));assert.equal(get('scaValue').textContent,'11.00');assert.equal(get('lastUpdate').textContent,when);assert.deepEqual(Array.from(s.get(1).history),[11]);assert.deepEqual(Array.from(s.get(2).history),[22]);assert.equal(get('sensorRawTelemetry').children[2].children[1].textContent,'11');});
test('rendering a cached frame cannot advance an outstanding measurement state',()=>{const{context:c,sessions:s}=setup();c.telemetry(sample(11));s.get(1).measurementWatch={started:0,sawBusy:false};c.renderSession(s.get(1));assert.ok(s.get(1).measurementWatch);assert.equal(s.get(1).measurementWatch.sawBusy,false);});
test('a disconnected device cannot show its cached acquisition board as currently online',()=>{const{context:c,sessions:s,get}=setup();c.telemetry(sample(11));s.get(1).connected=false;c.renderSession(s.get(1));assert.equal(get('sensorState').textContent,'连接已断开');assert.equal(get('scaValue').textContent,'11.00');});
test('environment readings clear on a new device and never mix cached device values',()=>{const{context:c,sessions:s,get}=setup();c.telemetry({...sample(11),temperature:24.5,humidity:55,altitude:123});assert.equal(get('environmentTelemetry').children[2].children[1].textContent,'123');c.selected=2;c.renderSession(s.get(2));assert.equal(get('environmentTelemetry').children[2].children[1].textContent,'—');c.telemetry({...sample(22),temperature:30,humidity:40,altitude:-20});c.selected=1;c.renderSession(s.get(1));assert.equal(get('environmentTelemetry').children[2].children[1].textContent,'123');});
