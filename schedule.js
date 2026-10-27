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
  const get = async () => (await chrome.storage.local.get(KEY))[KEY] || { enabled: false, mode: 'interval', hours: 24, time: '09:00', nextAt: null };
  function validate(input) {
    if (input.enabled === false) return { enabled: false };
    if (input.enabled !== true) throw new Error('请选择是否开启定时导出');
    if (input.mode === 'interval') {
      const hours = Number(input.hours);
      if (!Number.isFinite(hours) || hours < 1 || hours > 8760) throw new Error('间隔请输入 1～8760 小时');
      return { enabled: true, mode: 'interval', hours };
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
    if (!config.enabled) { await chrome.alarms.clear(ALARM); return; }
    const existing = await chrome.alarms.get(ALARM);
    if (!existing || existing.scheduledTime !== config.nextAt) await chrome.alarms.create(ALARM, { when: config.nextAt });
  }
  return {
    KEY, ALARM, get,
    save: (input, now = Date.now()) => serial(async () => {
      const valid = validate(input);
      const config = { ...await get(), ...valid, nextAt: valid.enabled ? next(valid, now) : null };
      await chrome.storage.local.set({ [KEY]: config });
      await arm(config);
      return config;
    }),
    restore: (now = Date.now()) => serial(async () => {
      const config = await get();
      if (config.enabled) {
        validate(config);
        if (!Number.isFinite(config.nextAt)) {
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
      config.nextAt = next(validate(config), now);
      await chrome.storage.local.set({ [KEY]: config });
      await arm(config);
      return true;
    })
  };
})();
