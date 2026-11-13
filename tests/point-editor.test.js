import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';
const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');const render=app.slice(app.indexOf('function renderPoints(){'),app.indexOf('async function capturePoint('));
const handler=app.slice(app.indexOf("$('pointCount').onchange="),app.indexOf("$('importPoints').onchange="));
function setup(){
 const elements=new Map();function el(tag='div'){return{tag,children:[],dataset:{},value:'',set innerHTML(v){this.children=[];},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},setAttribute(k,v){this[k]=v;}};}
 const get=id=>{if(!elements.has(id))elements.set(id,el());return elements.get(id);};
 const c=vm.createContext({$:get,points:{sca_point_count:'9',sca_values:Array(15).fill('20'),sca_been:Array(15).fill('100'),sca_powder:Array(15).fill('200')},document:{createElement:el},controls:()=>{},saveCount:0,savePoints:()=>c.saveCount++,notice:text=>c.message=text,run:()=>{}});
 vm.runInContext(render+handler,c);c.renderPoints();return{c,get};
}
test('editing a color value persists it across the next capture table rebuild',()=>{const{c,get}=setup();let input=get('pointRows').children[0].children[1].children[0];input.value='42.25';input.onchange();c.renderPoints();assert.equal(c.points.sca_values[0],'42.25');assert.equal(get('pointRows').children[0].children[1].children[0].value,'42.25');assert.equal(c.saveCount,1);});
test('point count accepts the complete 2 through 15 range and rejects invalid commits',()=>{const{c,get}=setup();for(const n of [2,9,15]){get('pointCount').value=String(n);get('pointCount').onchange();assert.equal(c.points.sca_point_count,String(n));assert.equal(get('pointBadge').textContent,`${n} 个有效点`);}for(const n of ['1','16','2.5','abc']){get('pointCount').value=n;get('pointCount').onchange();assert.equal(c.points.sca_point_count,'15');assert.equal(get('pointCount').value,'15');}});
