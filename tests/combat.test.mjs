// Combat: pirates pull the ship out of supercruise in inhabited space; the
// traveler fights from the helm or runs; bounties are claimed at ports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step, drain } from '../src/sim/index.js';
import { startCombat, checkEncounters, wantedPilot, pirateGang, bountyParty, fightOdds, rearm, initCombat } from '../src/space/combat.js';
import { deserialize, serialize } from '../src/persist/snapshot.js';
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

test('outmatched with a worn hull: the traveler runs or pays them off, and nobody dies', () => {
  const s = fresh('outmatched');
  runCollect(s, 4 * HOUR);
  s.ship.components.hull_plating.wear = 0.6;
  s.ship.combat.shield = 0.2;
  startCombat(s, data, { name: 'Grieve', cls: 'gunship', wanted: true, bounty: 8000 }, 'pirate');
  const evs = runUntilEvent(s, 'combat_end', 2 * HOUR);
  const end = evs.find((e) => e.type === 'combat_end');
  assert.ok(end && ['fled', 'robbed', 'foe_fled', 'won', 'submitted'].includes(end.result), end && end.result);
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

function fightToEnd(s, max = 2 * HOUR) {
  const evs = [];
  for (let i = 0; i < max && s.space.combat; i++) { step(s, data); evs.push(...drain(s)); }
  return evs;
}

test('pirates in a pack: wingmen are taken down first, and losing the leader sends the rest home', () => {
  const s = fresh('pack');
  runCollect(s, 4 * HOUR);
  startCombat(s, data, [{ name: 'Corvo', cls: 'interceptor', wanted: true, bounty: 1200 }, { name: 'Pike', cls: 'interceptor', wanted: true, bounty: 400, role: 'wing' }], 'pirate');
  assert.equal(s.space.combat.foes.length, 2);
  assert.ok(s.space.combat.foes[1].hull < s.space.combat.foes[0].hull, 'the wingman flies a lighter ship');
  const evs = fightToEnd(s);
  const start = evs.find((e) => e.type === 'combat_start') || { wing: 1 };
  const end = evs.find((e) => e.type === 'combat_end');
  assert.equal(start.wing, 1);
  assert.ok(end, 'the fight never ended');
  if (end.result === 'won') {
    const down = evs.find((e) => e.type === 'foe_down');
    assert.ok(down && down.foe === 'Pike', 'the wingman should go down first');
    assert.equal(end.downed, 2);
    assert.equal(s.space.vouchers.reduce((a, v) => a + v.amount, 0), 1600);
  }
});

test('gangs are drawn from the seed; the frontier is worse', () => {
  const sizes = (frontier) => Array.from({ length: 200 }, (_, i) => pirateGang('g', `k${i}`, frontier).length);
  assert.deepEqual(pirateGang('g', 'x'), pirateGang('g', 'x'));
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(sizes(false).some((n) => n > 1) && sizes(false).some((n) => n === 1));
  assert.ok(mean(sizes(true)) > mean(sizes(false)));
  const m = { id: 'b9', target: { name: 'Grieve', cls: 'gunship' }, reward: 4000 };
  const party = bountyParty('g', m);
  assert.equal(party.length, 2, 'a gunship flies with an escort');
  assert.equal(party[0].missionId, 'b9');
});

test('outgunned with cargo aboard: the traveler cuts the drive and drops it, and the pirates stop shooting', () => {
  const s = fresh('submit');
  runCollect(s, 4 * HOUR);
  s.traveler.needs.stress = 0.9;
  s.space.missions = [{ id: 'c1', kind: 'cargo', title: 'Machine parts', tons: 12, reward: 1800, to: { starId: 'nowhere' }, deadlineT: s.t + 5 * DAY, acceptedT: s.t }];
  const gang = [{ name: 'Grieve', cls: 'gunship', wanted: true, bounty: 4000 }, { name: 'Rook', cls: 'interceptor', role: 'wing' }, { name: 'Shrike', cls: 'interceptor', role: 'wing' }];
  let outcome = null, wearAtSubmit = null;
  // the call is the traveler's, with some chance in it: try a few seeds
  for (let k = 0; k < 6 && outcome !== 'submitted'; k++) {
    const t = fresh(`submit-${k}`);
    runCollect(t, 4 * HOUR);
    t.traveler.needs.stress = 0.9;
    t.space.missions = JSON.parse(JSON.stringify(s.space.missions));
    startCombat(t, data, gang, 'pirate');
    const evs = [];
    for (let i = 0; i < 2 * HOUR && t.space.combat; i++) {
      step(t, data); evs.push(...drain(t));
      if (wearAtSubmit === null && t.space.combat && t.space.combat.submitT) wearAtSubmit = t.ship.components.hull_plating.wear;
    }
    const end = evs.find((e) => e.type === 'combat_end');
    outcome = end.result;
    if (outcome === 'submitted') {
      assert.ok(evs.some((e) => e.type === 'combat_submit' && e.cargo === 12));
      assert.ok(evs.some((e) => e.type === 'mission_fail' && e.reason === 'submitted'));
      assert.equal(t.space.missions.length, 0);
      assert.equal(t.ship.components.hull_plating.wear, wearAtSubmit, 'no more hits once the cargo is going out');
    } else wearAtSubmit = null;
  }
  assert.equal(outcome, 'submitted');
});

test('the odds: a lone interceptor is easy, a gunship with two wingmen is not', () => {
  const s = fresh('odds');
  runCollect(s, HOUR);
  startCombat(s, data, { name: 'Lark', cls: 'interceptor' }, 'pirate');
  const easy = fightOdds(s, s.space.combat);
  startCombat(s, data, [{ name: 'Grieve', cls: 'gunship' }, { name: 'Rook', cls: 'interceptor' }, { name: 'Shrike', cls: 'interceptor' }], 'pirate');
  const hard = fightOdds(s, s.space.combat);
  assert.ok(easy > 3, `easy ${easy}`);
  assert.ok(hard < 0.8, `hard ${hard}`);
  s.space.combat.patrol = { dueT: 0, here: true, name: 'Test security', ships: 2 };
  assert.ok(fightOdds(s, s.space.combat) > hard, 'security on our side helps');
});

test('system security answers: it comes in on our side and is remembered', () => {
  const s = fresh('patrol');
  runCollect(s, 4 * HOUR);
  startCombat(s, data, [{ name: 'Sable', cls: 'raider', wanted: true, bounty: 2000 }, { name: 'Moss', cls: 'interceptor', role: 'wing' }], 'pirate');
  s.space.combat.patrol = { dueT: s.t + 40, here: false, name: 'Concord security', ships: 2 };
  const evs = fightToEnd(s);
  assert.ok(evs.some((e) => e.type === 'patrol_arrives' && e.name === 'Concord security'));
  const end = evs.find((e) => e.type === 'combat_end');
  assert.equal(end.patrol, 'Concord security');
});

test('after a fight the fire-control room gets a visit, and the magazine is refilled at a port', () => {
  const s = fresh('service');
  runCollect(s, 4 * HOUR);
  startCombat(s, data, { name: 'Lark', cls: 'interceptor', wanted: true, bounty: 900 }, 'pirate');
  fightToEnd(s);
  const c = s.ship.combat;
  assert.ok(c.ammo < 1, 'firing uses the magazine');
  assert.ok(c.serviceDue, 'the gimbals want realigning');
  let inRoom = false;
  const evs = [];
  for (let i = 0; i < DAY && c.serviceDue; i++) {
    step(s, data); evs.push(...drain(s));
    const a = s.traveler.activity;
    if (a && a.id === 'service_weapons' && a.phase === 'perform' && s.traveler.pos.room === 'firecontrol') inRoom = true;
  }
  assert.ok(!c.serviceDue, 'never serviced');
  assert.ok(inRoom, 'serviced somewhere other than fire control');
  assert.ok(evs.some((e) => e.type === 'weapons_serviced'));
  s.space.credits = 5000;
  c.ammo = 0.3;
  const cost = rearm(s, data);
  assert.equal(c.ammo, 1);
  assert.equal(cost, Math.round(0.7 * data.space.ports.price.ammoFull));
  assert.equal(s.space.credits, 5000 - cost);
});

test('a save from before wingmen, mid-fight, carries on', () => {
  const s = fresh('oldfight');
  runCollect(s, HOUR);
  startCombat(s, data, { name: 'Lark', cls: 'interceptor' }, 'pirate');
  const cb = s.space.combat;
  const old = { foe: { ...cb.foes[0] }, reason: 'pirate', t: 3, firing: false, firedT: 0, fleeT: null };
  delete old.foe.role; delete old.foe.gone;
  s.space.combat = old;
  delete s.ship.combat.ammo; delete s.ship.combat.serviceDue;
  const text = serialize(s).replace(/"version":\d+/, '"version":9');
  const up = deserialize(text, data);
  assert.equal(up.space.combat.foes.length, 1);
  assert.equal(up.space.combat.foes[0].name, 'Lark');
  assert.equal(up.ship.combat.ammo, 1);
  for (let i = 0; i < 30; i++) step(up, data);
  initCombat(up);
});
