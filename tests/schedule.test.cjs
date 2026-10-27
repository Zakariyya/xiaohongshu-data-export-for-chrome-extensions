const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load() {
  const state = {}, alarms = new Map();
  const chrome = {
    storage: { local: { get: async k => ({ [k]: structuredClone(state[k]) }), set: async v => Object.assign(state, structuredClone(v)) } },
    alarms: { get: async n => alarms.get(n), create: async (n, v) => alarms.set(n, { name: n, scheduledTime: v.when }), clear: async n => alarms.delete(n) }
  };
  const c = vm.createContext({ chrome, Date, console });
  if (fs.existsSync('schedule.js')) vm.runInContext(fs.readFileSync('schedule.js', 'utf8'), c);
  assert.ok(c.XhsSchedule, 'scheduler is available');
  return { api: c.XhsSchedule, state, alarms };
}
test('interval is measured from save; repeated restoration retains a single alarm and deadline', async () => {
  const { api, alarms } = load();
  const now = new Date(2026, 9, 27, 8).getTime();
  const saved = await api.save({ enabled: true, mode: 'interval', hours: 2 }, now);
  assert.equal(saved.nextAt, now + 7200000);
  await Promise.all([api.restore(now + 1000), api.restore(now + 2000)]);
  assert.equal(alarms.size, 1);
  assert.equal([...alarms.values()][0].scheduledTime, saved.nextAt);
});
test('daily schedule rolls to tomorrow at or after the selected local time', async () => {
  const { api } = load();
  const now = new Date(2026, 9, 27, 9).getTime();
  const saved = await api.save({ enabled: true, mode: 'daily', time: '09:00' }, now);
  assert.equal(saved.nextAt, new Date(2026, 9, 28, 9).getTime());
});
test('reject invalid settings without changing existing schedule', async () => {
  const { api, alarms } = load();
  await api.save({ enabled: true, mode: 'interval', hours: 2 });
  for (const config of [{mode:'interval',hours:0}, {mode:'interval',hours:Infinity}, {mode:'daily',time:'25:00'}, {mode:'other'}]) {
    await assert.rejects(api.save({enabled:true, ...config}));
  }
  assert.equal(alarms.size, 1);
});
test('overdue alarm is consumed once even if multiple events arrive; advance from now', async () => {
  const { api } = load();
  await api.save({ enabled: true, mode: 'interval', hours: 1 }, 100000);
  const now = 100000 + 10 * 3600000;
  const results = await Promise.all([api.consume(now), api.consume(now)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await api.get()).nextAt, now + 3600000);
});
test('disabled schedule removes alarm and does not run on stale delivery', async () => {
  const { api, alarms } = load();
  await api.save({ enabled: true, mode: 'interval', hours: 1 }, 100000);
  await api.save({ enabled: false });
  await api.restore();
  assert.equal(alarms.size, 0);
  assert.equal(await api.consume(), false);
});
