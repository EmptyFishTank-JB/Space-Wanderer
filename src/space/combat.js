// Combat, first version. In inhabited space a pirate can pull the ship out
// of supercruise (likelier with cargo aboard, much likelier when smuggling,
// likelier on the frontier); a bounty contract sends the traveler after a
// named pilot. The fight runs second by second: the traveler at the helm,
// six hardpoints against the foe's shield and hull, our shield taking hits
// until it collapses and has to reboot, the guns adding heat. The traveler
// runs for it with the jump drive when outmatched. The worst that happens is
// losing the cargo, never the traveler.
import { hrng, starById } from './galaxy.js';
import { rand, range, chance, pick } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { emit } from '../sim/events.js';
import { inhabited, factionName } from './ports.js';

const CLASSES = {
  interceptor: { label: 'interceptor', dps: 0.007, shield: 0.8, hull: 0.7, bounty: [800, 1800] },
  gunship: { label: 'gunship', dps: 0.016, shield: 1.4, hull: 1.3, bounty: [2000, 4500] },
  raider: { label: 'raider', dps: 0.010, shield: 1.0, hull: 0.9, bounty: [1200, 2800] },
};
const SHIELD_MAX = 1.5; // a big ship's shield
const CALLSIGNS = ['Kestrel', 'Hollow Jack', 'Saint Vane', 'the Magpie', 'Red Tally', 'Corvo', 'Lark', 'the Widow', 'Grieve', 'Halloran', 'Sable', 'Tenpenny'];

export function initCombat(state) {
  const sh = state.ship;
  if (!sh.combat) sh.combat = { shield: SHIELD_MAX, down: false, rebootT: null, hitT: null };
  if (state.space && !state.space.vouchers) state.space.vouchers = [];
}

/** A named pilot with a price on their head. */
export function wantedPilot(seed, key) {
  const st = hrng(seed, 'wanted', key);
  const cls = pick(st, ['interceptor', 'raider', 'gunship']);
  return { name: pick(st, CALLSIGNS), cls, bounty: Math.round(range(st, ...CLASSES[cls].bounty) / 50) * 50 };
}

export function startCombat(state, data, foe, reason) {
  const f = state.ship.flight;
  initCombat(state);
  const c = CLASSES[foe.cls];
  state.space.combat = { foe: { ...foe, shield: c.shield, hull: c.hull, dps: c.dps }, reason, t: 0, firing: false, firedT: 0, fleeT: null };
  // interdicted: dropped out of supercruise, the target lost
  if (f.mode === 'cruise') { f.mode = 'idle'; f.target = null; f.v = 0; }
  emit(state, 'combat_start', { foe: foe.name, cls: CLASSES[foe.cls].label, reason, wanted: !!foe.wanted, room: 'bridge' });
}

/** Chance of trouble while in supercruise in inhabited space; and a bounty target found. Per slow tick. */
export function checkEncounters(state, data, dt) {
  const sp = state.space, f = state.ship.flight;
  if (!sp || sp.combat || !['cruise', 'idle', 'orbit'].includes(f.mode)) return;
  initCombat(state);
  if (sp.combatCooldownT && state.t < sp.combatCooldownT) return; // a breather after a fight
  const star = starById(sp.galaxySeed, sp.systemId, data.space);
  const who = star && inhabited(sp.galaxySeed, star);
  // a bounty target in this system turns up within a few minutes of cruising
  // a bounty target turns up only while the traveler is awake and out looking
  const a = state.traveler.activity;
  const hunting = state.traveler.needs.fatigue < 0.75 && !(a && ['sleep', 'nap', 'doze'].includes(a.id));
  const hunt = hunting && (sp.missions || []).find((m) => m.kind === 'bounty' && m.to && m.to.starId === sp.systemId && !m.killed);
  // drawn from the clock, not the sim's RNG: cruising never shifts the rest of the story
  const roll = (tag) => rand(hrng(sp.galaxySeed, 'encounter', tag, sp.systemId, Math.floor(state.t / 10)));
  if (hunt && roll('hunt') < 0.03 * (dt / 10)) {
    startCombat(state, data, { name: hunt.target.name, cls: hunt.target.cls, wanted: true, bounty: hunt.reward, missionId: hunt.id }, 'bounty');
    return;
  }
  if (!who || f.mode !== 'cruise') return; // pirates only interdict in supercruise
  const cargo = (sp.missions || []).reduce((a, m) => a + (m.tons || 0), 0);
  const smuggling = (sp.missions || []).some((m) => m.kind === 'smuggle');
  const p = 0.00012 * (dt / 10) * (1 + cargo / 20) * (smuggling ? 2.5 : 1) * (who.outpost ? 1.6 : 1);
  if (roll('pirate') >= p) return;
  const foe = wantedPilot(sp.galaxySeed, `${sp.systemId}:${Math.floor(state.t / 3600)}`);
  startCombat(state, data, { ...foe, wanted: true }, 'pirate');
}

