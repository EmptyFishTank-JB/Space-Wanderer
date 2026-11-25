import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, clone, DAY, HOUR } from './helpers.mjs';
import { run, catchUpSync, LiveRunner } from '../src/sim/index.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';

const strip = (s) => { const c = clone(s); delete c.outbox; delete c.wallMs; return JSON.stringify(c); };

test('same seed produces an identical history', () => {
  const a = fresh('det');
  const b = fresh('det');
  run(a, data, 2 * DAY);
  run(b, data, 2 * DAY);
  assert.equal(strip(a), strip(b));
});

test('different seeds diverge', () => {
  const a = fresh('det-a');
  const b = fresh('det-b');
  run(a, data, DAY);
  run(b, data, DAY);
  assert.notEqual(strip(a), strip(b));
});

test('snapshot round-trip mid-run continues the exact same timeline', () => {
  const live = fresh('roundtrip');
  run(live, data, DAY + 1234);
  const restored = deserialize(serialize(live));
  run(live, data, DAY);
  run(restored, data, DAY);
  assert.equal(strip(restored), strip(live));
});

test('offline catch-up equals watching it live', () => {
  const watched = fresh('catchup');
  const away = clone(watched);
  // live: a fake wall clock pumped at irregular intervals, like a browser tab
  let now = 1_000_000;
  watched.wallMs = now;
  const runner = new LiveRunner({ state: watched, data, now: () => now, inlineLimit: 1e9 });
  const gaps = [250, 1000, 3700, 16, 59_000, 999, 120_000];
  let simulated = 0;
  for (let i = 0; simulated < 10 * HOUR; i++) {
    now += gaps[i % gaps.length];
    simulated += runner.pump();
  }
  // away: the tab was closed; reopen and catch up in one go
  catchUpSync(away, data, watched.t);
  assert.equal(away.t, watched.t);
  assert.equal(strip(away), strip(watched));
});

test('catch-up beyond the cap is booked as torpor on the mission calendar', () => {
  const s = fresh('torpor');
  const capSeconds = data.config.catchup.maxDays * DAY;
  const smallData = { ...data, config: { ...data.config, catchup: { ...data.config.catchup, maxDays: 1 } } };
  const plan = catchUpSync(s, smallData, 3 * DAY + 5);
  assert.equal(plan.simulate, DAY);
  assert.equal(plan.torpor, 2 * DAY + 5);
  assert.equal(s.t, DAY);
  assert.equal(s.calendar.torporSeconds, 2 * DAY + 5);
  assert.ok(capSeconds > DAY);
});

test('live runner never rewinds when the wall clock jumps backwards', () => {
  const s = fresh('clock');
  let now = 5_000_000;
  s.wallMs = now;
  const r = new LiveRunner({ state: s, data, now: () => now });
  now += 10_000;
  r.pump();
  const t = s.t;
  now -= 60_000;
  assert.equal(r.pump(), 0);
  assert.equal(s.t, t);
  now += 2_000;
  assert.equal(r.pump(), 2);
});

test('events carry monotonically increasing ids', () => {
  const s = fresh('ids');
  const evs = runCollect(s, 6 * HOUR);
  for (let i = 1; i < evs.length; i++) assert.ok(evs[i].id > evs[i - 1].id);
});
