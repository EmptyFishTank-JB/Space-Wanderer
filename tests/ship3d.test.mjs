// The proposed 3D arrangement (data/ship3d.json) must stay consistent with the
// sim's room graph (data/ship.json): every compartment placed at the sim's
// length, no overlaps, nothing outside the hull, every hatch on both walls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkArrangement, proposedChanges, station, insideHull, roomU, profile } from '../src/ship3d/geometry.js';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url)));
const ship = load('data/ship3d.json');
const sim = load('data/ship.json');

test('the proposed arrangement is consistent with the sim room graph', () => {
  const report = checkArrangement(ship, sim);
  assert.deepEqual(report.problems, []);
  assert.equal(report.hatches.length, sim.hatches.length);
  for (const h of report.hatches) {
    assert.ok(h.uA >= 0 && h.uB >= 0, `${h.id} has a negative door position`);
  }
});

test('door changes are reported only beyond the tolerance', () => {
  const report = checkArrangement(ship, sim);
  for (const c of proposedChanges(report)) assert.ok(Math.abs(c.to - c.from) > 0.6, `${c.hatch} ${c.room}`);
});

test('hull stations interpolate and bound the hull', () => {
  const st = station(ship.hull.main, 26);
  assert.ok(st.b > 8.2 && st.b < 13);
  assert.equal(station(ship.hull.main, 60), null);
  assert.ok(insideHull(ship, 0, 0, 1));
  assert.ok(!insideHull(ship, 0, 0, 20));
  assert.ok(insideHull(ship, 34, 0, 5.5), 'the bridge sits inside the head superstructure');
  assert.equal(profile('main', st).length, 8);
});

test('room-local coordinates follow each room axis', () => {
  const byId = Object.fromEntries(ship.rooms.map((r) => [r.id, r]));
  assert.equal(roomU(byId.bridge, [33, -4.5, 4]), 0);
  assert.equal(roomU(byId.corridor_aft, [18, 0, 0]), 0);
  assert.equal(roomU(byId.engineering, [-5, 5.5, 0]), 0);
  assert.equal(roomU(byId.lounge, [30, -3, 4]), 8);
});
