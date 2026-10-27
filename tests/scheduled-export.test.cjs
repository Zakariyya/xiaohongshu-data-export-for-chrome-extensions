const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(previous) {
  const state = { xhs_auto_result_v1: previous, xhs_auto_tab_v1: previous ? 42 : undefined }, alarms = new Map(), removed = [];
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  let runs = 0, release;
  const chrome = {
    runtime: { id:'test', onInstalled:event(), onStartup:event(), onMessage:event() },
    storage: { local: { get:async k => ({[k]:state[k]}), set:async v => Object.assign(state,structuredClone(v)), remove:async k=>delete state[k] } },
    tabs: {get:async id=>({id,url:'https://creator.xiaohongshu.com/statistics/account/v2'}),remove:async id=>removed.push(id)},
    alarms: {onAlarm:event(),get:async n => alarms.get(n),create:async(n,v) => alarms.set(n,{name:n,scheduledTime:v.when}),clear:async n => alarms.delete(n)}
  };
  chrome.storage.session = chrome.storage.local;
  const context = vm.createContext({chrome, Date, console, XhsExporter:{run:async () => { runs++; return new Promise(resolve => {release = resolve;}); }}});
  for (const file of ['schedule.js','scheduled-export.js']) vm.runInContext(fs.readFileSync(file,'utf8'),context);
  return {state, alarms, chrome, context, removed, runs:()=>runs, finish:r=>release(r)};
}
test('alarm dispatch runs one full export and records completion; repeat delivery ignored', async () => {
  const s = setup(); await tick();
  await s.context.XhsSchedule.save({enabled:true,mode:'interval',hours:1}, Date.now()-7200000);
  const fire = () => s.chrome.alarms.onAlarm.listeners[0]({name:'xhs-full-export'});
  fire(); fire(); await tick();
  assert.equal(s.runs(),1);
  assert.equal(s.state.xhs_auto_result_v1.status,'running');
  s.finish({success:9,expected:9,at:new Date().toISOString()}); await tick();
  assert.equal(s.state.xhs_auto_result_v1.status,'success');
  assert.equal(s.alarms.size,1);
});
test('worker restart marks an interrupted export without retrying it', async () => {
  const s = setup({status:'running'}); await tick();
  assert.equal(s.state.xhs_auto_result_v1.status,'interrupted');
  assert.equal(s.runs(),0);
  assert.deepEqual(s.removed,[42]);
  assert.equal(s.state.xhs_auto_tab_v1,undefined);
});
test('save via message, repeat updates, disable, and unrelated messages', async () => {
  const s = setup(); await tick();
  const message = s.chrome.runtime.onMessage.listeners[0];
  const send = msg => new Promise(resolve => message(msg,{id:'test'},resolve));
  assert.equal((await send({type:'schedule:save',config:{enabled:true,mode:'daily',time:'09:00'}})).ok,true);
  for (let i=0;i<4;i++) { s.chrome.runtime.onInstalled.listeners[0](); await tick(); }
  assert.equal(s.alarms.size,1);
  assert.equal((await send({type:'schedule:save',config:{enabled:false}})).ok,true);
  assert.equal(s.alarms.size,0);
  assert.equal(message({type:'schedule:save'},{id:'other'},()=>assert.fail()),undefined);
});
