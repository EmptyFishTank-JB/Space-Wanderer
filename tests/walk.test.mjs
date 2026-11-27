// Walking the ship in first person: the walkable world built from the 3D
// layout, doors that open and shut, ladders, the lift and the ductwork, and
// the small rasterizer that draws it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { data } from './helpers.mjs';
import { buildWorld, walkable, roomAt, roomPoint, roomLocal, crawlable } from '../src/walk/world.js';
import { Walker, EYE, EYE_CROUCH, EYE_CRAWL } from '../src/walk/walker.js';
import { Raster, pack } from '../src/walk/raster.js';
import { isShut, setShut, manualShut } from '../src/render/shutters.js';

const S = JSON.parse(readFileSync(new URL('../data/ship3d.json', import.meta.url)));
const fresh = () => buildWorld(S, data);
const run = (k, secs, input = {}) => { for (let i = 0; i < secs * 30; i++) k.step(1 / 30, typeof input === 'function' ? input(k) : input); };
const headTo = (x, y) => (k) => { k.yaw = Math.atan2(y - k.y, x - k.x); return { fwd: Math.hypot(x - k.x, y - k.y) > 0.05 ? 1 : 0 }; };

test('every space in the 3D layout is there to walk, and every one can be reached from the bridge', () => {
  const w = fresh();
  assert.deepEqual(w.problems, []);
  for (const id of data.roomIds.filter((r) => !['surface', 'port'].includes(r))) assert.ok(w.rooms[id], `${id} missing`);
  const seen = new Set(['bridge']), q = ['bridge'];
  while (q.length) for (const n of w.links[q.shift()]) if (!seen.has(n)) { seen.add(n); q.push(n); }
  assert.deepEqual(Object.keys(w.rooms).filter((r) => !seen.has(r)), []);
  for (const r of Object.values(w.rooms)) {
    const k = new Walker(w);
    k.place(r.id);
    assert.ok(walkable(w, r.deck, k.x, k.y) && roomAt(w, r.deck, k.x, k.y) === r, `nowhere to stand in ${r.id}`);
  }
});

test('a room position from the sim lands in its room, and comes back the same', () => {
  const w = fresh();
  for (const r of Object.values(w.rooms).filter((q) => q.sim)) {
    const p = roomPoint(r, r.len / 2, 0.9);
    assert.equal(roomAt(w, r.deck, p[0], p[1]), r, r.id);
    const l = roomLocal(r, p[0], p[1]);
    assert.ok(Math.abs(l.u - r.len / 2) < 1e-6 && Math.abs(l.d - 0.9) < 1e-6, r.id);
  }
});

test('doors: shut, they stop you; opened, you walk through', () => {
  const w = fresh();
  const d = w.doors.find((q) => q.simHatch === 'h_lounge');
  const k = new Walker(w);
  const inside = [d.at[0] - d.n[0] * 1.2, d.at[1] - d.n[1] * 1.2], beyond = [d.at[0] + d.n[0] * 1.4, d.at[1] + d.n[1] * 1.4];
  const from = d.a === 'corridor_fore' ? beyond : inside, to = d.a === 'corridor_fore' ? inside : beyond;
  k.place('corridor_fore', from[0], from[1]);
  run(k, 4, headTo(...to));
  assert.equal(k.room.id, 'corridor_fore', 'walked through a shut door');
  d.open = 1;
  run(k, 4, headTo(...to));
  assert.equal(k.room.id, 'lounge');
});

test('ladders and the lift: from the living deck up to the bridge and down to the lower deck', () => {
  const w = fresh();
  const k = new Walker(w);
  const well = w.shafts.find((s) => s.id === 'lw_bridge');
  k.place('corridor_fore', well.x[1] + 0.3, 0.3);
  assert.ok(k.exits().some((e) => e.dir === 'up' && e.to === 'bridge'));
  assert.equal(k.go('up'), 'ladder');
  run(k, 12);
  assert.equal(k.room.id, 'bridge');
  assert.equal(k.z, w.rooms.bridge.z[0]);
  const lift = w.shafts.find((s) => s.kind === 'lift');
  k.place(lift.stops[1], lift.x[0] - 0.4, (lift.y[0] + lift.y[1]) / 2);
  assert.equal(k.go('down'), 'lift');
  run(k, 12);
  assert.equal(k.room.id, lift.stops[0]);
});

