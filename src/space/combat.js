// Combat. In inhabited space a pirate can pull the ship out of supercruise
// (likelier with cargo aboard, much likelier when smuggling, likelier on the
// frontier), sometimes with a wingman or two in lighter ships; a bounty
// contract sends the traveler after a named pilot, who may fly with an
// escort. The fight runs second by second: the traveler at the helm, six
// hardpoints fed from the magazine and laid by the fire-control computers,
// our shield taking hits until it collapses and has to reboot, the guns
// adding heat. In settled space the system's security may answer and fly in
// on our side. Outmatched, the traveler either spools the jump drive and runs
// or gives the pirates what they came for (the cargo, or a toll when the hold
// is empty). The worst that happens is losing the cargo, never the traveler.
// After a fight the fire-control room needs a visit: gimbals realigned,
// shield capacitors reseated.
// A contract that wants the target alive changes the end of it: once they're
// weak the traveler fires short bursts at the drive, and a ship with its
// drive shot out drifts alongside to be boarded (see prisoners.js).
import { hrng, starById } from './galaxy.js';
import { rand, range, chance, pick } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { emit } from '../sim/events.js';
import { inhabited, factionName } from './ports.js';
import { takePrisoner } from './prisoners.js';

const CLASSES = {
  interceptor: { label: 'interceptor', dps: 0.007, shield: 0.8, hull: 0.7, bounty: [800, 1800] },
  gunship: { label: 'gunship', dps: 0.016, shield: 1.4, hull: 1.3, bounty: [2000, 4500] },
  raider: { label: 'raider', dps: 0.010, shield: 1.0, hull: 0.9, bounty: [1200, 2800] },
};
export const SHIELD_MAX = 1.5; // a big ship's shield
const OUR_DPS = 0.02; // all six hardpoints, well laid
const PATROL_DPS = 0.012;
const AMMO_PER_S = 0.0012; // a full magazine is about fourteen minutes of firing
const WING_SCALE = 0.8; // a wingman flies a lighter ship than their leader
const DISABLE_AT = 0.12; // wanted alive: at this much hull, with the shield gone, their drive is out
const CAREFUL_BELOW = 0.4; // and below this the traveler stops shooting at the reactor
const CALLSIGNS = ['Kestrel', 'Hollow Jack', 'Saint Vane', 'the Magpie', 'Red Tally', 'Corvo', 'Lark', 'the Widow', 'Grieve', 'Halloran', 'Sable', 'Tenpenny'];
const WING_NAMES = ['Pike', 'Dace', 'Rook', 'Shrike', 'Tamsin', 'Okoro', 'Vell', 'Brannock', 'Moss', 'Quill'];

export function initCombat(state) {
  const sh = state.ship;
  if (!sh.combat) sh.combat = { shield: SHIELD_MAX, down: false, rebootT: null, hitT: null };
  const c = sh.combat;
  if (c.ammo === undefined) c.ammo = 1;
  if (c.serviceDue === undefined) c.serviceDue = false;
  const sp = state.space;
  if (sp && !sp.vouchers) sp.vouchers = [];
  // a save from before wingmen, caught mid-fight: one attacker
  const cb = sp && sp.combat;
  if (cb && cb.foe && !cb.foes) { cb.foes = [{ ...cb.foe, role: 'leader', gone: null }]; delete cb.foe; Object.assign(cb, { submitT: null, judged: false, patrol: null, target: 0 }); }
}

/** A named pilot with a price on their head. */
export function wantedPilot(seed, key) {
  const st = hrng(seed, 'wanted', key);
  const cls = pick(st, ['interceptor', 'raider', 'gunship']);
  return { name: pick(st, CALLSIGNS), cls, bounty: Math.round(range(st, ...CLASSES[cls].bounty) / 50) * 50 };
}

function wingmen(st, n, avoid) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = pick(st, WING_NAMES.filter((w) => w !== avoid && !out.some((x) => x.name === w)));
    out.push({ name, cls: 'interceptor', wanted: true, bounty: Math.round(range(st, 300, 700) / 50) * 50, role: 'wing' });
  }
  return out;
}

/** A pirate pack: the leader, and on a bad day one or two wingmen. Worse out on the frontier. */
export function pirateGang(seed, key, frontier = false) {
  const leader = { ...wantedPilot(seed, key), wanted: true };
  const st = hrng(seed, 'wing', key);
  const r = rand(st);
  const n = r < (frontier ? 0.4 : 0.55) ? 0 : r < (frontier ? 0.8 : 0.88) ? 1 : 2;
  return [leader, ...wingmen(st, n, leader.name)];
}

