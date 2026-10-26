'use strict';
// Injected only in https://creator.xiaohongshu.com pages. It never calls fetch,
// reads cookies, touches localStorage, or requests site-private API endpoints.
// Returns small, plain data objects to the extension dashboard.
(() => {
  const visible = el => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[aria-hidden="true"]');
  };
  const norm = s => String(s || '').replace(/\s+/g, '').trim();
  const exact = (el, target) => norm(el.innerText || el.textContent) === norm(target);
  const clickable = 'button,a,[role="button"],[role="tab"],[role="option"],label,li,span,div';
  const score = el => {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const cls = String(el.className || '').toLowerCase();
    return (role === 'tab' ? 30 : 0) + (tag === 'button' ? 22 : 0) +
      (tag === 'a' ? 18 : 0) + (role === 'button' ? 12 : 0) +
      (/tab/.test(cls) ? 7 : 0) + (/btn|button/.test(cls) ? 5 : 0);
  };
  function candidates(name) {
    const all = Array.from(document.querySelectorAll(clickable))
      .filter(el => visible(el) && exact(el, name));
    const leaves = all.filter(el => !all.some(other => other !== el && el.contains(other)));
    return (leaves.length ? leaves : all).sort((a, b) => score(b) - score(a));
  }
  function click(name) {
    const el = candidates(name)[0];
    if (!el) return { ok: false, reason: `未找到可见的「${name}」` };
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[disabled]')) {
      return { ok: false, reason: `「${name}」当前不可点击` };
    }
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    el.click();
    return { ok: true, name, tag: el.tagName, html: el.outerHTML.slice(0, 260) };
  }
  const ACCOUNT_TABS = ['观看数据','互动数据','涨粉数据','发布数据'];
  function selectionInfo(el) {
    if (!el) return { found: false, selected: false, evidence: 'not-found' };
    const chain = [el, el.parentElement, el.parentElement?.parentElement].filter(Boolean);
    for (const node of chain) {
      const aria = node.getAttribute('aria-selected');
      const dataState = node.getAttribute('data-state');
      if (aria === 'true' || dataState === 'active')
        return { found: true, selected: true, evidence: aria === 'true' ? 'aria-selected' : 'data-state' };
      const cls = typeof node.className === 'string' ? node.className : '';
      if (/(?:^|[\s_-])(active|selected|current|checked)(?:$|[\s_-])/i.test(cls))
        return { found: true, selected: true, evidence: cls.slice(0, 100) };
    }
    return { found: true, selected: false, evidence: '未发现选中标志（不代表未选中）' };
  }
  function accountTabState(name) {
    const tabs = Object.fromEntries(ACCOUNT_TABS.map(t => [t, selectionInfo(candidates(t)[0])]));
    return { name, target: tabs[name] || { found: false }, tabs };
  }
  function selectAccountTab(name) {
    if (!ACCOUNT_TABS.includes(name)) return { ok: false, reason: `未知栏目：${name}` };
    const before = accountTabState(name);
    if (!before.target.found) return { ok: false, reason: `未找到栏目「${name}」，可能不在账号概览页面`, before };
    const result = click(name);
    return { ...result, before, after: accountTabState(name) };
  }
  function periodState() {
    return Object.fromEntries(['近7日','近30日'].map(t => [t, selectionInfo(candidates(t)[0])]));
  }
  function count(name) { return candidates(name).length; }
  function hasText(value) { return norm(document.body?.innerText || '').includes(norm(value)); }
  function choosePeriod(period) {
    const attempts = period === '近7日' ? ['近7日', '近7天'] : ['近30日', '近30天'];
    for (const name of attempts) {
      const found = candidates(name);
      if (found.length) {
        const before = periodState();
        const res = click(name);
        return { ...res, selected: name, matches: found.length, before, after: periodState() };
      }
    }
    return { ok: false, reason: `未找到时间选项 ${period}` };
  }
  function cleanHtml(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    for (const e of [clone, ...clone.querySelectorAll('*')]) {
      for (const a of [...e.attributes]) {
        if (/^on/i.test(a.name) || (a.name === 'src' && a.value.startsWith('data:'))) e.removeAttribute(a.name);
      }
    }
    return clone.outerHTML.slice(0, 450);
  }
  function download() {
    // Clicking the outer DIV may not trigger listeners on its IMG/SPAN children.
    // Use the actual visible hit-test element, bubbling up to DIV.export.
    const match = candidates('导出数据')[0];
    if (!match) return { ok: false, reason: '未找到「导出数据」按钮' };
    const root = match.closest('button,a,[role="button"],.export') || match;
    if (!visible(root) || root.disabled || root.getAttribute('aria-disabled') === 'true') {
      return { ok: false, reason: '「导出数据」按钮当前禁用或不可见' };
    }
    root.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = root.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const nested = root.contains(at) && at !== root ? at : null;
    const target = (match !== root && visible(match) ? match : null) || nested || root.querySelector('button,[role="button"],img,span') || root;
    const meta = { ok: true, rootTag: root.tagName, targetTag: target.tagName,
      targetClass: String(target.className || '').slice(0, 100),
      rootHtml: cleanHtml(root), targetHtml: cleanHtml(target),
      message: '仅能确认已向 DOM 发送 click 事件，不能证明网站已开始导出。' };
    target.click();
    return meta;
  }
  function confirmExport() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"]')).filter(visible);
    const names = ['确认导出', '开始导出', '立即导出', '下载文件', '确认', '确定'];
    for (const dialog of dialogs) {
      for (const name of names) {
        const el = Array.from(dialog.querySelectorAll('button,[role="button"],a')).find(e => visible(e) && exact(e, name));
        if (el) { el.click(); return { ok: true, name }; }
      }
    }
    return { ok: false };
  }
  function dates() {
    const text = document.body?.innerText || '';
    const inputs = Array.from(document.querySelectorAll('input')).filter(visible).map(el => ({
      value: el.value, placeholder: el.placeholder, readOnly: el.readOnly,
      type: el.type, cls: String(el.className).slice(0, 70)
    }));
    const fromInputs = inputs.map(a => a.value).filter(a => /^20\d\d[-/.]\d\d?[-/.]\d\d?$/.test(a));
    const relevantText = text.slice(0, 2200);
    const fromText = Array.from(relevantText.matchAll(/20\d\d[-/.]\d\d?[-/.]\d\d?/g)).map(v => v[0]);
    const range = (fromInputs.length >= 2 ? fromInputs : fromText).slice(0, 2);
    const toTs = str => {
      if (!str) return NaN;
      const v = str.replace(/[/.]/g, '-');
      const parts = v.split('-').map(Number);
      if (parts.length !== 3) return NaN;
      const t = Date.UTC(parts[0], parts[1] - 1, parts[2]);
      return Number.isFinite(t) ? t : NaN;
    };
    const days = range.length === 2 ? Math.round((toTs(range[1]) - toTs(range[0])) / 864e5) : null;
    return { range, days, inputs, lastSixMonthsOnly: text.includes('近半年'), noteRows: text.match(/共\s*\d+\s*条/)?.[0] || '', url: location.href };
  }
  function chooseWidestDate() {
    // Only use explicit platform-provided quick period choices. Avoid changing a
    // controlled input field with synthetic untrusted events and assuming success.
    const before = dates();
    if (before.days >= 165) return { ok: true, alreadyWide: true, before };
    const words = ['近半年', '最近半年', '近6个月', '近180日', '近180天', '近一年', '最近一年'];
    for (const name of words) {
      if (candidates(name).length) return { ...click(name), selected: name, before };
    }
    const likelyRange = Array.from(document.querySelectorAll('[class*="range"],[class*="Range"],[class*="picker"],[class*="Picker"],[role="combobox"]'))
      .filter(visible).filter(e => e.getBoundingClientRect().width < 600 && /20\d\d[-/.]\d\d?[-/.]\d\d?/.test(e.innerText || ''))
      .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
    const el = likelyRange[0];
    if (el) { el.click(); return { ok: true, openedPicker: true, before }; }
    return { ok: false, before, reason: '未发现可自动选择的日期范围快捷选项，请手动设置近半年' };
  }
  function setNotesAll() {
    const d = dates();
    const t = document.body?.innerText || '';
    if (!t.includes('笔记类型') || /笔记类型\s*全部/.test(t)) {
      return { ok: true, reason: '笔记类型通常默认「全部」', dates: d };
    }
    if (count('全部')) return { ...click('全部'), dates: d };
    return { ok: true, reason: '没有发现需更改的笔记类型选项', dates: d };
  }
  function snapshot() {
    const txt = document.body?.innerText || '';
    return {
      href: location.href, title: document.title,
      hasDownload: count('导出数据') > 0,
      accountTabs: accountTabState(),
      periods: periodState(),
      downloadButtons: candidates('导出数据').slice(0,3).map(el => ({html:el.outerHTML.slice(0,400), parent: (el.closest('button,a,[role=\"button\"]')||el).outerHTML.slice(0,400)})),
      modals: Array.from(document.querySelectorAll('[role=\"dialog\"],[class*=\"modal\"],[class*=\"Modal\"]')).filter(visible).map(el => (el.innerText||'').slice(0,400)),
      firstButtons: Array.from(document.querySelectorAll('button,[role="tab"],[role="button"]')).filter(visible)
        .map(e => norm(e.innerText).slice(0, 55)).filter(Boolean).slice(0, 70),
      dates: dates(), excerpt: txt.slice(0, 3000)
    };
  }
  const actions = { click, count, hasText, selectAccountTab, accountTabState, periodState, choosePeriod, download, confirmExport, dates, chooseWidestDate, setNotesAll, snapshot };
  globalThis.__xhsPageActions = actions;
})();
