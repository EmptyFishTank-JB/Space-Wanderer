// Rover outings: after the first walk round a landed ship, the traveler takes
// the rover out to sites a walk can't reach, samples on foot at each, and
// drives home before lifting off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step, drain } from '../src/sim/index.js';
import { getSystem } from '../src/space/system.js';
import { neighbors } from '../src/space/galaxy.js';
import { roverCanDrive, roverOutingsFor } from '../src/space/rover.js';
import { migrate } from '../src/persist/snapshot.js';

const space = data.space;

function drivableNearStart(s) {
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 160, space)) {
    const sys = getSystem(s.space.galaxySeed, c.id, space);
    const b = sys.bodies.find((x) => x.kind === 'planet' && roverCanDrive(data, x) && x.gravity > 0.2 && x.gravity < 1.4 && x.a < 3000);
    if (b) return { sys, b };
  }
  throw new Error('no drivable body nearby');
}

test('a landed visit takes the rover out after the first walk, then lifts off', () => {
  const s = fresh('rover');
  runCollect(s, 3 * HOUR);
  const { sys, b } = drivableNearStart(s);
  Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: {}, agenda: [] });
  Object.assign(s.ship.flight, { mode: 'orbit', at: b.id, target: null, v: 0 });
  s.space.agenda = [{ kind: 'visit', body: b.id, land: true, eva: 1, rover: 1, lingerH: 0, done: { scanned: false, landed: false, evas: 0, rovers: 0, lingerUntil: null, leftSurface: false } }];
  const evs = [];
  let aboardSeen = false, onFootSeen = false, maxX = 0;
  for (let i = 0; i < 3 * DAY; i++) {
    step(s, data);
    const a = s.traveler.activity;
    if (a && a.id === 'rover_outing' && a.params.plan) {
      const p = a.params.plan;
      if (p.aboard) aboardSeen = true;
      if (p.site) onFootSeen = true;
      maxX = Math.max(maxX, p.x);
    }
    if (s.outbox.length) evs.push(...drain(s));
    if (evs.some((e) => e.type === 'orbit_entered' && e.fromSurface)) break;
  }
  const names = evs.map((e) => e.type).filter((t) => ['touchdown', 'eva_end', 'rover_out', 'rover_site', 'rover_end', 'liftoff'].includes(t));
  for (const n of ['touchdown', 'eva_end', 'rover_out', 'rover_site', 'rover_end', 'liftoff']) assert.ok(names.includes(n), `no ${n}: ${names.join(' ')}`);
  assert.ok(names.indexOf('eva_end') < names.indexOf('rover_out'), 'the walk comes first');
  assert.ok(names.indexOf('rover_end') < names.indexOf('liftoff'), 'home before liftoff');
  const end = evs.find((e) => e.type === 'rover_end');
  assert.ok(end.km > 1, `drove only ${end.km} km`);
  assert.ok(maxX > 1000, `never got more than ${Math.round(maxX)} m out`);
  assert.ok(aboardSeen && onFootSeen, 'drove and walked');
  assert.equal(s.ship.rover.out, false);
  assert.ok(s.ship.rover.odometerKm >= end.km);
  assert.ok(s.space.stats.rovers >= 1 && s.space.stats.roverKm >= end.km);
  assert.notEqual(s.traveler.pos.room, 'surface');
});

test('the rover needs some gravity and not too much; worlds worth the drive get one', () => {
  const g = data.space.rover.gravity;
  const base = { landable: true, kind: 'planet', signals: { geo: 1, bio: 0 }, rarity: 0, beauty: 0 };
  assert.ok(!roverCanDrive(data, { ...base, gravity: g[0] / 2 }));
  assert.ok(!roverCanDrive(data, { ...base, gravity: g[1] + 0.5 }));
  assert.ok(roverCanDrive(data, { ...base, gravity: 0.8 }));
  assert.equal(roverOutingsFor(data, { ...base, gravity: 0.8 }, true), 1);
  assert.equal(roverOutingsFor(data, { ...base, gravity: 0.8, signals: { geo: 0, bio: 0 } }, true), 0);
  assert.equal(roverOutingsFor(data, { ...base, gravity: 0.8 }, false), 0);
});

test('a v6 save gets 64 t tanks and a charged rover', () => {
  const st = { outbox: [], ship: { fuel: { tons: 20, capacity: 32 }, water: { gray: 1 } }, traveler: { outfit: {} }, space: null };
  migrate(st, 6);
  assert.equal(st.ship.fuel.capacity, 64);
  assert.equal(st.ship.fuel.tons, 20);
  assert.deepEqual(st.ship.rover, { charge: 1, out: false, odometerKm: 0 });
});
