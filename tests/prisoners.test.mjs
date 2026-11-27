// Prisoners: bounties that want the target alive. The drive shot out, the
// pilot brought aboard through the airlock (a sidearm from the armory first),
// walked to a brig cell, fed, and handed to security at one of the issuing
// faction's stations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step, drain } from '../src/sim/index.js';
import { startCombat, wantedPilot, bountyParty } from '../src/space/combat.js';
import { stationIn, makeOffers, chooseMissions, expireMissions } from '../src/space/ports.js';
import { takePrisoner, tickPrisoners, freeCells } from '../src/space/prisoners.js';
import { neighbors } from '../src/space/galaxy.js';
import { getSystem } from '../src/space/system.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';

/** Put the ship in a system with a station, cruising, with a contract on a target there. */
function stage(seed, { alive = true, cls = 'interceptor' } = {}) {
  const s = fresh(seed);
  runCollect(s, 4 * HOUR);
  let stn = null, sys = null;
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 120, data.space)) { stn = stationIn(s.space.galaxySeed, c.id, data.space); if (stn) { sys = getSystem(s.space.galaxySeed, c.id, data.space); break; } }
  Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), systemName: sys.name, surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: {}, agenda: [], route: null });
  Object.assign(s.ship.flight, { mode: 'cruise', at: null, target: { body: stn.body, arrive: 1, then: null }, v: 0.01, pos: { x: sys.star.radius * 40, y: 0 } });
  const target = { ...wantedPilot(s.space.galaxySeed, seed), cls };
  const m = { id: `b-${seed}`, kind: 'bounty', alive, title: `Wanted alive: ${target.name}`, faction: stn.faction, target, reward: 4000, to: { starId: sys.id, system: sys.name }, from: { starId: sys.id, station: stn.name }, deadlineT: s.t + 6 * DAY, acceptedT: s.t };
  s.space.missions = [m];
  return { s, stn, sys, m };
}

function runUntil(s, pred, max) {
  const evs = [];
  for (let i = 0; i < max; i++) { step(s, data); if (s.outbox.length) evs.push(...drain(s)); if (pred(s, evs)) break; }
  return evs;
}

test('wanted alive: the drive shot out, the pilot brought aboard, walked to the brig and fed', () => {
  // a disabled ship's reactor goes up now and then: try a few targets until one is taken alive
  let got = null;
  for (let k = 0; k < 6 && !got; k++) {
    const st = stage(`alive-${k}`);
    startCombat(st.s, data, bountyParty(st.s.space.galaxySeed, st.m), 'bounty');
    const evs = runUntil(st.s, (x) => !x.space.combat, 2 * HOUR);
    const end = evs.find((e) => e.type === 'combat_end');
    if (end && end.result === 'captured') got = { ...st, evs };
  }
  assert.ok(got, 'never took a target alive');
  const { s, m } = got;
  assert.ok(m.captured && !m.killed);
  assert.ok(got.evs.some((e) => e.type === 'foe_disabled'));
  assert.equal(s.space.prisoners.length, 1);
  const p = s.space.prisoners[0];
  assert.equal(p.name, m.target.name);
  assert.equal(p.state, 'alongside');
  // the boarding: the armory, the airlock, then walked through the ship to the cell
  const evs = runUntil(s, (x) => x.space.prisoners[0].state === 'held', 2 * HOUR);
  assert.equal(s.space.prisoners[0].state, 'held');
  assert.ok(evs.some((e) => e.type === 'prisoner_boarding'));
  assert.ok(evs.some((e) => e.type === 'prisoner_held'));
  const q = s.space.prisoners[0];
  assert.equal(q.pos.room, 'brig');
  assert.ok(['cell_1', 'cell_2'].includes(q.cell));
  assert.deepEqual(q.look.top, [204, 112, 48], 'brig-issue coveralls');
  // fed over the next day or so (the contract is with another faction, so they stay aboard)
  m.faction = 'elsewhere';
  const day = runCollect(s, 1.5 * DAY);
  const fed = day.filter((e) => e.type === 'prisoner_fed');
  assert.ok(fed.length >= 2, `fed ${fed.length} times`);
  assert.ok(fed.every((e) => e.line && e.line.startsWith(q.name)));
  assert.equal(s.space.prisoners.length, 1, 'still aboard: nobody here is paying for them');
});

test('the escort: the prisoner keeps a step behind the traveler all the way to the brig', () => {
  const { s, m } = stage('escort');
  takePrisoner(s, data, { name: m.target.name, cls: m.target.cls }, m);
  m.captured = true;
  const rooms = new Set();
  let maxGap = 0;
  for (let i = 0; i < 2 * HOUR && s.space.prisoners[0].state !== 'held'; i++) {
    step(s, data); drain(s);
    const p = s.space.prisoners[0];
    if (p.state === 'escorted') {
      rooms.add(p.pos.room);
      assert.equal(p.pos.room, s.traveler.pos.room);
      maxGap = Math.max(maxGap, Math.abs(p.pos.x - s.traveler.pos.x));
    }
    const a = s.traveler.activity;
    if (a && a.phase === 'perform') {
      if (a.id === 'arm_up') assert.equal(s.traveler.pos.room, 'armory');
      if (a.id === 'receive_prisoner') assert.equal(s.traveler.pos.room, 'airlock');
      if (a.id === 'lock_cell') assert.equal(s.traveler.pos.room, 'brig');
    }
  }
  assert.equal(s.space.prisoners[0].state, 'held');
  assert.ok(rooms.size >= 3, `walked through ${[...rooms].join(', ')}`);
  assert.ok(maxGap <= 1.0);
});