/** A bounty target and whoever flies with them: a gunship never travels alone, a raider sometimes has company. */
export function bountyParty(seed, m) {
  const st = hrng(seed, 'escort', m.id);
  const n = m.target.cls === 'gunship' ? 1 : m.target.cls === 'raider' && rand(st) < 0.4 ? 1 : 0;
  return [{ name: m.target.name, cls: m.target.cls, wanted: true, bounty: m.reward, missionId: m.id, alive: !!m.alive }, ...wingmen(st, n, m.target.name)];
}

/** Whether the system's security answers the call, and when it gets here. Only for pirates, only where someone keeps the peace. */
function patrolFor(state, data, reason) {
  const sp = state.space;
  if (reason !== 'pirate') return null;
  const star = starById(sp.galaxySeed, sp.systemId, data.space);
  const who = star && inhabited(sp.galaxySeed, star);
  if (!who) return null;
  const st = hrng(sp.galaxySeed, 'patrol', sp.systemId, Math.floor(state.t / 60));
  if (rand(st) > (who.outpost ? 0.15 : 0.5)) return null;
  return { dueT: state.t + range(st, 50, 160), here: false, name: `${factionName(who.faction)} security`, ships: who.outpost ? 1 : 2 };
}

export function startCombat(state, data, foes, reason) {
  const f = state.ship.flight;
  initCombat(state);
  const list = (Array.isArray(foes) ? foes : [foes]).map((x, i) => {
    const c = CLASSES[x.cls], k = i ? WING_SCALE : 1;
    return { ...x, role: i ? 'wing' : 'leader', shield: c.shield * k, hull: c.hull * k, dps: c.dps * k, gone: null };
  });
  state.space.combat = { foes: list, reason, t: 0, firing: false, firedT: 0, fleeT: null, submitT: null, toll: 0, judged: false, patrol: patrolFor(state, data, reason), target: 0 };
  // interdicted: dropped out of supercruise, the target lost
  if (f.mode === 'cruise') { f.mode = 'idle'; f.target = null; f.v = 0; }
  const lead = list[0];
  emit(state, 'combat_start', { foe: lead.name, cls: CLASSES[lead.cls].label, wing: list.length - 1, reason, wanted: !!lead.wanted, room: 'bridge' });
}

/** Chance of trouble while in supercruise in inhabited space; and a bounty target found. Per slow tick. */
export function checkEncounters(state, data, dt) {
  const sp = state.space, f = state.ship.flight;
  if (!sp || sp.combat || !['cruise', 'idle', 'orbit'].includes(f.mode)) return;
  initCombat(state);
  if (sp.combatCooldownT && state.t < sp.combatCooldownT) return; // a breather after a fight
  const star = starById(sp.galaxySeed, sp.systemId, data.space);
  const who = star && inhabited(sp.galaxySeed, star);
  // a bounty target turns up only while the traveler is awake and out looking
  const a = state.traveler.activity;
  const hunting = state.traveler.needs.fatigue < 0.75 && !(a && ['sleep', 'nap', 'doze'].includes(a.id));
  const hunt = hunting && (sp.missions || []).find((m) => m.kind === 'bounty' && m.to && m.to.starId === sp.systemId && !m.killed && !m.captured);
  // drawn from the clock, not the sim's RNG: cruising never shifts the rest of the story
  const roll = (tag) => rand(hrng(sp.galaxySeed, 'encounter', tag, sp.systemId, Math.floor(state.t / 10)));
  if (hunt && roll('hunt') < 0.03 * (dt / 10)) {
    startCombat(state, data, bountyParty(sp.galaxySeed, hunt), 'bounty');
    return;
  }
  if (!who || f.mode !== 'cruise') return; // pirates only interdict in supercruise
  const cargo = cargoTons(state);
  const smuggling = (sp.missions || []).some((m) => m.kind === 'smuggle');
  const p = 0.00012 * (dt / 10) * (1 + cargo / 20) * (smuggling ? 2.5 : 1) * (who.outpost ? 1.6 : 1);
  if (roll('pirate') >= p) return;
  startCombat(state, data, pirateGang(sp.galaxySeed, `${sp.systemId}:${Math.floor(state.t / 3600)}`, who.outpost), 'pirate');
}

