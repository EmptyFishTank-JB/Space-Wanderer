import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, assertFinite, DAY, HOUR } from './helpers.mjs';
import { shipHour } from '../src/sim/index.js';
import { planPath } from '../src/sim/traveler/nav.js';

test('nav: every room reachable from every room with a continuous path', () => {
  for (const a of data.roomIds) {
    for (const b of data.roomIds) {
      const from = { room: a, x: 1 };
      const to = { room: b, x: 2 };
      const segs = planPath(data.nav, from, to);
      assert.ok(segs, `${a} -> ${b}`);
      let room = a;
      for (const sg of segs) {
        if (sg.kind === 'walk') assert.equal(sg.room, room);
        else { assert.equal(sg.from, room); room = sg.to; }
      }
      assert.equal(room, b);
    }
  }
});

test('the 8-hour benchmark: a waking day is an authentic slice of life', () => {
  const s = fresh('benchmark');
  const evs = runCollect(s, 24 * HOUR);
  const types = new Set(evs.map((e) => e.type));
  const activities = new Set(evs.filter((e) => e.type === 'activity_start').map((e) => e.activity));
  for (const t of ['wake', 'sleep_start', 'meal', 'log_entry', 'tend_trays']) assert.ok(types.has(t), `missing ${t}`);
  for (const a of ['cook_meal', 'eat_meal', 'drink_water', 'check_scans', 'wash']) assert.ok(activities.has(a), `never did ${a}`);
  const meals = evs.filter((e) => e.type === 'meal' && !e.snack).length;
  assert.ok(meals >= 2 && meals <= 4, `meals ${meals}`);
  // ...and the ship is going somewhere: a survey, a jump or a scoop within the day
  assert.ok(types.has('system_survey') && (types.has('system_arrival') || types.has('scoop_end')), 'no voyage activity');
  const rooms = new Set(evs.filter((e) => e.type === 'room_enter').map((e) => e.room));
  assert.ok(rooms.size >= 5, `visited only ${[...rooms]}`);
});

test('circadian rhythm: sleeps at night, wakes in the morning, ~7-9 h', () => {
  const s = fresh('circadian');
  const evs = runCollect(s, 6 * DAY, ['sleep_start', 'wake']);
  const sleeps = [];
  for (const e of evs) {
    const h = shipHour({ ...s, t: e.t });
    if (e.type === 'sleep_start') sleeps.push({ start: h });
    if (e.type === 'wake' && sleeps.length && !e.dozed) Object.assign(sleeps[sleeps.length - 1], { end: h, hours: e.hours });
  }
  const nights = sleeps.filter((x) => x.hours !== undefined).slice(1); // first night is pre-seeded
  assert.ok(nights.length >= 4);
  for (const n of nights) {
    assert.ok(n.start >= 20.5 || n.start < 2, `went to bed at ${n.start.toFixed(2)}`);
    assert.ok(n.end >= 5.5 && n.end < 10.5, `woke at ${n.end.toFixed(2)}`);
    assert.ok(n.hours >= 6 && n.hours <= 10.5, `slept ${n.hours} h`);
  }
});

test('task inertia: no thrashing between activities', () => {
  const s = fresh('hysteresis');
  const evs = runCollect(s, 10 * DAY, ['activity_start', 'activity_interrupted']);
  const interrupts = evs.filter((e) => e.type === 'activity_interrupted').length;
  assert.ok(interrupts / 10 < 6, `${interrupts} interrupts in 10 days`);
  // never abandon and restart the same activity within five minutes
  const starts = evs.filter((e) => e.type === 'activity_start' && e.activity !== 'linger' && e.activity !== 'drink_water');
  for (let i = 1; i < starts.length; i++) {
    const a = starts[i - 1];
    const b = starts[i];
    if (a.activity === b.activity && JSON.stringify(a.params) === JSON.stringify(b.params)) {
      assert.ok(b.t - a.t > 300, `${a.activity} restarted after ${b.t - a.t}s`);
    }
  }
});

test('120-day survival: closed loops stay in band, nothing goes non-finite', () => {
  const s = fresh('survival');
  let minCond = 1;
  let maxCo2 = 0;
  let minWater = Infinity;
  for (let d = 0; d < 120; d++) {
    runCollect(s, DAY);
    minCond = Math.min(minCond, s.traveler.body.condition);
    maxCo2 = Math.max(maxCo2, s.ship.atmo.co2);
    minWater = Math.min(minWater, s.ship.water.potable);
  }
  assertFinite(s);
  assert.ok(minCond > 0.8, `condition fell to ${minCond}`);
  assert.ok(maxCo2 < 2500, `CO2 peaked at ${maxCo2}`);
  assert.ok(minWater > 30, `potable fell to ${minWater}`);
  assert.ok(s.traveler.mood.weariness <= 0.78);
  assert.ok(s.ship.food.emergencyOpened === false, 'emergency rations opened in a healthy 120 days');
});
