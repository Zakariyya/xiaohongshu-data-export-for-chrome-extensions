'use strict';

const URL_ACCOUNT = 'https://creator.xiaohongshu.com/statistics/account/v2?source=official';
const URL_CONTENT = 'https://creator.xiaohongshu.com/statistics/data-analysis?source=official';
const PREFIX = '小红书数据导出';
const PENDING_KEY = 'xhs_pending_download_v1';
const CAPTURES_KEY = 'xhs_captures_v1';
const OBS_KEY = 'xhs_download_observations_v12';
const TASKS = [
  { key: 'views', name: '观看数据', icon: '👁', desc: '近7日、近30日' },
  { key: 'interactions', name: '互动数据', icon: '♡', desc: '近7日、近30日' },
  { key: 'followers', name: '涨粉数据', icon: '↗', desc: '近7日、近30日' },
  { key: 'posts', name: '发布数据', icon: '▤', desc: '近7日、近30日' },
  { key: 'notes', name: '内容分析 · 笔记列表明细', icon: '▦', desc: '自动选择近半年 · 最多导出前1000条' }
];
const $ = id => document.getElementById(id);
let running = false;
let canceled = false;
let session = null;
let sessionTab = null;
let manualResolver = null;
let manualPromise = null;
let downloadProblemResolver = null;
let recentDownloadDiagnostic = null;
let latestFinishedDownloadId = null;
let logs = [];
let results = [];

