'use strict';
(() => {
  const RESULT_KEY = 'xhs_auto_result_v1';
  let exporting = false;
  async function initialize() {
    // Session storage is cleared on browser restart, so tab IDs cannot refer to
    // unrelated tabs in a new browser session. Only clean up our own site tab.
    const tabId = (await chrome.storage.session.get('xhs_auto_tab_v1')).xhs_auto_tab_v1;
    if (Number.isInteger(tabId)) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.url?.startsWith('https://creator.xiaohongshu.com/')) await chrome.tabs.remove(tabId);
      } catch (_) { /* tab was already closed */ }
      await chrome.storage.session.remove('xhs_auto_tab_v1');
    }
    const saved = (await chrome.storage.local.get(RESULT_KEY))[RESULT_KEY];
    if (saved?.status === 'running') {
      await chrome.storage.local.set({ [RESULT_KEY]: { ...saved, status: 'interrupted', at: new Date().toISOString(), error: '浏览器或扩展重启，上次任务中断；已开启的倒计时模式将按设置的失败重试间隔重试。' } });
    }
    await XhsSchedule.restore(Date.now(), true);
  }
  const ready = initialize();
  ready.catch(error => console.error('恢复定时导出失败', error));

  async function start(ticket) {
    if (exporting) { await XhsSchedule.finish(ticket, false); return; }
    let success = false;
    exporting = true;
    try {
      await chrome.storage.local.set({ [RESULT_KEY]: { status: 'running', at: new Date().toISOString() } });
      const result = await XhsExporter.run(false);
      const status = result.skipped ? 'skipped' : (!result.error && result.success === result.expected ? 'success' : 'failed');
      success = status === 'success';
      await chrome.storage.local.set({ [RESULT_KEY]: { ...result, status } });
    } catch (error) {
      await chrome.storage.local.set({ [RESULT_KEY]: { status: 'failed', at: new Date().toISOString(), error: error.message || String(error) } });
    } finally { exporting = false; await XhsSchedule.finish(ticket, success); }
  }
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name !== XhsSchedule.ALARM) return;
    // Do not hold an onAlarm response open throughout the export.
    void ready.then(async () => {
      const ticket = await XhsSchedule.consume();
      if (ticket) await start(ticket);
    }).catch(error => console.error('定时导出失败', error));
  });
  for (const event of [chrome.runtime.onInstalled, chrome.runtime.onStartup]) {
    event.addListener(() => { void ready.then(() => XhsSchedule.restore()).catch(console.error); });
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['schedule:get', 'schedule:save'].includes(message?.type)) return;
    void ready.then(async () => {
      const config = message.type === 'schedule:save' ? await XhsSchedule.save(message.config) : await XhsSchedule.get();
      respond({ ok: true, config });
    }).catch(error => respond({ ok: false, error: error.message || String(error) }));
    return true;
  });
})();
