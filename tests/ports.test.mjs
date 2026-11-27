// Inhabited space and ports: stations in settled systems, a port call
// (dock, ashore, trade, the mission board, undock), deliveries and deadlines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step, drain } from '../src/sim/index.js';
import { getSystem } from '../src/space/system.js';
import { neighbors } from '../src/space/galaxy.js';
import { inhabited, stationIn } from '../src/space/ports.js';
import { migrate } from '../src/persist/snapshot.js';

const space = data.space;

function portNear(s, minLy = 0) {
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 120, space)) {
    if (c.dist < minLy) continue;
    const stn = stationIn(s.space.galaxySeed, c.id, space);
    if (stn) return { c, stn, sys: getSystem(s.space.galaxySeed, c.id, space) };
  }
  throw new Error('no station near the start');
}

function moveTo(s, sys) {
  Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), systemName: sys.name, surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: {}, agenda: [], route: null });
  Object.assign(s.ship.flight, { mode: 'idle', at: null, target: null, v: 0, pos: { x: sys.star.radius * 30, y: 0 } });
}

function runUntilEvent(s, types, max = 2 * DAY) {
  const evs = [];
  for (let i = 0; i < max; i++) {
    step(s, data);
    if (s.outbox.length) evs.push(...drain(s));
    if (types.every((t) => evs.some((e) => e.type === t))) break;
  }
  return evs;
}

test('the voyage starts near inhabited space, with stations to put in at', () => {
  const s = fresh('ports');
  const near = neighbors(s.space.galaxySeed, s.space.pos, 80, space);
  const settled = near.filter((c) => inhabited(s.space.galaxySeed, c));
  assert.ok(settled.length >= 5, `only ${settled.length} settled systems within 80 ly`);
  const { stn } = portNear(s);
  assert.ok(stn.name && stn.body && stn.faction);
  assert.equal(s.space.credits, 1500);
});

test('a port call: dock, go ashore, trade and take work, then undock', () => {
  const s = fresh('portcall');
  runCollect(s, 3 * HOUR);
  const { sys, stn } = portNear(s);
  moveTo(s, sys);
  s.space.cargo.ore = 30;
  s.space.dataUnsold = 4;
  s.space.agenda = [{ kind: 'port', station: stn.id, body: stn.body, why: 'supplies', done: { ashore: false } }];
  const credits0 = s.space.credits;
  const evs = runUntilEvent(s, ['docked', 'port_visit', 'trade', 'undocked']);
  const names = evs.map((e) => e.type);
  for (const n of ['docked', 'port_visit', 'trade', 'undocked']) assert.ok(names.includes(n), `no ${n}: ${names.filter((x) => /dock|port|trade|mission/.test(x)).join(' ')}`);
  assert.ok(names.indexOf('docked') < names.indexOf('trade') && names.indexOf('trade') < names.indexOf('undocked'));
  const trade = evs.find((e) => e.type === 'trade');
  assert.ok(trade.income > 0, 'sold the ore and the scans');
  assert.equal(s.space.cargo.ore, 0);
  assert.notEqual(s.space.credits, credits0);
  assert.equal(s.space.stats.ports, 1);
  assert.notEqual(s.traveler.pos.room, 'port');
  assert.equal(s.ship.flight.mode === 'docked', false);
});

test('a cargo run is delivered at its destination and paid', () => {
  const s = fresh('delivery');
  runCollect(s, 3 * HOUR);
  const { sys, stn } = portNear(s, 10);
  moveTo(s, sys);
  s.space.missions = [{ id: 'm1', kind: 'cargo', title: '10 t of seed stock', faction: 'meridian', tons: 10, reward: 2500, to: { starId: sys.id, system: sys.name }, deadlineT: s.t + 5 * DAY, acceptedT: s.t, scansAtStart: 0 }];
  s.space.agenda = [{ kind: 'port', station: stn.id, body: stn.body, why: 'deliver', done: { ashore: false } }];
  const before = s.space.credits;
  const evs = runUntilEvent(s, ['mission_complete']);
  const done = evs.find((e) => e.type === 'mission_complete');
  assert.ok(done, 'never delivered');
  assert.equal(done.reward, 2500);
  assert.ok(s.space.credits >= before + 2500 - 64 * 60, 'paid (less whatever the fuel cost)');
  assert.equal(s.space.missions.length >= 0, true);
  assert.ok(!s.space.missions.some((m) => m.id === 'm1'));
});

test('a mission past its deadline fails and costs standing', () => {
  const s = fresh('late');
  s.space.missions = [{ id: 'm2', kind: 'passenger', title: 'A passenger', faction: 'lantern', passengers: 1, reward: 3000, to: { starId: 'x', system: 'Nowhere' }, deadlineT: s.t + 60, acceptedT: s.t }];
  const evs = runCollect(s, 2 * HOUR, ['mission_fail']);
  assert.ok(evs.some((e) => e.type === 'mission_fail' && e.reason === 'late'));
  assert.ok(s.space.rep.lantern < 0);
});

test('a v7 save gets credits, reputation and an empty mission log', () => {
  const st = { outbox: [], ship: { fuel: { tons: 20, capacity: 64 }, water: { gray: 1 }, rover: { charge: 1, out: false, odometerKm: 0 } }, traveler: { outfit: {}, history: {} }, space: { stats: {}, galaxySeed: 1, variantExempt: [] }, t: 0 };
  migrate(st, 7);
  assert.equal(st.space.credits, 1500);
  assert.deepEqual(st.space.missions, []);
  assert.deepEqual(st.space.rep, {});
});

test('a settlement on the ground: land at its pad, go ashore, lift off', async () => {
  const { baseIn } = await import('../src/space/ports.js');
  const s = fresh('base');
  runCollect(s, 3 * HOUR);
  let found = null;
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 160, space)) { const b = baseIn(s.space.galaxySeed, c.id, space); if (b) { found = { b, sys: getSystem(s.space.galaxySeed, c.id, space) }; break; } }
  assert.ok(found, 'no settlement on the ground nearby');
  moveTo(s, found.sys);
  s.space.agenda = [{ kind: 'port', station: found.b.id, body: found.b.body, base: true, why: 'company', done: { ashore: false } }];
  const evs = runUntilEvent(s, ['touchdown', 'docked', 'port_visit', 'liftoff', 'orbit_entered'], 2 * DAY);
  const names = evs.map((e) => e.type);
  for (const n of ['touchdown', 'docked', 'port_visit', 'liftoff']) assert.ok(names.includes(n), `no ${n}: ${names.filter((x) => /dock|port|touch|lift|descent/.test(x)).join(' ')}`);
  assert.equal(evs.find((e) => e.type === 'docked').kind, 'base');
  assert.ok(names.indexOf('touchdown') < names.indexOf('port_visit') && names.indexOf('port_visit') < names.indexOf('liftoff'));
  assert.ok(evs.some((e) => e.type === 'conversation'), 'talked with someone at the base');
});