test('the ductwork: up through a grille, crawl, up the vent rungs, out through a grille', () => {
  const w = fresh();
  const k = new Walker(w);
  const over = w.ducts.find((d) => d.id === 'duct_overhead');
  const g = over.grilles.find((q) => q.room === 'engineering');
  k.place('engineering', (g.x[0] + g.x[1]) / 2, (g.y[0] + g.y[1]) / 2);
  assert.equal(k.go('up'), 'duct');
  run(k, 3);
  assert.equal(k.mode, 'duct');
  assert.ok(Math.abs(k.eyeH - EYE_CRAWL) < 0.01, 'on hands and knees');
  // along the run to the aft vent shaft, and up its rungs
  const v = over.vents.find((q) => q.id === 'vent_aft');
  run(k, 30, (q) => (q.exits().some((e) => e.vent) ? {} : headTo((v.x[0] + v.x[1]) / 2, 2)(q)));
  assert.ok(crawlable(k.duct, k.x, k.y));
  assert.equal(k.go('up'), 'vent');
  run(k, 10);
  assert.equal(k.duct.id, 'duct_roof');
  // out into whichever room the roof duct's nearest grille opens into
  const out = k.duct.grilles[0];
  run(k, 60, (q) => (q.exits().some((e) => e.grille) ? {} : headTo((out.x[0] + out.x[1]) / 2, (out.y[0] + out.y[1]) / 2)(q)));
  const exit = k.exits().find((e) => e.grille);
  assert.ok(exit, 'never reached a grille');
  k.go(exit.dir);
  run(k, 3);
  assert.equal(k.mode, 'room');
  assert.equal(k.room.id, exit.to);
});

test('crouching lowers the eye; you crawl in the ducts', () => {
  const w = fresh();
  const k = new Walker(w);
  k.place('galley');
  run(k, 1);
  assert.ok(Math.abs(k.eyeH - EYE) < 0.01);
  k.toggleCrouch();
  run(k, 1);
  assert.ok(Math.abs(k.eyeH - EYE_CROUCH) < 0.01);
});

test('the rasterizer: a textured wall in front of the eye, with a hole cut in it', () => {
  const R = new Raster();
  const red = pack([200, 40, 40]), hole = 0;
  const tex = { w: 4, h: 4, data: new Uint32Array(16).fill(red) };
  tex.data[1 * 4 + 1] = hole; tex.data[1 * 4 + 2] = hole; tex.data[2 * 4 + 1] = hole; tex.data[2 * 4 + 2] = hole;
  R.begin({ at: [0, 0, 0], yaw: 0, pitch: 0 });
  // a 2 m square wall 3 m ahead, the hole in its middle
  R.poly([[3, -1, -1], [3, 1, -1], [3, 1, 1], [3, -1, 1]], [[0, 4], [4, 4], [4, 0], [0, 0]], { tex, shade: 1 }, 7);
  const at = (x, y) => R.color[y * R.w + x] >>> 0;
  assert.equal(at(160, 90), 0, 'the hole shows through');
  assert.equal(at(160 - 55, 90), red >>> 0, 'the wall round it is drawn');
  assert.equal(R.hit, null, 'nothing under the crosshair: it is the hole');
  R.poly([[5, -2, -2], [5, 2, -2], [5, 2, 2], [5, -2, 2]], null, { color: pack([20, 200, 40]) }, 9);
  assert.equal(R.hit.id, 9, 'through the hole, the wall beyond');
  assert.equal(at(160 - 55, 90), red >>> 0, 'and the near wall still in front');
  assert.equal(at(160, 90) & 0xffffff, 0x28c814, 'the far wall through the hole');
});

test('shutters: the ship closes them in supercruise; a hand-set state holds until handed back', () => {
  const st = { ship: { flight: { mode: 'orbit' } } };
  assert.equal(isShut(st, 'win_gal_s'), false);
  st.ship.flight.mode = 'cruise';
  assert.equal(isShut(st, 'win_gal_s'), true);
  setShut('win_gal_s', false);
  assert.equal(isShut(st, 'win_gal_s'), false);
  assert.equal(manualShut('win_gal_s'), false);
  setShut('win_gal_s', null);
  assert.equal(isShut(st, 'win_gal_s'), true);
});