const cargoTons = (state) => (state.space.missions || []).reduce((a, m) => a + (m.tons || 0), 0);
const living = (cb) => cb.foes.filter((x) => !x.gone);

/** Our guns' damage per second right now. */
function ourRate(state, cb) {
  const sh = state.ship, tr = state.traveler, ours = sh.combat;
  const aim = 0.75 + 0.25 * (1 - tr.needs.fatigue) - 0.2 * Math.max(0, tr.needs.stress - 0.6);
  const guns = ours.ammo > 0 ? 1 : 0.55; // the magazine empty: only the lasers
  return OUR_DPS * aim * guns * (sh.thermal.heat > 0.95 ? 0.4 : 1) * (ours.serviceDue ? 0.85 : 1);
}

/**
 * How the fight is going: what we can still soak up against what they will
 * put into us before they are all down, taking them weakest first. Above 1 we
 * win on current form; well under 1 we lose.
 */
export function fightOdds(state, cb) {
  const ours = state.ship.combat;
  const patrol = cb.patrol && cb.patrol.here;
  const rate = ourRate(state, cb) + (patrol ? PATROL_DPS : 0);
  const left = living(cb).sort((a, b) => a.shield + a.hull - (b.shield + b.hull));
  let t = 0, taken = 0;
  for (const x of left) { t += (Math.max(0, x.shield) + Math.max(0, x.hull) / 0.9) / rate; taken += x.dps * 0.95 * t; }
  if (patrol) taken *= 0.6;
  const wear = state.ship.components.hull_plating.wear;
  const capacity = (ours.down ? 0 : ours.shield) + Math.max(0, 0.95 - wear) / 0.55;
  return taken > 0 ? capacity / taken : 99;
}

function toll(state) {
  const c = state.space.credits;
  return c < 200 ? 0 : Math.min(1500, Math.round((c * 0.15) / 50) * 50);
}

/** Outmatched: give the pirates what they came for, or spool the drive and run for it. */
function giveUpOrRun(state, data, cb, why) {
  const sp = state.space, tr = state.traveler, lead = cb.foes[0];
  const cargo = cargoTons(state);
  const owed = cargo > 0 ? 0 : toll(state);
  let submit = false;
  // a bounty target wants nothing the traveler can hand over; pirates want the hold, or the credits
  if (cb.reason === 'pirate' && (cargo > 0 || owed > 0)) {
    const smuggling = sp.missions.some((m) => m.kind === 'smuggle');
    const atStake = sp.missions.filter((m) => m.tons).reduce((a, m) => a + m.reward, 0);
    const p = 0.35 + 0.4 * tr.needs.stress + (why === 'hull' ? 0.25 : 0) + (living(cb).length > 1 ? 0.1 : 0)
      - (smuggling ? 0.25 : 0) - (atStake > 4000 ? 0.15 : 0) - 0.3 * (data.traveler.traits.resilience - 0.5);
    submit = chance(state.rng, clamp(p, 0.05, 0.95));
  }
  if (submit) {
    // throttle to zero, open the cargo hatch; they hold their fire while it goes out
    cb.submitT = state.t + 25;
    cb.toll = owed;
    emit(state, 'combat_submit', { foe: lead.name, cargo: Math.round(cargo), toll: owed, why, room: 'bridge' });
  } else {
    cb.fleeT = state.t + data.space.drive.chargeSeconds;
    emit(state, 'combat_flee', { foe: lead.name, why, room: 'bridge' });
  }
}

