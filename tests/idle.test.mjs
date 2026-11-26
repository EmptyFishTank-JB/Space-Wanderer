// Idle life: the traveler uses the toilet, dresses each morning, does not
// stand frozen at the glass for an hour, and visibly fidgets when still.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step } from '../src/sim/index.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';
import { travelerPose, TravelerTracker } from '../src/render/actor.js';
import * as mugModule from '../src/sim/traveler/mug.js';

test('three days: regular toilet visits, a fresh outfit each day, no hour-long stares', () => {
  const s = fresh('idle');
  const evs = runCollect(s, 3 * DAY, ['toilet', 'dressed', 'activity_start']);
  const toilets = evs.filter((e) => e.type === 'toilet').length;
  assert.ok(toilets >= 9 && toilets <= 24, `toilet visits: ${toilets}`);
  const dressed = evs.filter((e) => e.type === 'dressed');
  assert.ok(dressed.length >= 2, `dressed ${dressed.length} times`);
  for (let i = 1; i < dressed.length; i++) assert.notEqual(dressed[i].outfit.top, dressed[i - 1].outfit.top, 'same top two days running');
  assert.ok(s.traveler.needs.bladder < 1);
});

test('a look out of the window lasts minutes, not an hour', () => {
  const s = fresh('gaze');
  for (let i = 0; i < 4 * DAY; i++) {
    step(s, data);
    s.outbox.length = 0;
    const a = s.traveler.activity;
    if (a && a.id === 'gaze_viewport' && a.phase === 'perform') assert.ok(a.duration <= 1100 * 1.5 + 1, `gaze of ${a.duration}s`);
  }
});

test('version 3 snapshots gain a bladder and clothes', () => {
  const s = fresh('migrate');
  delete s.traveler.needs.bladder;
  delete s.traveler.outfit;
  delete s.traveler.history.lastDressDay;
  const text = serialize(s).replace(/"version":\d+/, '"version":3');
  const back = deserialize(text, data);
  assert.equal(typeof back.traveler.needs.bladder, 'number');
  assert.equal(back.traveler.outfit.top, 'gray_tee');
  for (let i = 0; i < HOUR; i++) step(back, data);
});

test('standing still at the window, he turns, sips, thinks: several poses within a few minutes', () => {
  const s = fresh('beats');
  for (let i = 0; i < 4 * DAY; i++) {
    step(s, data);
    s.outbox.length = 0;
    const a = s.traveler.activity;
    if (a && a.id === 'gaze_viewport' && a.phase === 'perform' && a.duration - a.elapsed > 200) break;
  }
  assert.equal(s.traveler.activity.id, 'gaze_viewport');
  const tracker = new TravelerTracker();
  const seen = new Set();
  for (let t = 0; t < 180; t += 2) {
    const k = travelerPose(s, data, tracker, s.traveler.pos, t);
    seen.add(`${k.pose}:${k.beat || ''}`);
  }
  assert.ok(seen.size >= 3, `poses: ${[...seen]}`);
});

test('the mug: filled hot with a meal, sipped down while he sits and looks, cooling meanwhile', () => {
  const s = fresh('mug');
  const evs = runCollect(s, 2 * DAY, ['meal']);
  assert.ok(evs.length > 0);
  const m = s.traveler.mug;
  assert.ok(m && ['tea', 'coffee', 'water', 'empty'].includes(m.contents));
  assert.ok(m.tempC >= 20 && m.tempC <= 80);
  // fresh brew, then an hour of looking out of the lounge window
  s.traveler.mug = { contents: 'tea', fill: 1, tempC: 78, room: 'galley', station: 'table', carried: false };
  s.traveler.pos.room = 'lounge';
  s.traveler.activity = { id: 'gaze_viewport', phase: 'perform', params: { interest: 0.3 }, elapsed: 0, duration: 3600, startT: s.t, score: 0.5, commitUntil: s.t, loc: { room: 'lounge', station: 'viewport' } };
  const { updateMug } = mugModule;
  updateMug(s, 3600);
  assert.equal(s.traveler.mug.room, 'lounge');
  assert.ok(s.traveler.mug.fill < 0.7 && s.traveler.mug.fill > 0.6);
  assert.ok(s.traveler.mug.tempC < 30);
});
