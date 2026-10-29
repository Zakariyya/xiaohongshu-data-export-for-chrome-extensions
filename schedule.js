'use strict';
// Loaded only by the service worker. All mutations share one queue.
globalThis.XhsSchedule = (() => {
  const KEY = 'xhs_schedule_v1';
  const ALARM = 'xhs-full-export';
  let queue = Promise.resolve();
  const serial = fn => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const get = async () => ({ enabled: false, mode: 'interval', hours: 24, time: '09:00', nextAt: null,
    retryMinutes: 5, ...(await chrome.storage.local.get(KEY))[KEY] });
  function validate(input) {
    if (input.enabled === false) return { enabled: false };
    if (input.enabled !== true) throw new Error('请选择是否开启定时导出');
    if (input.mode === 'interval') {
      const hours = Number(input.hours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 8760) throw new Error('间隔请输入 1～8760 小时');
      const retryMinutes = input.retryMinutes === undefined ? 5 : Number(input.retryMinutes);
      if (!Number.isInteger(retryMinutes) || retryMinutes < 1 || retryMinutes > 1440) throw new Error('失败重试间隔请输入 1～1440 的整数分钟');
      return { enabled: true, mode: 'interval', hours, retryMinutes };
    }
    if (input.mode === 'daily' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
      return { enabled: true, mode: 'daily', time: input.time };
    }
    throw new Error('请选择有效的定时模式及每天执行时间');
  }
  function next(config, now) {
    if (config.mode === 'interval') return now + config.hours * 3600000;
    const [h, m] = config.time.split(':').map(Number);
    const date = new Date(now);
    date.setHours(h, m, 0, 0);
    if (date.getTime() <= now) { date.setDate(date.getDate() + 1); date.setHours(h, m, 0, 0); }
    return date.getTime();
  }
  async function arm(config) {
    if (!config.enabled || !Number.isFinite(config.nextAt)) { await chrome.alarms.clear(ALARM); return; }
    const existing = await chrome.alarms.get(ALARM);
    if (!existing || existing.scheduledTime !== config.nextAt) await chrome.alarms.create(ALARM, { when: config.nextAt });
  }
  return {
    KEY, ALARM, get,
    save: (input, now = Date.now()) => serial(async () => {
      const valid = validate(input);
      const previous = await get();
      const config = { ...previous, ...valid, revision: (previous.revision || 0) + 1, running: false, retrying: false, nextAt: valid.enabled ? next(valid, now) : null };
      await chrome.storage.local.set({ [KEY]: config });
      await arm(config);
      return config;
    }),
    restore: (now = Date.now(), recover = false) => serial(async () => {
      const config = await get();
      if (config.enabled) {
        validate(config);
        if (recover && config.running && config.mode === 'interval') {
          config.running = false;
          config.retrying = true;
          config.nextAt = now + config.retryMinutes * 60000;
          await chrome.storage.local.set({ [KEY]: config });
        }
        if (!config.running && !Number.isFinite(config.nextAt)) {
          config.nextAt = next(config, now);
          await chrome.storage.local.set({ [KEY]: config });
        }
      }
      // A past deadline is retained: Chrome delivers it once after waking/restarting.
      await arm(config);
      return config;
    }),
    consume: (now = Date.now()) => serial(async () => {
      const config = await get();
      if (!config.enabled || !Number.isFinite(config.nextAt) || config.nextAt > now) return false;
      validate(config);
      config.attempt = (config.attempt || 0) + 1;
      config.running = config.mode === 'interval';
      config.nextAt = config.running ? null : next(config, now);
      await chrome.storage.local.set({ [KEY]: config });
      await arm(config);
      return { revision: config.revision, attempt: config.attempt, mode: config.mode };
    }),
    finish: (ticket, success, now = Date.now()) => serial(async () => {
      const config = await get();
      if (!ticket || ticket.mode !== 'interval' || !config.enabled || !config.running ||
          config.revision !== ticket.revision || config.attempt !== ticket.attempt) return;
      config.running = false;
      config.retrying = !success;
      config.nextAt = success ? next(config, now) : now + config.retryMinutes * 60000;
      await chrome.storage.local.set({ [KEY]: config });
      await arm(config);
    })
  };
})();
