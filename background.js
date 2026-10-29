'use strict';
importScripts('schedule.js', 'dashboard.js', 'scheduled-export.js');
// Chrome MV3: Observe downloads and route only files triggered by the current export task.
// No cookies, private API calls or network interception.
const PREFIX = '小红书数据导出';
const PENDING_KEY = 'xhs_pending_download_v1';
const CAPTURES_KEY = 'xhs_captures_v1';
const OBS_KEY = 'xhs_download_observations_v12';

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

const safePart = s => String(s || '').replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 100) || '未命名';
const fileName = value => String(value || '').replaceAll('\\', '/').split('/').pop().split('?')[0] || '';
const sourceHost = value => {
  try { return new URL(String(value || '')).hostname || ''; } catch { return ''; }
};
function getExt(item) {
  for (const value of [item.filename, item.finalUrl, item.url]) {
    const m = String(value || '').match(/\.(xlsx|xls|csv|zip)(?:$|[?#])/i);
    if (m) return '.' + m[1].toLowerCase();
  }
  const mime = String(item.mime || '').toLowerCase();
  if (mime.includes('csv')) return '.csv';
  if (mime.includes('zip')) return '.zip';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return '.xlsx';
  return '.xlsx';
}
function reportFilename(item) {
  const metadata = String(item.url || '').split(',', 1)[0];
  const match = metadata.match(/^data:[^,]*;xhs-filename=([^;,]+)$/);
  if (!match) return null;
  try {
    const filename = decodeURIComponent(match[1]);
    const parts = filename.split('/');
    if (parts.length !== 3 || parts[0] !== PREFIX ||
        parts.some(part => !part || part === '.' || part === '..' || /[\\:*?"<>|\x00-\x1f]/.test(part))) return null;
    return filename;
  } catch { return null; }
}
async function observe(item, stage, outcome) {
  // URL query strings, cookies and signed CDN URLs are deliberately not logged.
  try {
    const data = await chrome.storage.local.get([PENDING_KEY, OBS_KEY]);
    const pending = data[PENDING_KEY];
    if (!pending || pending.expires < Date.now() || pending.armedAt > Date.now() + 2000) return;
    const events = data[OBS_KEY] || [];
    events.push({ token: pending.token, at: Date.now(), stage, outcome,
      id: item.id, baseName: fileName(item.filename), mime: String(item.mime || '').slice(0, 90),
      sourceHost: sourceHost(item.url) || sourceHost(item.finalUrl) || sourceHost(item.referrer) ||
        (String(item.url || '').startsWith('blob:https://creator.xiaohongshu.com/') ? 'creator.xiaohongshu.com(blob)' : ''),
      state: item.state || '' });
    await chrome.storage.local.set({ [OBS_KEY]: events.slice(-60) });
  } catch (e) { console.warn('下载观测记录失败', e); }
}

chrome.downloads.onCreated.addListener(item => {
  if (item.byExtensionId === chrome.runtime.id) return;
  void observe(item, 'onCreated', '下载任务已在 Chrome 创建');
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  (async () => {
    try {
      if (item.byExtensionId === chrome.runtime.id) {
        const filename = reportFilename(item);
        suggest(filename ? { filename, conflictAction: 'uniquify' } : undefined);
        return;
      }
      const data = await chrome.storage.local.get([PENDING_KEY, CAPTURES_KEY]);
      const task = data[PENDING_KEY];
      const now = Date.now();
      if (!task || !task.token || !task.folder || !task.label || task.expires < now) { suggest(); return; }
      const captures = data[CAPTURES_KEY] || {};
      if (captures[task.token]) { void observe(item, 'onDeterminingFilename', '当前任务已有一个文件'); suggest(); return; }
      const rawUrl = [item.url, item.finalUrl, item.referrer].join(' ');
      const fromXhs = /(?:^|[^a-z])(?:creator\.)?xiaohongshu\.com|xhscdn\.(?:com|net)|xhslink\.com/i.test(rawUrl);
      const ext = /\.(xlsx|xls|csv|zip)(?:$|[?#])/i.test([item.filename, item.finalUrl, item.url].join(' '));
      const mime = /spreadsheet|excel|text\/csv|application\/(?:zip|octet-stream)/i.test(item.mime || '');
      const plausible = ext || mime;
      // Guard against unrelated browser downloads while the user's Chrome is open.
      const fresh = now - task.armedAt <= 18000 || (task.manual && now - task.manualStartedAt <= 120000);
      if (!plausible || (!fromXhs && !fresh)) {
        void observe(item, 'onDeterminingFilename', !plausible ? '文件格式不匹配，未接管' : '来源和时间不匹配，未接管');
        suggest(); return;
      }
      const target = `${PREFIX}/${safePart(task.folder)}/${safePart(task.label)}${getExt(item)}`;
      captures[task.token] = { id: item.id, filename: target, at: now,
        sourceFilename: fileName(item.filename), sourceHost: sourceHost(item.url) || sourceHost(item.referrer) };
      await chrome.storage.local.set({ [CAPTURES_KEY]: captures });
      void observe(item, 'onDeterminingFilename', '已归档到当次文件夹');
      suggest({ filename: target, conflictAction: 'uniquify' });
    } catch (error) {
      console.warn('小红书导出文件归档失败', error);
      suggest();
    }
  })();
  return true;
});
