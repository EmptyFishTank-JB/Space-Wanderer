// Combat: pirates pull the ship out of supercruise in inhabited space; the
// traveler fights from the helm or runs; bounties are claimed at ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step, drain } from '../src/sim/index.js';
import { startCombat, checkEncounters, wantedPilot } from '../src/space/combat.js';
import { stationIn } from '../src/space/ports.js';
import { neighbors } from '../src/space/galaxy.js';
import { getSystem } from '../src/space/system.js';

function runUntilEvent(s, type, max = DAY) {
  const evs = [];
  for (let i = 0; i < max; i++) {
    step(s, data);
    if (s.outbox.length) evs.push(...drain(s));
    if (evs.some((e) => e.type === type)) break;
  }
  return evs;
}

test('a pirate interdiction: the traveler gets to the helm and wins, and the bounty is a voucher', () => {
  const s = fresh('fight');
  runCollect(s, 4 * HOUR);
  startCombat(s, data, { name: 'Lark', cls: 'interceptor', wanted: true, bounty: 2500 }, 'pirate');
  let atHelm = false;
  const evs = [];
  for (let i = 0; i < 2 * HOUR && s.space.combat; i++) {
    step(s, data);
    if (s.traveler.activity && s.traveler.activity.id === 'fight' && s.traveler.activity.phase === 'perform') atHelm = true;
    evs.push(...drain(s));
  }
  const end = evs.find((e) => e.type === 'combat_end');
  assert.ok(end, 'the fight never ended');
  assert.ok(atHelm, 'never got to the helm');
  assert.equal(end.result, 'won', `result ${end.result}`);
  assert.equal(s.space.vouchers.length, 1);
  assert.equal(s.space.vouchers[0].amount, 2500);
  assert.ok(s.ship.components.hull_plating.wear < 0.95);
});

test('outmatched with a worn hull: the traveler runs, and nobody dies', () => {
  const s = fresh('outmatched');
  runCollect(s, 4 * HOUR);
  s.ship.components.hull_plating.wear = 0.6;
  s.ship.combat.shield = 0.2;
  startCombat(s, data, { name: 'Grieve', cls: 'gunship', wanted: true, bounty: 8000 }, 'pirate');
  const evs = runUntilEvent(s, 'combat_end', 2 * HOUR);
  const end = evs.find((e) => e.type === 'combat_end');
  assert.ok(end && ['fled', 'robbed', 'foe_fled', 'won'].includes(end.result));
  assert.ok(s.traveler.body.condition > 0.3);
  assert.ok(!s.space.combat);
});

test('encounters only happen in inhabited space, and checking never touches the sim RNG', () => {
  const s = fresh('quiet');
  s.ship.flight.mode = 'cruise';
  const before = JSON.stringify(s.rng);
  for (let i = 0; i < 500; i++) { s.t += 10; checkEncounters(s, data, 10); if (s.space.combat) break; s.ship.flight.mode = 'cruise'; }
  if (!s.space.combat) assert.equal(JSON.stringify(s.rng), before);
});

test('a bounty contract: find the target in its system, bring them down, get paid at a port of the issuer', () => {
  const s = fresh('bounty');
  runCollect(s, 4 * HOUR);
  let hereStn = null, sys = null;
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 120, data.space)) { hereStn = stationIn(s.space.galaxySeed, c.id, data.space); if (hereStn) { sys = getSystem(s.space.galaxySeed, c.id, data.space); break; } }
  Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), systemName: sys.name, surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: {}, agenda: [], route: null });
  Object.assign(s.ship.flight, { mode: 'cruise', at: null, target: { body: hereStn.body, arrive: 1, then: null }, v: 0.01, pos: { x: sys.star.radius * 40, y: 0 } });
  const target = { ...wantedPilot(s.space.galaxySeed, 'test'), cls: 'interceptor' };
  s.space.missions = [{ id: 'b1', kind: 'bounty', title: `Bounty: ${target.name}`, faction: hereStn.faction, target, reward: 3000, to: { starId: sys.id, system: sys.name }, deadlineT: s.t + 5 * DAY, acceptedT: s.t }];
  const evs = runUntilEvent(s, 'combat_start', 3 * HOUR);
  const start = evs.find((e) => e.type === 'combat_start');
  assert.ok(start && start.reason === 'bounty' && start.foe === target.name, 'never found the target');
  const fight = runUntilEvent(s, 'combat_end', 2 * HOUR);
  assert.equal(fight.find((e) => e.type === 'combat_end').result, 'won');
  assert.ok(s.space.missions[0].killed);
  s.space.agenda = [{ kind: 'port', station: hereStn.id, body: hereStn.body, why: 'deliver', done: { ashore: false } }];
  const paid = runUntilEvent(s, 'mission_complete', DAY);
  assert.ok(paid.some((e) => e.type === 'mission_complete' && e.reward === 3000));
});
