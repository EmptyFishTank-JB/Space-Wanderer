import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Director, interestingRooms, EXT, EVA } from '../src/render/director.js';
import { fresh } from './helpers.mjs';
import { startFault } from '../src/sim/ship/wear.js';
import { data } from './helpers.mjs';

const cameras = JSON.parse(readFileSync(new URL('../data/cameras.json', import.meta.url)));
const mk = (opts = {}) => new Director(cameras, { rng: () => 0.5, ...opts });
const ctx = (o = {}) => ({ travelerRoom: 'bridge', eva: false, events: [], shipMode: 'idle', travelerStill: true, interestingRooms: [], ...o });

/** Advance in 1/4 s steps, returning the feed at the end. */
function run(d, t0, t1, c) {
  let f;
  for (let t = t0; t <= t1; t += 0.25) f = d.update(t, typeof c === 'function' ? c(t) : c);
  return f;
}

test('every interior room has a camera, plus the hull and helmet feeds', () => {
  const rooms = new Set(cameras.feeds.filter((f) => f.room).map((f) => f.room));
  for (const r of data.roomIds) assert.ok(rooms.has(r), `no camera for ${r}`);
  assert.ok(cameras.feeds.some((f) => f.id === EXT));
  assert.ok(cameras.feeds.some((f) => f.id === EVA));
});

test('boots on the traveler\'s room with a fade-in', () => {
  const d = mk();
  assert.equal(d.update(0, ctx()), 'CAM-01');
  assert.ok(d.fadeAmount(0.1) > 0.9);
  assert.equal(d.fadeAmount(5), 0);
});

test('following the traveler lingers 2–4 s on the vacated room, then cuts cleanly', () => {
  const d = mk();
  run(d, 0, 100, ctx());
  assert.equal(run(d, 100, 101.5, ctx({ travelerRoom: 'corridor_fore' })), 'CAM-01', 'cut too early');
  assert.equal(run(d, 101.5, 104.5, ctx({ travelerRoom: 'corridor_fore' })), 'CAM-10');
});

test('a quick corridor transit is skipped: the cut lands on the room they reached', () => {
  const d = mk();
  run(d, 0, 100, ctx());
  const room = (t) => (t < 101.5 ? 'corridor_fore' : 'galley');
  assert.equal(run(d, 100, 106, (t) => ctx({ travelerRoom: room(t) })), 'CAM-04');
  assert.ok(!d.log.some((e) => e.feed === 'CAM-10'), 'cut to the corridor for a second');
});

test('a jump cuts to the hull camera, then returns to the traveler', () => {
  const d = mk();
  run(d, 0, 10, ctx());
  d.update(10.25, ctx({ events: [{ type: 'hyperspace_charge' }] }));
  assert.equal(d.feed, EXT);
  assert.equal(run(d, 10.5, 60, ctx()), EXT);
  assert.equal(run(d, 60, 90, ctx()), 'CAM-01');
});

test('minor events wait out the minimum shot length', () => {
  const d = mk();
  run(d, 0, 5, ctx());
  d.update(5.25, ctx({ events: [{ type: 'supercruise_engage' }] }));
  assert.equal(d.feed, 'CAM-01', 'cut before the minimum shot length');
  run(d, 5.5, 200, ctx());
  d.update(200.25, ctx({ events: [{ type: 'supercruise_engage' }] }));
  assert.equal(d.feed, EXT);
});

test('stepping outside switches to the helmet cam and holds it until they come back in', () => {
  const d = mk();
  run(d, 0, 10, ctx({ travelerRoom: 'airlock' }));
  assert.equal(run(d, 10, 20, ctx({ travelerRoom: 'surface', eva: true })), EVA);
  // exterior-worthy events don't steal the shot during EVA
  d.update(20.25, ctx({ travelerRoom: 'surface', eva: true, events: [{ type: 'orbit_entered' }] }));
  assert.equal(d.feed, EVA);
  assert.equal(run(d, 20.5, 30, ctx({ travelerRoom: 'airlock' })), 'CAM-13');
});

test('viewer switching holds until the idle timeout, then fades back to the traveler', () => {
  const d = mk();
  run(d, 0, 10, ctx({ travelerRoom: 'galley' }));
  d.select(10, 'CAM-07');
  assert.equal(run(d, 10, 39, ctx({ travelerRoom: 'galley' })), 'CAM-07');
  assert.equal(run(d, 39, 41, ctx({ travelerRoom: 'galley' })), 'CAM-04');
  assert.ok(d.fadeAmount(40.6) > 0 || d.fadeAmount(40.8) > 0, 'expected a fade on return');
  assert.equal(d.mode, 'auto');
});

test('idle timeout is configurable but clamped to 20–45 s', () => {
  assert.equal(mk({ idleReturnSeconds: 5 }).idle, 20);
  assert.equal(mk({ idleReturnSeconds: 90 }).idle, 45);
  assert.equal(mk({ idleReturnSeconds: 33 }).idle, 33);
});

test('manual panning stays within the camera\'s physical bounds and resets on return', () => {
  const d = mk();
  run(d, 0, 5, ctx({ travelerRoom: 'hydro' }));
  for (let i = 0; i < 200; i++) d.pan(5 + i * 0.01, 40);
  const x = d.cameraX('CAM-05', 12, 100, 10, true);
  assert.ok(x <= 12 * 32 - 320 + 36 + 1e-6, `panned past the bounds: ${x}`);
  run(d, 8, 60, ctx({ travelerRoom: 'hydro' }));
  assert.equal(d.panOffset, 0);
});

test('tracking pan follows the traveler across a wide room and keeps them in frame', () => {
  const d = mk();
  const xs = [];
  for (let i = 0; i <= 400; i++) {
    const tx = (1 + (i / 400) * 10) * 32; // walking from 1 m to 11 m along the 12 m bay
    const x = d.cameraX('CAM-05', 12, tx, 0.05, true);
    xs.push(x);
    assert.ok(tx - x > 0 && tx - x < 320, `traveler out of frame at ${tx}`);
  }
  assert.ok(xs[0] < 5 && xs[xs.length - 1] > 12 * 32 - 320 - 5, 'camera did not pan across the bay');
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] >= xs[i - 1] - 1e-9, 'camera jittered backwards');
});

test('quiet foreshadowing: an occasional brief hold on another room with something happening', () => {
  const d = mk({ rng: (() => { let k = 0; return () => ((k += 0.37) % 1); })() });
  const c = ctx({ travelerRoom: 'lounge', interestingRooms: ['hydro', 'lounge'] });
  let saw = null;
  for (let t = 0; t < 3600; t += 0.5) {
    const f = d.update(t, c);
    if (f === 'CAM-05') { saw = t; break; }
  }
  assert.ok(saw, 'never foreshadowed');
  const back = run(d, saw, saw + 15, c);
  assert.equal(back, 'CAM-02');
});

test('interestingRooms reads diegetic activity from the sim', () => {
  const s = fresh('interest');
  startFault(s, data, 'junction_box_fore', 'minor');
  s.ship.ops.fabricating = true;
  const r = interestingRooms(s);
  assert.ok(r.includes('corridor_fore') && r.includes('workshop'));
});