/** Per-second fight. The traveler's guns only fire once they are at the helm. */
export function stepCombat(state, data, dt) {
  const sp = state.space;
  const cb = sp && sp.combat;
  const sh = state.ship;
  initCombat(state);
  const ours = sh.combat;
  // the shield comes back on its own between fights
  if (!cb) {
    if (ours.down && state.t >= ours.rebootT) { ours.down = false; ours.shield = 0.4; emit(state, 'shield_online', { room: 'engineering' }); }
    if (!ours.down) ours.shield = Math.min(SHIELD_MAX, ours.shield + 0.003 * dt);
    return;
  }
  cb.t += dt;
  const foe = cb.foe;
  const tr = state.traveler;
  const a = tr.activity;
  cb.firing = !!(a && a.id === 'fight' && a.phase === 'perform');
  // our fire: six hardpoints, steadier hands when rested, weaker when the ship is hot
  if (cb.firing && !cb.fleeT) {
    const aim = 0.75 + 0.25 * (1 - tr.needs.fatigue) - 0.2 * Math.max(0, tr.needs.stress - 0.6);
    cb.firedT += dt;
    let dmg = 0.02 * aim * dt * (sh.thermal.heat > 0.95 ? 0.4 : 1);
    if (foe.shield > 0) { const s = Math.min(foe.shield, dmg); foe.shield -= s; dmg -= s; }
    foe.hull -= dmg * 0.9;
    sh.thermal.heat = clamp(sh.thermal.heat + 0.0012 * dt, 0, 1.2);
  }
  // their fire: the shield first, then the plating and, now and then, something that matters
  let hit = foe.dps * dt * range(state.rng, 0.6, 1.3);
  if (!ours.down) {
    const s = Math.min(ours.shield, hit);
    ours.shield -= s; hit -= s;
    ours.hitT = state.t;
    if (ours.shield <= 0.001) {
      ours.down = true; ours.rebootT = state.t + range(state.rng, 120, 200);
      emit(state, 'shield_down', { foe: foe.name, room: 'bridge' });
      tr.needs.stress = clamp(tr.needs.stress + 0.15);
    }
  }
  if (hit > 0) {
    const C = sh.components;
    C.hull_plating.wear = clamp(C.hull_plating.wear + hit * 0.55);
    if (chance(state.rng, hit * 2)) { const id = pick(state.rng, ['thermal_vents', 'bridge_sensors', 'drive_coil', 'scoop_manifold']); C[id].wear = clamp(C[id].wear + 0.05); }
  }
  if (ours.down && state.t >= ours.rebootT) { ours.down = false; ours.shield = 0.25; emit(state, 'shield_online', { room: 'engineering' }); }
  // the outcomes
  if (foe.hull <= 0) return endCombat(state, data, 'won');
  if (foe.hull < 0.2 && foe.shield <= 0 && chance(state.rng, 0.02 * dt)) return endCombat(state, data, 'foe_fled');
  const wear = sh.components.hull_plating.wear;
  if (!cb.fleeT && (wear > 0.72 || (ours.down && foe.hull > 0.6 && cb.firedT > 60))) {
    cb.fleeT = state.t + data.space.drive.chargeSeconds; // spool the jump drive and run
    emit(state, 'combat_flee', { foe: foe.name, room: 'bridge' });
  }
  if (cb.fleeT && state.t >= cb.fleeT) return endCombat(state, data, wear > 0.9 ? 'robbed' : 'fled');
  if (wear >= 0.95) return endCombat(state, data, 'robbed');
}

function endCombat(state, data, result) {
  const sp = state.space, cb = sp.combat, foe = cb.foe;
  sp.combat = null;
  const tr = state.traveler;
  let bounty = 0;
  if (result === 'won' && foe.wanted) {
    bounty = foe.bounty || 0;
    const m = foe.missionId && sp.missions.find((x) => x.id === foe.missionId);
    if (m) { m.killed = true; }
    else if (bounty) sp.vouchers.push({ amount: bounty, foe: foe.name, t: state.t });
  }
  if (result === 'robbed') {
    // they take the cargo and go; any mission that needed it is lost
    for (const m of sp.missions.filter((x) => x.tons)) { sp.missions = sp.missions.filter((x) => x !== m); sp.stats.missionsFailed = (sp.stats.missionsFailed || 0) + 1; emit(state, 'mission_fail', { kind: m.kind, title: m.title, reason: 'robbed', room: 'bridge' }); }
  }
  // a bounty run from twice is given up
  if (foe.missionId && (result === 'fled' || result === 'robbed')) {
    const m = sp.missions.find((x) => x.id === foe.missionId);
    if (m) {
      m.fled = (m.fled || 0) + 1;
      if (m.fled >= 2) { sp.missions = sp.missions.filter((x) => x !== m); sp.stats.missionsFailed = (sp.stats.missionsFailed || 0) + 1; emit(state, 'mission_fail', { kind: m.kind, title: m.title, reason: 'gave_up', room: 'bridge' }); }
    }
  }
  sp.combatCooldownT = state.t + (result === 'won' || result === 'foe_fled' ? 6 : 18) * 3600;
  sp.stats.fights = (sp.stats.fights || 0) + 1;
  if (result === 'won') { sp.stats.kills = (sp.stats.kills || 0) + 1; sp.lastKillT = state.t; }
  tr.needs.stress = clamp(tr.needs.stress + (result === 'won' ? 0.05 : 0.18));
  tr.needs.fatigue = clamp(tr.needs.fatigue + 0.08);
  emit(state, 'combat_end', { foe: foe.name, cls: CLASSES[foe.cls].label, result, bounty, room: 'bridge' });
}

/** At a port: cash in bounty vouchers. */
export function redeemVouchers(state) {
  const sp = state.space;
  if (!sp.vouchers || !sp.vouchers.length) return 0;
  const total = sp.vouchers.reduce((a, v) => a + v.amount, 0);
  sp.credits += total;
  sp.stats.earned = (sp.stats.earned || 0) + total;
  emit(state, 'bounty_paid', { amount: total, count: sp.vouchers.length, room: 'port' });
  sp.vouchers = [];
  return total;
}

export const combatClassLabel = (cls) => (CLASSES[cls] || { label: cls }).label;
export { factionName };