function hurt(x, dmg) {
  if (x.shield > 0) { const s = Math.min(x.shield, dmg); x.shield -= s; dmg -= s; }
  x.hull -= dmg * 0.9;
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
  const tr = state.traveler;
  const a = tr.activity;
  const atHelm = !!(a && a.id === 'fight' && a.phase === 'perform');
  cb.firing = atHelm && !cb.submitT;
  // system security drops in on our side
  if (cb.patrol && !cb.patrol.here && !cb.submitT && state.t >= cb.patrol.dueT) {
    cb.patrol.here = true;
    emit(state, 'patrol_arrives', { name: cb.patrol.name, ships: cb.patrol.ships, foe: cb.foes[0].name, room: 'bridge' });
  }
  const patrol = !!(cb.patrol && cb.patrol.here);
  const live = living(cb);
  // our fire, and the patrol's, goes into the weakest of them first: fewer guns on us sooner
  const weight = (x) => x.shield + x.hull + (x.alive && x.hull < CAREFUL_BELOW && live.length > 1 ? 10 : 0);
  const tgt = live.reduce((b, x) => (!b || weight(x) < weight(b) ? x : b), null);
  cb.target = cb.foes.indexOf(tgt);
  let dmg = 0;
  if (cb.firing && !cb.fleeT) {
    cb.firedT += dt;
    dmg += ourRate(state, cb) * dt;
    ours.ammo = Math.max(0, ours.ammo - AMMO_PER_S * dt);
    sh.thermal.heat = clamp(sh.thermal.heat + 0.0012 * dt, 0, 1.2);
  }
  if (patrol && !cb.submitT) dmg += PATROL_DPS * dt;
  // wanted alive: once they're weak, short careful bursts at the drive, not the reactor
  if (tgt && tgt.alive && tgt.hull < CAREFUL_BELOW) dmg *= 0.5;
  if (tgt && dmg > 0) hurt(tgt, dmg);
  // their fire: every gun still in the fight; the patrol draws some of it; held while the cargo goes out
  let hit = 0;
  if (!cb.submitT) for (const x of live) hit += x.dps * dt * range(state.rng, 0.6, 1.3);
  if (patrol) hit *= 0.6;
  if (!ours.down && hit > 0) {
    const s = Math.min(ours.shield, hit);
    ours.shield -= s; hit -= s;
    ours.hitT = state.t;
    if (ours.shield <= 0.001) {
      ours.down = true; ours.rebootT = state.t + range(state.rng, 120, 200);
      emit(state, 'shield_down', { foe: cb.foes[0].name, room: 'bridge' });
      tr.needs.stress = clamp(tr.needs.stress + 0.15);
    }
  }
  if (hit > 0) {
    const C = sh.components;
    C.hull_plating.wear = clamp(C.hull_plating.wear + hit * 0.55);
    if (chance(state.rng, hit * 2)) { const id = pick(state.rng, ['thermal_vents', 'bridge_sensors', 'drive_coil', 'scoop_manifold']); C[id].wear = clamp(C[id].wear + 0.05); }
  }
  if (ours.down && state.t >= ours.rebootT) { ours.down = false; ours.shield = 0.25; emit(state, 'shield_online', { room: 'engineering' }); }
  // ships that go down or break off
  for (const x of live) {
    if (x.alive && x.hull <= DISABLE_AT && x.shield <= 0) {
      // the drive goes; now and then the reactor goes with it
      if (chance(state.rng, 0.1)) { x.hull = 0; emit(state, 'foe_breach', { foe: x.name, room: 'bridge' }); }
      else { x.gone = 'disabled'; emit(state, 'foe_disabled', { foe: x.name, cls: CLASSES[x.cls].label, room: 'bridge' }); continue; }
    }
    if (x.hull <= 0) {
      x.gone = 'down';
      sp.lastKillT = state.t; sp.lastKillSlot = cb.foes.indexOf(x);
      if (cb.foes.some((y) => !y.gone)) emit(state, 'foe_down', { foe: x.name, cls: CLASSES[x.cls].label, role: x.role, room: 'bridge' });
    } else if (x.hull < 0.2 && x.hull > DISABLE_AT && x.shield <= 0 && chance(state.rng, 0.02 * dt)) {
      x.gone = 'fled';
      if (cb.foes.some((y) => !y.gone)) emit(state, 'foe_fled', { foe: x.name, role: x.role, room: 'bridge' });
    }
  }
  // with the leader gone the wing loses heart and runs
  const lead = cb.foes[0];
  if (lead.gone) for (const x of cb.foes) if (!x.gone) x.gone = 'fled';
  if (!living(cb).length) return endCombat(state, data, lead.gone === 'down' ? 'won' : lead.gone === 'disabled' ? 'captured' : 'foe_fled');
  // the traveler sizes it up once at the helm, and again when things go wrong
  const wear = sh.components.hull_plating.wear;
  if (!cb.fleeT && !cb.submitT) {
    if (atHelm && !cb.judged && cb.firedT >= 8) {
      cb.judged = true;
      if (fightOdds(state, cb) < 0.6) giveUpOrRun(state, data, cb, 'outgunned');
    }
    if (!cb.fleeT && !cb.submitT && (wear > 0.72 || (ours.down && cb.firedT > 30 && fightOdds(state, cb) < 1))) giveUpOrRun(state, data, cb, wear > 0.72 ? 'hull' : 'shield');
  }
  if (cb.submitT && state.t >= cb.submitT) return endCombat(state, data, 'submitted');
  if (cb.fleeT && state.t >= cb.fleeT) return endCombat(state, data, wear > 0.9 ? 'robbed' : 'fled');
  if (wear >= 0.95) return endCombat(state, data, 'robbed');
}

