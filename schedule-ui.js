'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const format = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未开启';
  function fields() {
    const daily = $('scheduleMode').value === 'daily';
    $('scheduleHoursLabel').hidden = daily;
    $('scheduleHours').disabled = daily || !$('scheduleEnabled').checked;
    $('scheduleTimeLabel').hidden = !daily;
    $('scheduleTime').disabled = !daily || !$('scheduleEnabled').checked;
  }
  function next(config) { $('scheduleNext').textContent = `下次执行：${config.enabled ? format(config.nextAt) : '未开启'}`; }
  function last(result) {
    if (!result) return;
    const names = { running: '运行中', success: '全部完成', failed: '失败或部分完成', interrupted: '已中断', skipped: '已有导出运行，已跳过' };
    $('scheduleLast').textContent = `上次自动导出：${format(result.at)} · ${names[result.status] || result.status}` +
      (result.expected ? ` · 成功 ${result.success}/${result.expected} 项` : '') +
      (result.folder ? ` · ${result.folder}` : '') + (result.error ? ` · ${result.error}` : '');
  }
  $('scheduleMode').addEventListener('change', fields);
  $('scheduleEnabled').addEventListener('change', fields);
  $('scheduleForm').addEventListener('submit', async event => {
    event.preventDefault();
    $('scheduleSave').disabled = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'schedule:save', config: {
        enabled: $('scheduleEnabled').checked, mode: $('scheduleMode').value,
        hours: Number($('scheduleHours').value), time: $('scheduleTime').value
      } });
      if (!response?.ok) throw new Error(response?.error || '后台未响应');
      next(response.config);
      $('scheduleMessage').textContent = response.config.enabled ? '已保存；关闭助手页面后仍会自动执行。' : '已关闭定时导出；正在执行的任务不受影响。';
    } catch (error) { $('scheduleMessage').textContent = `保存失败：${error.message}`; }
    finally { $('scheduleSave').disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.xhs_schedule_v1) next(changes.xhs_schedule_v1.newValue || {});
    if (changes.xhs_auto_result_v1) last(changes.xhs_auto_result_v1.newValue);
  });
  fields();
  void (async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'schedule:get' });
      if (!response?.ok) throw new Error(response?.error || '后台未响应');
      const config = response.config;
      $('scheduleEnabled').checked = config.enabled;
      $('scheduleMode').value = config.mode;
      $('scheduleHours').value = config.hours || 24;
      $('scheduleTime').value = config.time || '09:00';
      fields(); next(config);
      last((await chrome.storage.local.get('xhs_auto_result_v1')).xhs_auto_result_v1);
      $('scheduleMessage').textContent = config.enabled ? '后台定时导出已开启。' : '定时导出默认关闭，保存后生效。';
    } catch (error) { $('scheduleMessage').textContent = `读取失败：${error.message}，请重新加载扩展。`; }
  })();
})();
