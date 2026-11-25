// Idle life: the traveler uses the toilet, dresses each morning, does not
// stand frozen at the glass for an hour, and visibly fidgets when still.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step } from '../src/sim/index.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';
import { travelerPose, TravelerTracker } from '../src/render/actor.js';

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
  assert.equal(back.traveler.outfit.top, 'grey_tee');
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
