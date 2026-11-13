import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8'),source=app.slice(app.indexOf('async function startUpgrade(){'),app.indexOf('\ndocument.querySelectorAll',app.indexOf('async function startUpgrade(){')));
async function run(kind,fail=false){
 const events=[],elements=new Map(),session={connected:true,link:{kind},client:{async close(){events.push('close');}}};
 const context=vm.createContext({firmware:{bytes:new Uint8Array()},busy:false,capture:null,selected:1,sessions:new Map([[1,session]]),current:()=>session,
 document:{querySelector:()=>({value:'link'})},$:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},
 AbortController,log:()=>{},controls:()=>{},deviceList:()=>{},updateProgress:()=>{},notice:text=>events.push(text),
 upgrade:async()=>{assert.equal(session.connected,true);events.push('upgrade');if(fail)throw Error('test failure');},aborter:null});
 await vm.runInContext('('+source+')',context)();return{events,session,context};
}
test('confirmed physical reboot closes the connection before polling is reenabled',async()=>{const r=await run('ble');assert.equal(r.session.connected,false);assert.deepEqual(r.events.slice(0,2),['upgrade','close']);assert.equal(r.context.busy,false);});
test('an incomplete upgrade keeps its connection available for recovery',async()=>{const r=await run('serial',true);assert.equal(r.session.connected,true);assert.ok(!r.events.includes('close'));assert.ok(r.events.at(-1).includes('test failure'));});
test('simulation keeps its connection for further exercises',async()=>{const r=await run('sim');assert.equal(r.session.connected,true);assert.ok(!r.events.includes('close'));});