function failCargo(state, reason) {
  const sp = state.space;
  for (const m of sp.missions.filter((x) => x.tons)) {
    sp.missions = sp.missions.filter((x) => x !== m);
    sp.stats.missionsFailed = (sp.stats.missionsFailed || 0) + 1;
    emit(state, 'mission_fail', { kind: m.kind, title: m.title, reason, room: 'bridge' });
  }
}

function endCombat(state, data, result) {
  const sp = state.space, cb = sp.combat, lead = cb.foes[0];
  sp.combat = null;
  const tr = state.traveler, ours = state.ship.combat;
  // bounties: the contract's target marks the contract done; anyone else wanted is a voucher
  let bounty = 0;
  const downed = cb.foes.filter((x) => x.gone === 'down');
  for (const x of downed) {
    if (!x.wanted) continue;
    const m = x.missionId && sp.missions.find((y) => y.id === x.missionId);
    if (m) { m.killed = true; if (m.alive) m.aliveLost = true; bounty += m.alive ? 0 : x.bounty || 0; }
    else if (x.bounty) { sp.vouchers.push({ amount: x.bounty, foe: x.name, t: state.t }); bounty += x.bounty; }
  }
  // taken alive: their ship drifts alongside until the traveler brings them aboard
  if (result === 'captured') {
    const m = lead.missionId && sp.missions.find((y) => y.id === lead.missionId);
    if (m) m.captured = true;
    takePrisoner(state, data, lead, m);
  }
  // they take the cargo and go; any mission that needed it is lost
  if (result === 'robbed') failCargo(state, 'robbed');
  if (result === 'submitted') {
    if (cb.toll) { sp.credits = Math.max(0, sp.credits - cb.toll); }
    else failCargo(state, 'submitted');
  }
  // a bounty run from twice is given up
  if (lead.missionId && (result === 'fled' || result === 'robbed')) {
    const m = sp.missions.find((x) => x.id === lead.missionId);
    if (m) {
      m.fled = (m.fled || 0) + 1;
      if (m.fled >= 2) { sp.missions = sp.missions.filter((x) => x !== m); sp.stats.missionsFailed = (sp.stats.missionsFailed || 0) + 1; emit(state, 'mission_fail', { kind: m.kind, title: m.title, reason: 'gave_up', room: 'bridge' }); }
    }
  }
  if (cb.firedT > 20) ours.serviceDue = true; // the gimbals and the shield capacitors want looking at
  sp.lastFightT = state.t;
  sp.combatCooldownT = state.t + (result === 'won' || result === 'foe_fled' || result === 'captured' ? 6 : 18) * 3600;
  sp.stats.fights = (sp.stats.fights || 0) + 1;
  sp.stats.kills = (sp.stats.kills || 0) + downed.length;
  if (result === 'captured') sp.stats.captured = (sp.stats.captured || 0) + 1;
  if (result === 'submitted') sp.stats.submitted = (sp.stats.submitted || 0) + 1;
  tr.needs.stress = clamp(tr.needs.stress + (result === 'won' || result === 'captured' ? 0.05 : result === 'submitted' ? 0.12 : result === 'foe_fled' ? 0.08 : 0.18));
  tr.needs.fatigue = clamp(tr.needs.fatigue + 0.08);
  emit(state, 'combat_end', {
    foe: lead.name, cls: CLASSES[lead.cls].label, wing: cb.foes.length - 1, downed: downed.length, result, bounty,
    toll: result === 'submitted' ? cb.toll : 0, patrol: cb.patrol && cb.patrol.here ? cb.patrol.name : null, room: 'bridge',
  });
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

/** At a port: refill the magazine, if it's run down and there's money for it. */
export function rearm(state, data) {
  const sp = state.space, c = state.ship.combat;
  if (!c || c.ammo > 0.85) return 0;
  const cost = Math.round((1 - c.ammo) * data.space.ports.price.ammoFull);
  if (sp.credits < cost + 400) return 0;
  sp.credits -= cost;
  c.ammo = 1;
  emit(state, 'port_service', { service: 'rearm', cost, room: 'bridge' });
  return cost;
}

export const combatClassLabel = (cls) => (CLASSES[cls] || { label: cls }).label;
export { factionName };
