const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup() {
  let listener;
  const chrome = {
    runtime: { id: 'our-extension' },
    action: { onClicked: { addListener() {} } },
    downloads: {
      onCreated: { addListener() {} },
      onDeterminingFilename: { addListener(fn) { listener = fn; } }
    },
    storage: { local: { get: async () => ({}) } }
  };
  vm.runInNewContext(fs.readFileSync('background.js', 'utf8'), { chrome, importScripts() {}, URL, console });
  return item => new Promise(resolve => listener(item, resolve));
}

test('own report download explicitly keeps its session folder and Chinese filename', async () => {
  const determine = setup();
  for (const name of ['导出结果清单.json', '导出记录.txt', '执行日志.txt', '诊断_观看数据.json']) {
    const filename = `小红书数据导出/2026-10-29_09-00-00-000/${name}`;
    const suggestion = await determine({ byExtensionId: 'our-extension', filename: '下载.txt',
      url: `data:text/plain;charset=utf-8;xhs-filename=${encodeURIComponent(filename)},hello` });
    assert.equal(suggestion?.filename, filename);
    assert.equal(suggestion?.conflictAction, 'uniquify');
  }
});

test('unrelated downloads and invalid report metadata are not renamed', async () => {
  const determine = setup();
  for (const item of [
    { byExtensionId: 'other', url: 'data:text/plain;xhs-filename=hello,body' },
    { byExtensionId: 'our-extension', url: 'data:text/plain,body' },
    { byExtensionId: 'our-extension', url: 'data:text/plain;xhs-filename=%ZZ,body' },
    { byExtensionId: 'our-extension', url: `data:text/plain;xhs-filename=${encodeURIComponent('小红书数据导出/../bad.txt')},body` }
  ]) assert.equal(await determine(item), undefined);
});
