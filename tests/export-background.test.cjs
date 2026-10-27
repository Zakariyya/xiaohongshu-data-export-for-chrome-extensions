const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(locked = false, mode = 'login') {
  const state = {}, created = [], removed = [], downloads = [];
  let clock = Date.now(), siteUrl = 'https://creator.xiaohongshu.com/statistics/account/v2?source=official', nextDownload = 100;
  class Clock extends Date { static now() { return clock; } }
  const chrome = {
    storage: { local: { get: async k => typeof k === 'string' ? {[k]:state[k]} : Object.fromEntries(k.map(x => [x,state[x]])), set: async v => Object.assign(state,v), remove: async k => delete state[k] } },
    tabs: { create: async opts => { created.push(opts); return {id:42}; }, get: async () => ({status:'complete',url:siteUrl}), update: async (id, opts) => {siteUrl=opts.url;}, remove: async id => removed.push(id) },
    downloads: { download: async opts => { downloads.push(opts); return downloads.length; }, search: async opts => opts.id ? [{state:'complete',id:opts.id,fileSize:200}] : [] }
  };
  chrome.scripting = { executeScript: async opts => {
    if (opts.files) return [];
    const action = opts.args[0];
    let result = {ok:true};
    if (action === 'snapshot') result = mode === 'login' ? {excerpt:'扫码登录'} : {excerpt:'观看数据 笔记数据',hasDownload:true};
    if (action === 'accountTabState') result = {target:{found:true,selected:true}};
    if (action === 'chooseWidestDate') result = {ok:true,after:{range:['2026-04-27','2026-10-27']},method:'test'};
    if (action === 'download' && mode === 'success') {
      const pending = state.xhs_pending_download_v1;
      state.xhs_captures_v1[pending.token] = {id:nextDownload++,filename:pending.label+'.xlsx'};
    }
    return [{result}];
  }};
  chrome.storage.session = chrome.storage.local;
  const context = vm.createContext({ chrome, Date:Clock, URL, console, setTimeout: fn => { clock += 1000; fn(); }, navigator:{locks:{request:async (name, opts, fn) => fn(locked ? null : {})}} });
  try { vm.runInContext(fs.readFileSync('dashboard.js','utf8'), context); } catch (e) { assert.fail(`export engine must load without a DOM: ${e.message}`); }
  return {context, state, created, removed, downloads};
}
test('background export requires no dashboard, creates inactive site tab and cleans up after login failure', async () => {
  const {context, created, removed, downloads} = setup();
  const result = await context.XhsExporter.run(false);
  assert.equal(created.length, 1);
  assert.equal(created[0].active, false);
  assert.ok(created[0].url.startsWith('https://creator.xiaohongshu.com/'));
  assert.deepEqual(removed, [42]);
  assert.equal(result.success, 0);
  assert.ok(result.error);
  assert.ok(downloads.length >= 3);
  assert.ok(downloads.every(d => d.saveAs === false && d.url.startsWith('data:')));
});
test('busy export lock skips background export without opening pages or downloading', async () => {
  const {context, created, downloads} = setup(true);
  const result = await context.XhsExporter.run(false);
  assert.equal(result.skipped, true);
  assert.equal(created.length, 0);
  assert.equal(downloads.length, 0);
});

test('full background export completes all 9 tasks and closes only its temporary tab', async () => {
  const {context, created, removed, state, downloads} = setup(false, 'success');
  const result = await context.XhsExporter.run(false);
  assert.equal(result.success,9);
  assert.equal(result.expected,9);
  assert.equal(result.error,'');
  assert.equal(result.failure,0);
  assert.equal(created.length,1);
  assert.deepEqual(removed,[42]);
  assert.equal(Object.keys(state.xhs_captures_v1).length,9);
  assert.equal(downloads.length,3);
  assert.equal(state.xhs_auto_tab_v1, undefined);
});
test('missing downloads finish with failure instead of waiting for an invisible manual dialog', async () => {
  const {context, removed} = setup(false, 'no-download');
  const result = await context.XhsExporter.run(false);
  assert.equal(result.success,0);
  assert.equal(result.failure,9);
  assert.deepEqual(removed,[42]);
});
