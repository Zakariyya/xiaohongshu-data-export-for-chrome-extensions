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
  // Date export is performed through visible controls, never by calling a private API.
  // Multiple layouts of the XHS date-range control are supported.  Always re-read
  // the actual displayed dates before allowing an export.
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const dateFmt = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const parseIso = s => {
    const m = String(s || '').match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
    return m ? new Date(+m[1], +m[2]-1, +m[3], 12) : null;
  };
  function desiredDateRange() {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const first = new Date(end);
    first.setDate(1);
    first.setMonth(first.getMonth()-6);
    // Preserve the day of month, clamped to the target month.
    first.setDate(Math.min(end.getDate(), new Date(first.getFullYear(), first.getMonth()+1, 0).getDate()));
    return { from: dateFmt(first), to: dateFmt(end), desiredDays: Math.round((end-first)/864e5) };
  }
  function isWideEnough(d, desired) {
    if (!d || d.range?.length !== 2) return false;
    const from = parseIso(d.range[0]);
    const to = parseIso(d.range[1]);
    const expected = parseIso(desired.from);
    const today = parseIso(desired.to);
    if (!from || !to || !expected || !today) return false;
    const startDrift = Math.round((from-expected)/864e5);
    const endDrift = Math.round((today-to)/864e5);
    // Some XHS calendars use rolling 180 days instead of exactly six calendar months.
    return startDrift <= 7 && startDrift >= -3 && endDrift >= 0 && endDrift <= 1;
  }
  function dateInputs() {
    const visibleInputs = Array.from(document.querySelectorAll('input')).filter(visible);
    const dateLike = visibleInputs.filter(e => /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(e.value || ''));
    if (dateLike.length >= 2) return dateLike.slice(0,2);
    const labelled = visibleInputs.filter(e => /date|日期|开始|结束/i.test([e.placeholder,e.className,e.type].join(' ')));
    return labelled.length >= 2 ? labelled.slice(0,2) : dateLike;
  }
  function pickerCandidates() {
    const selectors = '[class*="date-picker"],[class*="datePicker"],[class*="DatePicker"],[class*="calendar"],[class*="Calendar"],[class*="range-picker"],[role="dialog"],[role="grid"]';
    return Array.from(document.querySelectorAll(selectors)).filter(visible)
      .filter(e => (e.innerText || '').length > 8)
      .sort((a,b) => a.getBoundingClientRect().width*b.getBoundingClientRect().height - b.getBoundingClientRect().width*a.getBoundingClientRect().height);
  }
  function openDatePicker(side=0) {
    const input = dateInputs()[side] || dateInputs()[0];
    if (input) {
      input.scrollIntoView({block:'center'});
      input.click();
      return {ok:true, method:'input', side, readOnly:input.readOnly, value:input.value};
    }
    const dateText = Array.from(document.querySelectorAll('span,div,label'))
      .filter(e => visible(e) && /20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/.test(e.innerText||'') && (e.innerText||'').length < 75)
      .sort((a,b)=>(a.innerText||'').length-(b.innerText||'').length);
    const label = dateText[0];
    if (label) { label.click(); return {ok:true,method:'date-label'}; }
    return {ok:false,reason:'页面上未发现可操作的笔记发布时间选择器'};
  }
  function clickDatePreset() {
    const names = ['近半年','最近半年','近6个月','最近6个月','过去6个月','近180日','近180天','最近180天','半年'];
    const popups = pickerCandidates().filter(e => e.querySelectorAll('button,a,[role="option"]').length > 0);
    for (const name of names) {
      const found = candidates(name).filter(el =>
        el.matches('button,[role="option"],a') || popups.some(p => p.contains(el)) ||
        /option|preset|quick|range/i.test(String(el.className)+' '+String(el.parentElement?.className || '')));
      if (found.length) {found[0].click(); return {ok:true,preset:name};}
    }
    return {ok:false,reason:'日历没有近半年的快捷选项'};
  }
  function setControlledDateInput(input, value) {
    if (!input || input.disabled || input.readOnly) return false;
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setter) return false;
    setter.call(input, value);
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',code:'Enter'}));
    input.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Enter',code:'Enter'}));
    input.blur();
    return true;
  }
  function panelMonth(panel) {
    const text = (panel?.innerText || '').slice(0,320);
    let m = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月/);
    if (!m) m = text.match(/(20\d{2})\s*[-/.]\s*(\d{1,2})(?!\d)/);
    if (m) return (+m[1])*12 + (+m[2])-1;
    m = text.match(/(\d{1,2})\s*月\s*(20\d{2})/);
    return m ? (+m[2])*12 + (+m[1])-1 : null;
  }
  function calendarPanel() {
    const boxes = pickerCandidates().filter(e => {
      const cls = String(e.className || '');
      const dayLike = e.querySelectorAll('td,button,[role="gridcell"],[class*="date-cell"],[class*="calendar-date"]').length;
      return dayLike>=14 && /picker|calendar|panel|dialog|grid/i.test(cls+' '+e.getAttribute('role'));
    });
    // Prefer the smallest calendar container, not the entire application.
    boxes.sort((a,b)=>a.getBoundingClientRect().width*a.getBoundingClientRect().height-b.getBoundingClientRect().width*b.getBoundingClientRect().height);
    return boxes[0] || null;
  }
  function prevMonthButton(panel) {
    if (!panel) return null;
    const all = Array.from(panel.querySelectorAll('button,[role="button"],span,div'))
      .filter(visible)
      .filter(e => {
        const cls = String(e.className || '')+' '+String(e.parentElement?.className || '');
        const attr = [e.getAttribute('aria-label'),e.getAttribute('title')].join(' ');
        const full=cls+' '+attr;
        return !/prev[-_]?year|last[-_]?year|super[-_]?prev/i.test(full) &&
          (/prev[-_]?month|previous[-_]?month|last[-_]?month|prev[-_]?btn|header[-_]?prev|arrow[-_]?left|上个月|上一月|前一个月/i.test(full) || /上个月|上一月|前一个月/.test(attr));
      })
      .filter(e => !/disabled/.test(String(e.className)) && !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true');
    // Reject containers wrapping another candidate.
    const leaf = all.filter(e=>!all.some(other=>other!==e&&e.contains(other)));
    return leaf[0] || all[0] || null;
  }
  function nextMonthButton(panel) {
    if (!panel) return null;
    const all = Array.from(panel.querySelectorAll('button,[role="button"],span,div'))
      .filter(visible)
      .filter(e => {
        const cls = String(e.className || '')+' '+String(e.parentElement?.className || '');
        const attr = [e.getAttribute('aria-label'),e.getAttribute('title')].join(' ');
        const full=cls+' '+attr;
        return !/next[-_]?year|super[-_]?next/i.test(full) &&
          (/next[-_]?month|following[-_]?month|next[-_]?btn|header[-_]?next|arrow[-_]?right|下个月|下一月|后一个月/i.test(full) || /下个月|下一月|后一个月/.test(attr));
      })
      .filter(e => !/disabled/.test(String(e.className)) && !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true');
    const leaf = all.filter(e=>!all.some(other=>other!==e&&e.contains(other)));
    return leaf[0] || all[0] || null;
  }
  function dateCell(panel, targetDate) {
    const iso = dateFmt(targetDate);
    const y = targetDate.getFullYear(), m=targetDate.getMonth(), d=targetDate.getDate();
    const cellSel = '[data-date],[title],[aria-label],td,button,[role="gridcell"],[class*="date-cell"],[class*="calendar-date"]';
    const all = Array.from(panel.querySelectorAll(cellSel)).filter(visible);
    const disabled = e => e.matches('[disabled],[aria-disabled="true"]') ||
      !!e.closest('[disabled],[aria-disabled="true"]') ||
      /disabled|outside|other-month|not-current|unavailable/i.test(String(e.className)+' '+String(e.parentElement?.className || ''));
    // Exact date attributes are strongly preferred over a matching day number.
    let matching = all.filter(e=>{
      const attrs = [e.getAttribute('data-date'),e.getAttribute('title'),e.getAttribute('aria-label'),e.getAttribute('data-value')].join(' ');
      return attrs.includes(iso) || attrs.includes(`${y}年${m+1}月${d}日`) || attrs.includes(`${y}/${String(m+1).padStart(2,'0')}/${String(d).padStart(2,'0')}`);
    }).filter(e=>!disabled(e));
    if (!matching.length && panelMonth(panel) === y*12+m) {
      matching = all.filter(e=>/^\s*\d{1,2}\s*$/.test(e.textContent||'') && Number(e.textContent.trim())===d)
        .filter(e=>!disabled(e));
    }
    matching.sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length);
    return matching[0] || null;
  }
  async function calendarPickDate(targetIso, attempts) {
    const target = parseIso(targetIso);
    if (!target) return {ok:false,reason:'目标日期无效'};
    for (let i=0;i<13;i++) {
      let panel=calendarPanel();
      if (!panel) return {ok:false,reason:'打开日期控件后，找不到可识别的日历面板'};
      const currentMonth=panelMonth(panel);
      const targetMonth=target.getFullYear()*12+target.getMonth();
      attempts.push(`日历月份 ${currentMonth==null?'未识别':Math.floor(currentMonth/12)+'-'+(currentMonth%12+1)}，目标 ${targetIso}`);
      if (currentMonth !== null && currentMonth>targetMonth) {
        const prev=prevMonthButton(panel);
        if (!prev) return {ok:false,reason:'日历上个月按钮不可用（可能达到最早可选月份）'};
        prev.click(); await wait(160); continue;
      }
      if (currentMonth !== null && currentMonth<targetMonth) {
        const next=nextMonthButton(panel);
        if (!next) return {ok:false,reason:'日历下个月按钮不可用'};
        next.click(); await wait(160); continue;
      }
      for (let shift=0;shift<=7;shift++) {
        const candidate=new Date(target.getFullYear(),target.getMonth(),target.getDate()+shift,12);
        if (candidate.getMonth()!==target.getMonth()) break;
        const cell=dateCell(panel,candidate);
        if (cell) {cell.click();await wait(380);return {ok:true,chosen:dateFmt(candidate)};}
      }
      return {ok:false,reason:'目标月份中没有可选的起始日期'};
    }
    return {ok:false,reason:'日历月份导航超过安全次数'};
  }
  async function chooseWidestDate() {
    const before=dates(), desired=desiredDateRange(), attempts=[];
    if (isWideEnough(before,desired)) return {ok:true,before,after:before,desired,method:'原网页已经是最大日期范围',attempts};
    // 1. Prefer the site's first-party preset, if available.
    const open=openDatePicker(0);
    attempts.push(`打开选择器: ${open.method||open.reason}`);
    await wait(240);
    let preset=clickDatePreset();
    attempts.push(`快捷项: ${preset.preset||preset.reason}`);
    await wait(450);
    if (isWideEnough(dates(),desired)) return {ok:true,before,after:dates(),desired,method:'网页近半年快捷选项',attempts};
    // 2. Editable input boxes supported by some date picker variants.
    const inputs=dateInputs();
    if (inputs.length>=2 && inputs.every(e=>!e.readOnly && !e.disabled)) {
      const valueFrom=desired.from, valueTo=desired.to;
      setControlledDateInput(inputs[0],valueFrom);
      await wait(220);
      const current=dateInputs();
      if (current.length>=2) setControlledDateInput(current[1],valueTo);
      await wait(650);
      attempts.push(`通过日期输入框填写 ${valueFrom} 至 ${valueTo}`);
      if (isWideEnough(dates(),desired)) return {ok:true,before,after:dates(),desired,method:'可编辑日期输入框',attempts};
    } else attempts.push('日期输入框不可编辑，改用可见日历操作');
    // 3. Calendar widget navigation (usually readonly input fields).
    // Two common widget styles: first choose start then choose end, or two separate fields.
    openDatePicker(0);await wait(300);
    const startResult=await calendarPickDate(desired.from,attempts);
    attempts.push(`日历起始日期: ${startResult.ok?startResult.chosen:startResult.reason}`);
    if (startResult.ok) {
      await wait(260);
      if (dateInputs().length>=2) openDatePicker(1);
      await wait(300);
      const endResult=await calendarPickDate(desired.to,attempts);
      attempts.push(`日历结束日期: ${endResult.ok?endResult.chosen:endResult.reason}`);
      await wait(800);
      if (isWideEnough(dates(),desired)) return {ok:true,before,after:dates(),desired,method:'日历自动选择起止日期',attempts};
    }
    // 4. Some calendars cap at rolling 180 days rather than calendar six months.
    // When editable controls are supported, try exactly 180 days to avoid a rejected selection.
    const remaining=dateInputs();
    if (remaining.length>=2 && remaining.every(e=>!e.readOnly&&!e.disabled)) {
      const day180=new Date(parseIso(desired.to));day180.setDate(day180.getDate()-179);
      setControlledDateInput(remaining[0],dateFmt(day180));await wait(180);
      const pair=dateInputs(); if(pair.length>=2)setControlledDateInput(pair[1],desired.to);
      await wait(600);
      attempts.push(`备用滚动179天范围: ${dateFmt(day180)} 至 ${desired.to}`);
      if (isWideEnough(dates(),desired)) return {ok:true,before,after:dates(),desired,method:'平台滚动180天范围',attempts};
    }
    return {ok:false,before,after:dates(),desired,attempts,
      reason:'自动选择后无法确认最大日期范围；为避免错误数据，本次不会下载笔记明细'};
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
      dates: dates(), dateInputs: dateInputs().map(e=>({value:e.value,placeholder:e.placeholder,readOnly:e.readOnly,outerHTML:e.outerHTML.slice(0,320)})),
      calendar: pickerCandidates().slice(0,6).map(e=>({className:String(e.className),excerpt:(e.innerText||'').slice(0,280)})), excerpt: txt.slice(0, 3000)
    };
  }
  const actions = { click, count, hasText, selectAccountTab, accountTabState, periodState, choosePeriod, download, confirmExport, dates, chooseWidestDate, setNotesAll, snapshot };
  globalThis.__xhsPageActions = actions;
})();