test('handed over at one of the issuer\'s stations: the full reward; a lapsed contract: for nothing', () => {
  const { s, stn, m } = stage('handover');
  takePrisoner(s, data, { name: m.target.name, cls: m.target.cls }, m);
  m.captured = true;
  runUntil(s, (x) => x.space.prisoners[0].state === 'held', 2 * HOUR);
  const credits = s.space.credits;
  s.space.agenda = [{ kind: 'port', station: stn.id, body: stn.body, why: 'deliver', done: { ashore: false } }];
  const evs = runUntil(s, (x, e) => e.some((y) => y.type === 'prisoner_handover'), DAY);
  const ho = evs.find((e) => e.type === 'prisoner_handover');
  assert.ok(ho && ho.paid === 4000 && ho.who === m.target.name);
  assert.ok(evs.some((e) => e.type === 'mission_complete' && e.reward === 4000));
  assert.equal(s.space.prisoners.length, 0);
  assert.ok(s.space.credits >= credits + 4000 - 3000, 'paid (less whatever the dock charged)');

  // a second prisoner, whose contract runs out on the way
  const t = stage('lapsed');
  takePrisoner(t.s, data, { name: t.m.target.name, cls: t.m.target.cls }, t.m);
  t.m.captured = true;
  runUntil(t.s, (x) => x.space.prisoners[0].state === 'held', 2 * HOUR);
  t.m.deadlineT = t.s.t - 1;
  expireMissions(t.s);
  assert.equal(t.s.space.missions.length, 0);
  assert.equal(t.s.space.prisoners.length, 1, 'still aboard after the contract lapsed');
  t.s.space.agenda = [{ kind: 'port', station: t.stn.id, body: t.stn.body, why: 'deliver', done: { ashore: false } }];
  const ev2 = runUntil(t.s, (x, e) => e.some((y) => y.type === 'prisoner_handover'), DAY);
  assert.equal(ev2.find((e) => e.type === 'prisoner_handover').paid, 0);
  assert.equal(t.s.space.prisoners.length, 0);
});

test('wanted alive but brought in dead: a third of the reward', () => {
  const { s, stn, m } = stage('dead');
  m.killed = true; m.aliveLost = true;
  s.space.agenda = [{ kind: 'port', station: stn.id, body: stn.body, why: 'deliver', done: { ashore: false } }];
  const evs = runUntil(s, (x, e) => e.some((y) => y.type === 'mission_complete'), DAY);
  assert.equal(evs.find((e) => e.type === 'mission_complete').reward, Math.round((4000 * 0.35) / 50) * 50);
});

test('the board: some bounties want the target alive, for more; none taken without a free cell', () => {
  const { s, stn } = stage('board');
  let alive = 0, all = 0;
  for (let d = 0; d < 60; d++) {
    s.t += DAY;
    for (const o of makeOffers(s, data, stn).list) if (o.kind === 'bounty') { all++; if (o.alive) { alive++; assert.ok(o.title.startsWith('Wanted alive')); } }
  }
  assert.ok(all > 5 && alive > 0 && alive < all, `${alive} of ${all}`);
  // both cells full: an alive contract is passed over
  s.space.missions = [];
  for (let i = 0; i < 2; i++) takePrisoner(s, data, { name: `P${i}`, cls: 'raider' }, null);
  assert.equal(freeCells(s), 0);
  s.space.credits = 0;
  s.space.offers = { station: stn.id, day: 0, list: [{ id: 'x', kind: 'bounty', alive: true, faction: stn.faction, target: { name: 'Z', cls: 'interceptor' }, reward: 90000, to: { starId: 'n', system: 'N' }, from: { starId: 'n', station: 'S' }, deadlineT: s.t + DAY, title: 'Wanted alive: Z' }] };
  assert.equal(chooseMissions(s, data).length, 0);
});

test('a cell day comes from the clock, not the sim RNG; a late meal gets a complaint', () => {
  const { s, m } = stage('cellday');
  takePrisoner(s, data, { name: m.target.name, cls: m.target.cls }, m);
  const p = s.space.prisoners[0];
  p.state = 'held'; p.pos = { room: 'brig', x: 2 };
  p.lastMealT = s.t - 15 * HOUR;
  s.t = Math.ceil(s.t / DAY) * DAY + 12 * HOUR; // midday
  const before = JSON.stringify(s.rng);
  drain(s);
  tickPrisoners(s, data);
  assert.equal(JSON.stringify(s.rng), before);
  assert.ok(drain(s).some((e) => e.type === 'prisoner_hungry'));
  assert.notEqual(p.doing, 'asleep');
});

test('a save from before the brig loads with an empty one', () => {
  const s = fresh('oldbrig');
  runCollect(s, HOUR);
  delete s.space.prisoners;
  const up = deserialize(serialize(s).replace(/"version":\d+/, '"version":10'), data);
  assert.deepEqual(up.space.prisoners, []);
});
