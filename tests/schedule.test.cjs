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
test('overdue interval is consumed once and waits for completion', async () => {
  const { api } = load();
  await api.save({ enabled: true, mode: 'interval', hours: 1 }, 100000);
  const now = 100000 + 10 * 3600000;
  const results = await Promise.all([api.consume(now), api.consume(now)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await api.get()).nextAt, null);
});
test('disabled schedule removes alarm and does not run on stale delivery', async () => {
  const { api, alarms } = load();
  await api.save({ enabled: true, mode: 'interval', hours: 1 }, 100000);
  await api.save({ enabled: false });
  await api.restore();
  assert.equal(alarms.size, 0);
  assert.equal(await api.consume(), false);
});

test('interval failures retry every five minutes and success restarts the full interval', async () => {
  const { api, alarms } = load();
  await api.save({enabled:true,mode:'interval',hours:2}, 0);
  const ticket = await api.consume(7200000);
  assert.equal((await api.get()).nextAt, null);
  assert.equal(await api.consume(7200001), false);
  await api.finish(ticket, false, 7300000);
  assert.equal((await api.get()).nextAt, 7600000);
  assert.equal((await api.get()).retrying, true);
  const retry = await api.consume(7600000);
  await api.finish(retry, false, 7700000);
  assert.equal((await api.get()).nextAt, 8000000);
  const final = await api.consume(8000000);
  await api.finish(final, true, 8100000);
  assert.equal((await api.get()).nextAt, 15300000);
  assert.equal((await api.get()).retrying, false);
  assert.equal(alarms.size, 1);
});

test('saving or disabling a schedule prevents stale completion from changing it', async () => {
  const { api } = load();
  await api.save({enabled:true,mode:'interval',hours:1}, 0);
  const ticket = await api.consume(3600000);
  const saved = await api.save({enabled:true,mode:'interval',hours:3}, 3600100);
  await api.finish(ticket, false, 3600200);
  assert.equal((await api.get()).nextAt, saved.nextAt);
  const current = await api.consume(saved.nextAt);
  await api.save({enabled:false});
  await api.finish(current, false);
  assert.equal((await api.get()).nextAt, null);
});

test('worker restart recovers an interrupted interval into a persistent retry deadline', async () => {
  const { api } = load();
  await api.save({enabled:true,mode:'interval',hours:1}, 0);
  await api.consume(3600000);
  await api.restore(3700000, true);
  assert.equal((await api.get()).nextAt, 4000000);
  await api.restore(3800000);
  assert.equal((await api.get()).nextAt, 4000000);
});
