// The proposed 3D arrangement (data/ship3d.json) must stay consistent with the
// sim's room graph (data/ship.json): every sim compartment placed at the sim's
// length, nothing overlapping, nothing outside the hull, every hatch on both
// walls, and ladders, lifts and crawl ducts clear of the rooms they don't serve.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkArrangement, proposedChanges, station, insideHull, roomU, profile, hullParts, segmentBox, windowQuads } from '../src/ship3d/geometry.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
const ship = load('data/ship3d.json');
const sim = load('data/ship.json');

test('the proposed arrangement is consistent with the sim room graph', () => {
  const report = checkArrangement(ship, sim);
  assert.deepEqual(report.problems, []);
  assert.equal(report.hatches.length, sim.hatches.length);
  const simIds = new Set(sim.rooms.filter((r) => !r.exterior).map((r) => r.id));
  for (const r of ship.rooms) assert.equal(!!r.new, !simIds.has(r.id), `${r.id} new flag`);
});

test('door changes are reported only beyond the tolerance', () => {
  const report = checkArrangement(ship, sim);
  const changes = proposedChanges(report);
  for (const c of changes) assert.ok(Math.abs(c.to - c.from) > 0.6, `${c.hatch} ${c.room}`);
  assert.ok(changes.length <= 3, 'side rooms open at their inboard ends, so few doors move');
});

test('the checker catches a duct cut through a room and a shaft through the wrong room', () => {
  const broken = structuredClone(ship);
  broken.ducts[0].segments.push([[-12, 2, 1.7], [-12, 10, 1.7]]); // through hydroponics at head height
  broken.shafts.find((s) => s.id === 'lw_fwd').opensTo = ['fwd_main'];
  const report = checkArrangement(broken, sim);
  assert.ok(report.problems.some((p) => p.includes('cuts through hydro')));
  assert.ok(report.problems.some((p) => p.includes('lw_fwd cuts through lower_passage')));
});

test('hull parts interpolate and bound the hull', () => {
  const main = hullParts(ship).find((p) => p.id === 'main');
  const st = station(main.stations, 26);
  assert.ok(st.b > 21 && st.b < 26);
  assert.equal(station(main.stations, 80), null);
  assert.ok(insideHull(ship, 0, 0, 1));
  assert.ok(!insideHull(ship, 0, 0, 20));
  assert.ok(insideHull(ship, -24, 0, 11), 'the bridge sits in the tower');
  assert.ok(insideHull(ship, 60, 12.3, 1.2), 'the starboard tine');
  assert.ok(!insideHull(ship, 60, 0, 0), 'the gap between the prongs');
  assert.equal(profile('hex', st).length, 8);
  assert.equal(profile('krait', st).length, 8);
  const box = segmentBox([[0, 2, 4], [-10, 2, 4]], 0.9);
  assert.deepEqual(box, { x: [-10, 0], y: [1.55, 2.45], z: [3.55, 4.45] });
});

test('rev A hull layout (main/head) still reads', () => {
  const legacy = { hull: { main: [{ x: 10, b: 5, z: [-2, 2] }, { x: -10, b: 5, z: [-2, 2] }], head: [{ x: 5, b: 2, z: [2, 4] }, { x: -5, b: 2, z: [2, 4] }] } };
  assert.deepEqual(hullParts(legacy).map((p) => p.profile), ['hex', 'box']);
  assert.ok(insideHull(legacy, 0, 0, 3));
});

test('room-local coordinates follow each room axis', () => {
  const byId = Object.fromEntries(ship.rooms.map((r) => [r.id, r]));
  assert.equal(roomU(byId.bridge, [-24, -4.5, 10]), 0);
  assert.equal(roomU(byId.corridor_aft, [-10, 0, 0]), 0);
  assert.equal(roomU(byId.corridor_fore, [-10, 0, 5]), 14);
  assert.equal(roomU(byId.engineering, [-28, 5.5, 0]), 0);
  assert.equal(roomU(byId.lounge, [-28, 3, 5]), 8);
});

test('windows lie on the hull surface, and the tines share the main hull\'s section where they join', () => {
  for (const w of ship.windows) {
    const quads = windowQuads(ship, w, 1);
    assert.ok(quads.length > 0, w.id);
    if (w.cap) continue;
    for (const q of quads) {
      // step across the pane along its own normal: one side is hull, the other is space
      const u = q[1].map((v, i) => v - q[0][i]), v = q[3].map((x, i) => x - q[0][i]);
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(...n);
      const c = [0, 1, 2].map((i) => (q[0][i] + q[1][i] + q[2][i] + q[3][i]) / 4);
      const a = insideHull(ship, ...c.map((x, i) => x + (n[i] / l) * 0.25));
      const b = insideHull(ship, ...c.map((x, i) => x - (n[i] / l) * 0.25));
      assert.notEqual(a, b, `${w.id} does not sit on the skin`);
    }
  }
  const main = hullParts(ship).find((p) => p.id === 'main');
  const tine = hullParts(ship).find((p) => p.id === 'prong_s');
  const m = station(main.stations, 52), t = station(tine.stations, 52);
  assert.equal(m.zt, t.zt);
  assert.ok(Math.abs(m.b - (t.yc + t.b)) < 0.05, 'outer edges meet');
});