function nowStr() { return new Date().toLocaleTimeString('zh-CN', { hour12: false }); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function checkCancel() { if (canceled) throw new Error('用户已停止任务'); }
function safeText(s) { return String(s || '').replace(/[\\/:*?"<>|\r\n\x00-\x1f]/g, '_').slice(0, 110); }
function makeSession() {
  const d = new Date();
  const y = d.getFullYear();
  const z = num => String(num).padStart(2, '0');
  const name = `${y}-${z(d.getMonth()+1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3,'0')}`;
  return { startedAt: new Date().toISOString(), folder: name, fileBase: `${PREFIX}/${name}`, records: [] };
}
function log(message, type = '') {
  const line = `[${nowStr()}] ${message}`;
  logs.push({ line, type });
  const el = document.createElement('div');
  el.className = `log-line ${type}`.trim();
  el.textContent = line;
  $('logArea').appendChild(el);
  $('logArea').scrollTop = $('logArea').scrollHeight;
}
function setStatus(label, kind = '') {
  const e = $('statusBadge'); e.textContent = label;
  e.className = ('status ' + kind).trim();
}
function renderTasks() {
  $('taskList').textContent = '';
  for (const task of TASKS) {
    const el = document.createElement('div');
    el.className = 'task';
    el.dataset.key = task.key;
    const icon = document.createElement('span'); icon.className = 'task-icon'; icon.textContent = task.icon;
    const info = document.createElement('div'); info.className = 'task-info';
    const title = document.createElement('div'); title.className = 'task-label'; title.textContent = task.name;
    const sub = document.createElement('div'); sub.className = 'task-sub'; sub.textContent = task.desc;
    const state = document.createElement('div'); state.className = 'task-state'; state.textContent = '等待中';
    info.append(title, sub); el.append(icon, info, state); $('taskList').appendChild(el);
  }
}
function taskState(key, text, style = '') {
  const el = document.querySelector(`.task[data-key="${key}"] .task-state`);
  if (el) { el.textContent = text; el.className = ('task-state ' + style).trim(); }
}
function setProgress(done, total, label = '正在导出') {
  $('progressBox').hidden = false;
  $('progressTitle').textContent = label;
  $('progressCount').textContent = `${done} / ${total}`;
  $('progressBar').style.width = `${Math.round(100 * done / total)}%`;
}
async function page(action, arg) {
  checkCancel();
  if (!sessionTab) throw new Error('未找到可用的小红书标签页');
  const target = { tabId: sessionTab };
  await chrome.scripting.executeScript({ target, files: ['page-actions.js'] });
  const [result] = await chrome.scripting.executeScript({
    target,
    func: (name, value) => {
      const fn = globalThis.__xhsPageActions && globalThis.__xhsPageActions[name];
      if (typeof fn !== 'function') return { ok: false, reason: '页面动作未加载' };
      try { return fn(value); } catch (e) { return { ok: false, reason: String(e) }; }
    },
    args: [action, arg ?? null]
  });
  return result?.result;
}
async function findOrCreateTab() {
  const all = await chrome.tabs.query({ url: 'https://creator.xiaohongshu.com/*' });
  const current = all.find(t => t.active && t.windowId) || all.find(t => t.url?.includes('/statistics/')) || all[0];
  if (current) return current.id;
  const tab = await chrome.tabs.create({ url: URL_ACCOUNT, active: true });
  return tab.id;
}
async function navigate(url, anchor) {
  checkCancel();
  const tab = await chrome.tabs.get(sessionTab);
  if (!tab.url?.includes(new URL(url).pathname)) {
    await chrome.tabs.update(sessionTab, { url });
  }
  const begin = Date.now();
  while (Date.now() - begin < 45000) {
    checkCancel();
    try {
      const tabNow = await chrome.tabs.get(sessionTab);
      if (tabNow.status === 'complete' && new URL(tabNow.url).pathname === new URL(url).pathname) {
        const snap = await page('snapshot');
        if (snap?.excerpt?.includes(anchor) || snap?.firstButtons?.some(x => x.includes(anchor))) return snap;
        if (snap?.excerpt?.includes('扫码登录') || snap?.excerpt?.includes('验证码登录')) {
          log('检测到登录页，请在原 Chrome 标签页登录。', 'dim');
        }
      }
    } catch (_err) { /* page still navigating */ }
    await sleep(750);
  }
  throw new Error(`45 秒内页面未出现「${anchor}」，请确认账号登录状态和页面加载情况`);
}
async function choosePeriod(p) {
  const res = await page('choosePeriod', p);
  if (!res?.ok) throw new Error(res?.reason || `时间范围 ${p} 切换失败`);
  log(`选择时间范围「${p}」：已点击 ${res.selected}，正在等待数据更新。`, 'dim');
  await sleep(950);
  const snap = await page('snapshot');
  if (!snap?.hasDownload) throw new Error('时间切换后没有检测到导出按钮');
  return res;
}
async function chooseAccountTab(name) {
  const result = await page('selectAccountTab', name);
  if (!result?.ok) throw new Error(result?.reason || `无法切换栏目 ${name}`);
  log(`切换账号栏目：「${name}」已点击（${result.after?.target?.evidence || '状态待确认'}）。`, 'dim');
  await sleep(850);
  const state = await page('accountTabState', name);
  if (!state?.target?.found) throw new Error(`切换后没有找到「${name}」栏目`);
  if (!state.target.selected) {
    log(`提醒：「${name}」已点击，但网页未提供可识别的选中标志，将继续检查下载按钮。`, 'dim');
  }
  const snap = await page('snapshot');
  if (!snap?.hasDownload) throw new Error(`「${name}」栏目切换后没有找到导出按钮`);
  return state;
}
function newRecord(kind, period) {
  return { kind, period, status: '失败', filename: '', bytes: 0, reason: '', startedAt: new Date().toISOString() };
}
async function clearPending() { await chrome.storage.local.remove(PENDING_KEY); }
async function getDownloadEvidence(token, armedAt) {
  const saved = await chrome.storage.local.get([CAPTURES_KEY, OBS_KEY]);
  const hit = (saved[CAPTURES_KEY] || {})[token] || null;
  const events = (saved[OBS_KEY] || []).filter(e => e.token === token);
  // Observe the browser's real download list independently of filename routing.
  const recent = await chrome.downloads.search({ limit: 50, orderBy: ['-startTime'] });
  const started = recent.filter(item =>
    (!item.byExtensionId || item.byExtensionId !== chrome.runtime.id) &&
    Date.parse(item.startTime || '') >= armedAt - 1500 &&
    (/(?:xiaohongshu\.com|xhscdn\.(?:com|net))/i.test(`${item.url || ''} ${item.finalUrl || ''} ${item.referrer || ''}`) ||
     /\.(?:xlsx|xls|csv|zip)(?:$|[?#])/i.test(item.filename || '') ||
     /excel|spreadsheet|csv/i.test(item.mime || '')));
  return { hit, events, started: started.map(item => ({
    id: item.id, state: item.state, filename: item.filename,
    mime: item.mime, fileSize: item.fileSize, error: item.error || '',
    // Do not save full URLs, which may contain signed credentials.
    source: (() => { try { return new URL(item.url).hostname; } catch { return ''; } })()
  })) };
}
async function waitForDownload(token, armedAt, timeoutMs = 15000) {
  const begin = Date.now();
  let lastReported = 0;
  let confirmChecked = false;
  let unassignedSeenAt = 0;
  while (Date.now() - begin < timeoutMs) {
    checkCancel();
    const evidence = await getDownloadEvidence(token, armedAt);
    recentDownloadDiagnostic = evidence;
    if (evidence.hit?.id !== undefined) {
      const arr = await chrome.downloads.search({ id: evidence.hit.id });
      const item = arr[0];
      if (item?.state === 'complete') {
        if (item.fileSize === 0 && item.receivedBytes === 0) throw new Error('导出文件为空');
        latestFinishedDownloadId = item.id;
        return { id: item.id, filename: evidence.hit.filename, actualPath: item.filename,
          bytes: item.fileSize || item.receivedBytes || 0 };
      }
      if (item?.state === 'interrupted') throw new Error(`浏览器下载中断：${item.error || '未知原因'}`);
    }
    const other = evidence.started.filter(x => x.id !== evidence.hit?.id);
    if (other.length) {
      if (!unassignedSeenAt) unassignedSeenAt = Date.now();
      if (Date.now() - unassignedSeenAt > 3500) {
        const first = other[0];
        const err = new Error(`Chrome 已创建下载任务 ID ${first.id}（${first.state}），但扩展未将其归档。请查看 Chrome 下载记录，避免再次点击造成重复文件。`);
        err.code = 'DOWNLOAD_UNROUTED'; throw err;
      }
    }
    const elapsed = Date.now() - begin;
    if (!confirmChecked && elapsed > 1800) {
      confirmChecked = true;
      try {
        const popup = await page('confirmExport');
        if (popup?.ok) log(`已确认网页弹出的「${popup.name}」对话框。`, 'dim');
      } catch (_err) { /* 页面可能正在导航 */ }
    }
    if (elapsed > 5000 && lastReported < 1) {
      lastReported = 1;
      log(`已经等待 5 秒：Chrome 新下载 ${evidence.started.length} 项，文件归档事件 ${evidence.events.length} 条。`, 'dim');
    }
    if (elapsed > 10000 && lastReported < 2) {
      lastReported = 2;
      log(`等待 10 秒：${evidence.started.length ? '检测到下载但尚未归档' : 'Chrome 没有创建新的下载任务'}。`, 'dim');
    }
    await sleep(600);
  }
  const evidence = recentDownloadDiagnostic || {};
  const err = new Error(evidence.started?.length
    ? 'Chrome 已创建下载任务，但扩展未识别或归档，请核对下载列表。'
    : '15 秒内 Chrome 没有创建下载任务。网页可能未响应程序点击，也可能被浏览器阻止；建议尝试在原网页手动点击。');
  err.code = evidence.started?.length ? 'DOWNLOAD_UNROUTED' : 'DOWNLOAD_NOT_STARTED';
  throw err;
}

async function takeSnapshot(label) {
  try {
    const snap = await page('snapshot');
    const detail = { label, collectedAt: new Date().toISOString(), snapshot: snap, downloadDiagnostic: recentDownloadDiagnostic };
    return await downloadReport(`诊断_${safeText(label)}.json`, JSON.stringify(detail, null, 2), 'application/json');
  } catch (err) { log(`诊断文件未保存：${err.message}`, 'error'); return null; }
}
function downloadProblemDialog(reason, name) {
  $('downloadProblemTitle').textContent = `「${name}」未触发下载`;
  $('downloadProblemReason').textContent = reason;
  $('downloadProblemOverlay').hidden = false;
  return new Promise(resolve => { downloadProblemResolver = resolve; });
}
function closeDownloadProblem(choice) {
  if (!downloadProblemResolver) return;
  $('downloadProblemOverlay').hidden = true;
  const resolve = downloadProblemResolver;
  downloadProblemResolver = null;
  resolve(choice);
}
async function exportOne(kind, period, key) {
  const name = `${kind}_${period}`;
  const record = newRecord(kind, period);
  const accountTask = key !== 'notes';
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      checkCancel();
      if (attempt > 1 && accountTask) {
        log(`重新准备「${name}」：重新校验选项卡和时间范围。`, 'dim');
        await chooseAccountTab(kind);
        await choosePeriod(period);
      }
      const token = `${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
      const armedAt = Date.now();
      await chrome.storage.local.set({
        [PENDING_KEY]: { token, label: name, folder: session.folder,
          armedAt, expires: armedAt + 5 * 60 * 1000 }
      });
      recentDownloadDiagnostic = null;
      try {
        log(`自动尝试：${name}（第 ${attempt}/2 次）`);
        const clicked = await page('download');
        if (!clicked?.ok) throw new Error(clicked?.reason || '未能定位导出控件');
        log(`已向页面发送点击：根节点 ${clicked.rootTag}，实际目标 ${clicked.targetTag}。正在检查 Chrome 下载记录。`, 'dim');
        let downloaded;
        try {
          downloaded = await waitForDownload(token, armedAt, 15000);
        } catch (err) {
          if (err.code !== 'DOWNLOAD_NOT_STARTED') throw err;
          const diagnostic = recentDownloadDiagnostic || {};
          log(`导出未启动：${name}，Chrome 下载任务 ${diagnostic.started?.length || 0} 项，归档观测 ${diagnostic.events?.length || 0} 条。`, 'error');
          await takeSnapshot(name);
          const choice = await downloadProblemDialog(err.message, name);
          if (choice === 'stop') { canceled = true; checkCancel(); }
          if (choice === 'retry' && attempt === 1) continue;
          if (choice === 'manual') {
            log('人工接力：等待你在原小红书网页点击「导出数据」，再由扩展检查并归档。', 'dim');
            downloaded = await waitForDownload(token, armedAt, 30000);
          } else {
            record.reason = choice === 'skip' ? `${err.message}；用户选择跳过` : err.message;
            break;
          }
        }
        record.status = '成功';
        record.filename = downloaded.filename;
        record.bytes = downloaded.bytes;
        record.downloadId = downloaded.id;
        log(`导出成功：${downloaded.filename}（${downloaded.bytes || '未知'} 字节）`, 'success');
        break;
      } catch (err) {
        if (canceled) throw err;
        record.reason = err.message || String(err);
        log(`导出失败：${name}；${record.reason}`, 'error');
        await takeSnapshot(name);
        break;
      } finally {
        await clearPending();
      }
    }
  } catch (err) {
    record.reason = err.message || String(err);
    log(`终止或跳过：${name}；${record.reason}`, 'error');
  } finally {
    record.finishedAt = new Date().toISOString();
    results.push(record);
    await clearPending();
  }
  return record;
}

async function downloadReport(name, content, type = 'text/plain;charset=utf-8') {
  if (!session) return null;
  const blob = new Blob([content], { type });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({
      url: blobUrl, filename: `${session.fileBase}/${name}`,
      conflictAction: 'uniquify', saveAs: false
    });
    if (id === undefined) throw new Error('浏览器拒绝保存文件');
    // A Blob must remain alive until the browser completes the transfer.
    for (let i = 0; i < 30; i++) {
      const items = await chrome.downloads.search({ id });
      if (items[0]?.state === 'complete') { latestFinishedDownloadId = id; return id; }
      if (items[0]?.state === 'interrupted') throw new Error(`保存中断: ${items[0].error}`);
      await sleep(250);
    }
    return id;
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 12000);
  }
}
function manualDialog(reason) {
  $('manualReason').textContent = reason;
  $('manualDetail').textContent = '';
  $('manualOverlay').hidden = false;
  return new Promise(resolve => { manualResolver = resolve; manualPromise = true; });
}
function closeManual(choice) {
  if (!manualResolver) return;
  $('manualOverlay').hidden = true;
  const resolve = manualResolver;
  manualResolver = null;
  manualPromise = null;
  resolve(choice);
}
async function requireWideDates() {
  log('正在自动设置笔记明细的最大日期范围，无需人工选择。', 'dim');
  const result = await page('chooseWidestDate');
  for (const step of result?.attempts || []) log(`日期选择：${step}`, 'dim');
  if (!result?.ok) {
    await takeSnapshot('笔记最大日期范围_自动选择失败');
    const actual = result?.after?.range?.join(' 至 ') || '无法读取';
    const target = [result?.desired?.from,result?.desired?.to].join(' 至 ');
    throw new Error(`无法确认最大日期范围。目标约 ${target}，实际 ${actual}。${result?.reason || '日期控件未适配'}。不会下载近30日数据冒充最大范围。`);
  }
  const after = result.after;
  log(`日期范围自动完成：${after.range.join(' 至 ')}，使用方式：${result.method}。`);
  return { ...after, mode: result.method, confirmedMax: true, desired: result.desired };
}

async function run(notesOnly = false) {
  if (running) return;
  const totalTasks = notesOnly ? 1 : 9;
  running = true; canceled = false; session = makeSession(); results = [];
  $('startBtn').disabled = true; $('notesOnlyBtn').disabled = true; $('stopBtn').disabled = false;
  $('folderName').textContent = session.fileBase;
  renderTasks(); setStatus('运行中', 'running'); setProgress(0, totalTasks);
  if (notesOnly) log('本轮模式：仅导出笔记列表明细（不重复下载前 8 个账号数据文件）。', 'dim');
  log(`创建新会话：${session.fileBase}`);
  let completed = 0;
  let thrown = null;
  let contentDates = null;
  try {
    await clearPending();
    await chrome.storage.local.set({ [CAPTURES_KEY]: {}, [OBS_KEY]: [] });
    sessionTab = await findOrCreateTab();
    log(`使用现有 Chrome 标签页 ID ${sessionTab}；不会创建独立用户配置。`);
    if (!notesOnly) {
    await navigate(URL_ACCOUNT, '观看数据');
    if (!(await page('snapshot'))?.hasDownload) throw new Error('账号概览未出现导出数据按钮；请确认已登录。');
    for (const spec of TASKS.slice(0, 4)) {
      checkCancel();
      taskState(spec.key, '进行中', 'active');
      let ok = 0;
      for (const period of ['近7日', '近30日']) {
        checkCancel();
        try {
          await chooseAccountTab(spec.name);
          await choosePeriod(period);
          const res = await exportOne(spec.name, period, spec.key);
          if (res.status === '成功') ok++;
        } catch (err) {
          const r = newRecord(spec.name, period);
          r.reason = err.message || String(err); r.finishedAt = new Date().toISOString();
          results.push(r); log(`跳过 ${spec.name} ${period}：${r.reason}`, 'error');
          if (!canceled) await takeSnapshot(`${spec.name}_${period}`);
        }
        completed++; setProgress(completed, totalTasks, `账号概览：${spec.name}`);
        await sleep(550);
      }
      taskState(spec.key, ok === 2 ? '2 / 2 成功' : `${ok} / 2 成功`, ok === 2 ? 'ok' : 'bad');
    }
    } // end of optional 8-item account export
    checkCancel();
    taskState('notes', '进行中', 'active');
    await navigate(URL_CONTENT, '笔记数据');
    const types = await page('setNotesAll');
    log(types?.reason || '笔记类型已检查。', 'dim');
    try {
      contentDates = await requireWideDates();
    } catch (err) {
      const r = newRecord('内容分析_笔记列表明细', '最大日期范围');
      r.reason = err.message || String(err);
      r.finishedAt = new Date().toISOString();
      results.push(r);
      taskState('notes', '日期设置失败', 'bad');
      throw err;
    }
    const rangeName = (contentDates.range?.length === 2) ? contentDates.range.join('_至_') : '当前网页范围';
    const isWidest = contentDates.confirmedMax === true;
    const coverageFlag = isWidest ? '平台最大可选范围' : '仅当前范围_非全量';
    if (!isWidest) log(`注意：笔记明细仅覆盖 ${contentDates.days ?? '未知'} 天，不是近半年！下载文件将标注「仅当前范围_非全量」。`, 'error');
    else log('已确认筛选范围约半年；仅代表平台允许的范围，不代表账号全历史。', 'dim');
    log(`笔记列表明细范围：${rangeName}；${contentDates.mode || ''}`);
    const contentResult = await exportOne('内容分析_笔记列表明细', safeText(`${coverageFlag}_${rangeName}`), 'notes');
    contentResult.dateRange = contentDates;
    contentResult.coverage = isWidest ? '平台最大可选日期范围（非账号全历史承诺）' : '范围不足：仅所选日期';
    completed++; setProgress(completed, totalTasks, '内容分析：笔记列表明细');
    taskState('notes', contentResult.status === '成功' ? '已完成' : '失败', contentResult.status === '成功' ? 'ok' : 'bad');
  } catch (err) {
    thrown = err;
    log(`执行中止：${err.message || String(err)}`, 'error');
    setStatus(canceled ? '已停止' : '部分失败', 'failed');
  } finally {
    await clearPending();
    const ended = new Date().toISOString();
    const success = results.filter(r => r.status === '成功').length;
    const failure = results.filter(r => r.status !== '成功').length;
    const manifest = {
      tool: '小红书数据一键导出 Chrome 扩展版',
      version: '1.4.0',
      runMode: notesOnly ? '仅笔记列表明细' : '完整批量导出',
      startedAt: session.startedAt, endedAt: ended, folder: session.fileBase,
      success, failure, completedTasks: results.length, expectedTasks: totalTasks,
      canceled, error: thrown ? String(thrown.message || thrown) : '',
      limitations: ['仅通过创作服务平台可见按钮导出，数据范围受小红书页面权限和时间限制。',
        '笔记列表明细的Excel顶部写明最多导出排序后前1000条笔记；不保证账号全历史和超过上限的数据。',
        '程序不会读取密码或 Cookie，不会请求未公开的接口。'],
      contentAnalysisRange: contentDates,
      files: results
    };
    const textReport = [
      '小红书创作服务平台 - 本次数据导出记录',
      `运行：${session.startedAt}`, `完成：${ended}`,
      `保存目录：Chrome 下载目录/${session.fileBase}`,
      `成功 ${success} 项，失败 ${failure} 项；已记录 ${results.length} / ${totalTasks} 项。`,
      '',
      ...results.map(r => `${r.status === '成功' ? '[成功]' : '[失败]'} ${r.kind} ${r.period}\n   ${r.filename || r.reason}`),
      '',
      `笔记列表明细日期：${contentDates?.range?.join(' 至 ') || '未完成'}；${contentDates?.mode || '未确认'}`,
      `笔记列表明细范围：${contentDates?.confirmedMax ? '已自动设置并核验近半年的起止日期' : '自动选择或核验失败，未冒充全量'}`, 
      '说明：平台内容分析通常仅支持近半年；Excel 标明最多导出排序后前1000条笔记。',
      '说明：下载成功不等于已经验证笔记数；请以Excel实际标题、行数和日期为准。'
    ].join('\r\n');
    try {
      await downloadReport('导出结果清单.json', JSON.stringify(manifest, null, 2), 'application/json');
      await downloadReport('导出记录.txt', textReport);
      await downloadReport('执行日志.txt', logs.map(x => x.line).join('\r\n')); 
    } catch (err) { log(`保存结果清单失败：${err.message}`, 'error'); }
    $('startBtn').disabled = false; $('notesOnlyBtn').disabled = false; $('stopBtn').disabled = true;
    running = false;
    setProgress(completed, totalTasks, canceled ? '已停止' : '本轮结束');
    if (!thrown && success === totalTasks) setStatus('全部完成', 'done');
    else if (thrown || failure > 0 || success < totalTasks) setStatus(canceled ? '已停止' : '部分完成', 'failed');
    log(`本轮结束：成功 ${success}，失败 ${failure}，已统计 ${results.length}/${totalTasks} 个任务。`, success === totalTasks ? 'success' : 'dim');
    await chrome.storage.local.set({ xhs_last_export_v1: { at: ended, folder: session.fileBase, success, failure } });
    if (latestFinishedDownloadId != null) $('showFolderBtn').textContent = '在文件夹中显示结果文件';
  }
}

$('startBtn').addEventListener('click', () => run(false));
$('notesOnlyBtn').addEventListener('click', () => run(true));
$('stopBtn').addEventListener('click', () => {
  canceled = true; if (manualResolver) closeManual('cancel');
  if (downloadProblemResolver) closeDownloadProblem('stop');
  log('已请求停止，将在当前操作检查点终止。', 'dim');
});
$('openSiteBtn').addEventListener('click', () => chrome.tabs.create({ url: URL_ACCOUNT }));
$('clearLogBtn').addEventListener('click', () => { logs = []; $('logArea').textContent = ''; });
$('showFolderBtn').addEventListener('click', async () => {
  try { if (latestFinishedDownloadId != null) await chrome.downloads.show(latestFinishedDownloadId);
    else await chrome.downloads.showDefaultFolder(); }
  catch (err) { log(`无法打开下载目录：${err.message}`, 'error'); }
});
$('manualContinue').addEventListener('click', () => closeManual('continue'));
$('manualPartial').addEventListener('click', () => closeManual('partial'));
$('manualCancel').addEventListener('click', () => closeManual('cancel'));
renderTasks();

$('downloadProblemRetry').addEventListener('click', () => closeDownloadProblem('retry'));
$('downloadProblemSkip').addEventListener('click', () => closeDownloadProblem('skip'));
$('downloadProblemStop').addEventListener('click', () => closeDownloadProblem('stop'));
$('openDownloadSettingsBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://settings/content/automaticDownloads' });
});

$('downloadProblemManualOpen').addEventListener('click', async () => {
  if (!sessionTab) return;
  try {
    const old = await chrome.storage.local.get(PENDING_KEY);
    if (old[PENDING_KEY]) await chrome.storage.local.set({ [PENDING_KEY]: {
      ...old[PENDING_KEY], manual: true, manualStartedAt: Date.now(), expires: Date.now() + 5 * 60 * 1000
    }});
    const t = await chrome.tabs.update(sessionTab, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    log('已切换到小红书后台。请手动点击导出，然后回到扩展点击「我已经手动点击」。', 'dim');
  } catch (err) { log(`打开页面失败：${err.message}`, 'error'); }
});
$('downloadProblemManualDone').addEventListener('click', () => closeDownloadProblem('manual'));
