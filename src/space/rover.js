// Rover outings: a long drive out from a landed ship to sites a walk can't
// reach, stopping to sample on foot at each. One continuous activity:
//   suit_up → cycle_out → board → drive → dock → cycle_in → suit_off
// The rover waits on its bay platform, lowered through the belly. During
// 'drive' the traveler is in the pseudo-room 'surface' at x meters from the
// ship, aboard the rover or, at a site, out on foot beside it.
import { range, int, chance, pick } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { emit } from '../sim/events.js';
import { addKeepsake, confirmLife, feelWonder } from './discovery.js';
import { FEATURE_LABELS } from './eva.js';

const ROVER_KINDS = ['outcrop', 'crater_rim', 'regolith_plain', 'boulder_field', 'scarp', 'ejecta_ray'];

/** Can the rover work here at all? It needs some gravity to keep its wheels down, and not too much. */
export function roverCanDrive(data, b) {
  const g = data.space.rover.gravity;
  return !!b && b.landable && b.kind !== 'belt' && b.gravity >= g[0] && b.gravity <= g[1];
}

/** Rover outings a landed visit plans: one when there is something worth driving to. Uses no RNG. */
export function roverOutingsFor(data, b, land) {
  if (!land || !roverCanDrive(data, b)) return 0;
  return b.signals.geo > 0 || b.signals.bio > 0 || b.signals.anomaly || b.rarity > 0.5 || b.beauty > 0.6 ? 1 : 0;
}

export function speedOn(data, b) {
  const r = data.space.rover;
  return r.speedMps * (b.gravity < 0.25 ? 0.6 : b.gravity > 1.5 ? 0.75 : 1);
}

export function planRover(state, data, sys, b) {
  const r = data.space.rover, e = data.space.eva;
  const tr = state.traveler;
  const rng = state.rng;
  const curiosity = data.traveler.traits.curiosity;
  const driveS = clamp(range(rng, r.driveHours[0], r.driveHours[1]) * 3600 * (0.7 + 0.5 * curiosity) * (1 - 0.35 * tr.needs.fatigue), 3600, 5.5 * 3600);
  const speed = speedOn(data, b);
  const siteS = r.siteMinutes.map((m) => m * 60);
  const kinds = [...ROVER_KINDS];
  if (b.ice) kinds.push('ice_ridge');
  if (b.atmosphere === 'thin' || b.atmosphere === 'thick') kinds.push('dune');
  const sites = [];
  const n = int(rng, 2, 3);
  for (let i = 0; i < n; i++) sites.push({ kind: pick(rng, kinds) });
  if (b.signals.geo) sites.push({ kind: chance(rng, 0.5) ? 'geyser' : 'fumarole' });
  if (b.signals.bio) sites.push({ kind: 'bio_mat' });
  if (b.signals.anomaly) sites.push({ kind: b.signals.anomaly });
  // time on foot at the sites comes out of the outing; the rest is driving, out and back
  const stops = sites.map(() => range(rng, siteS[0], siteS[1]));
  const driving = Math.max(1200, driveS - stops.reduce((a, s) => a + s, 0));
  const maxX = Math.min(r.rangeKm * 1000 * 0.45, speed * driving * 0.44);
  sites.forEach((f, i) => { f.x = Math.round(range(rng, 0.25, 1) * maxX); f.visited = false; f.stopS = stops[i]; });
  sites.sort((a, c) => a.x - c.x);
  const phases = [
    { name: 'suit_up', dur: range(rng, ...e.suitUpSeconds) },
    { name: 'cycle_out', dur: e.cycleSeconds },
    { name: 'board', dur: r.boardSeconds },
    { name: 'drive', dur: driveS },
    { name: 'dock', dur: r.dockSeconds },
    { name: 'cycle_in', dur: e.cycleSeconds },
    { name: 'suit_off', dur: range(rng, ...e.suitOffSeconds) },
  ];
  return {
    kind: 'rover', body: b.id, phases, i: 0, t: 0, features: sites, maxX: Math.round(maxX), x: 0, returning: false,
    aboard: false, site: null, suitO2: 1, driven: 0, samples: { ore: 0, ice: 0, bio: 0 },
  };
}

/** Is the traveler out on foot right now (the helmet camera's turn)? */
export const onFoot = (plan) => !!plan && plan.kind === 'rover' && !plan.aboard && plan.phases[plan.i] && ['drive'].includes(plan.phases[plan.i].name);

/** Per-second update of an outing. */
export function tickRover(state, data, a, sys, dt) {
  const plan = a.params.plan;
  const tr = state.traveler;
  const rover = state.ship.rover;
  const ph = plan.phases[plan.i];
  const b = sys.byId[plan.body];
  plan.t += dt;
  // the suit only draws on its own oxygen when the traveler is outside the cab
  if (!plan.aboard && !['suit_up', 'suit_off'].includes(ph.name)) plan.suitO2 = clamp(plan.suitO2 - dt / (data.space.eva.suitO2Hours * 3600));
  state.ship.ops.airlockCycling = ph.name === 'cycle_out' || ph.name === 'cycle_in';

  if (ph.name === 'board') {
    // down the EVA lift and across to the platform, then up into the cab
    tr.pos = { room: 'surface', x: Math.min(12, (plan.t / ph.dur) * 14) };
  }
  if (ph.name === 'drive') {
    const speed = speedOn(data, b) * (1.05 - 0.3 * Math.max(0, tr.needs.fatigue - 0.5));
    if (plan.site) {
      // out on foot at a site: a short walk round it, then back to the cab
      const s = plan.site;
      s.t += dt;
      tr.pos = { room: 'surface', x: s.f.x + Math.sin((s.t / s.f.stopS) * Math.PI) * 18 };
      if (s.t >= s.f.stopS || plan.suitO2 < 0.3) {
        plan.site = null;
        plan.aboard = true;
        tr.pos = { room: 'surface', x: plan.x };
        emit(state, 'rover_board', { at: Math.round(plan.x), body: b.name });
      }
    } else {
      const left = ph.dur - plan.t;
      const recall = mustReturn(state, data, plan);
      if (!plan.returning && (plan.x / speed >= left - 60 || recall || rover.charge < 0.3 + plan.x / (data.space.rover.rangeKm * 1000))) {
        plan.returning = true;
        ph.dur = plan.t + plan.x / speed + 30;
        emit(state, 'rover_turnback', { km: Math.round(plan.x / 100) / 10, reason: recall ? 'recall' : rover.charge < 0.4 ? 'charge' : 'time', body: b.name });
      }
      const step = (plan.returning ? -speed : speed) * dt;
      const next = clamp(plan.x + step, 0, plan.maxX);
      plan.driven += Math.abs(next - plan.x);
      rover.charge = clamp(rover.charge - Math.abs(next - plan.x) / (data.space.rover.rangeKm * 1000));
      plan.x = next;
      tr.pos = { room: 'surface', x: plan.x };
      if (!plan.returning) {
        const f = plan.features.find((q) => !q.visited && plan.x >= q.x);
        if (f) { plan.x = f.x; arrive(state, data, plan, sys, f); }
      }
      // home again early: end the drive
      if (plan.returning && plan.x <= 0) ph.dur = Math.min(ph.dur, plan.t);
    }
  }
  if (plan.t < ph.dur) return;
  plan.i++;
  plan.t = 0;
  const next = plan.phases[plan.i];
  if (!next) return;
  if (next.name === 'cycle_out') tr.pos = { room: 'airlock', x: data.rooms.airlock.stations.outer_door };
  if (next.name === 'board') {
    tr.pos = { room: 'surface', x: 0 };
    rover.out = true;
    emit(state, 'room_enter', { room: 'surface', from: 'airlock', hatch: 'outer_door' });
  }
  if (next.name === 'drive') {
    plan.aboard = true;
    emit(state, 'rover_out', { body: b.name, bodyId: b.id, bodyType: b.type, gravity: Math.round(b.gravity * 100) / 100, sites: plan.features.map((f) => f.kind), km: Math.round(plan.maxX / 100) / 10 });
    feelWonder(state, state.space.stats.roverKm ? 0.03 : 0.07, !state.space.stats.roverKm);
  }
  if (next.name === 'dock') { plan.aboard = false; plan.x = 0; tr.pos = { room: 'surface', x: 10 }; }
  if (next.name === 'cycle_in') {
    rover.out = false;
    tr.pos = { room: 'airlock', x: data.rooms.airlock.stations.outer_door };
    emit(state, 'room_enter', { room: 'airlock', from: 'surface', hatch: 'outer_door' });
  }
  if (next.name === 'suit_off') tr.pos = { room: 'airlock', x: data.rooms.airlock.stations.suit_rack };
  emit(state, 'rover_phase', { phase: next.name, body: b.name });
}

function mustReturn(state, data, plan) {
  const n = state.traveler.needs;
  if (n.fatigue > 0.85 || n.thirst > 0.92 || n.hunger > 0.92) return true;
  for (const id of data.componentIds) {
    const c = state.ship.components[id];
    if (c.fault && c.known && c.fault.severity === 'major' && data.components[id].alarm) return true;
  }
  return false;
}

/** Pull up at a site: park, step out, sample. */
function arrive(state, data, plan, sys, f) {
  f.visited = true;
  plan.aboard = false;
  plan.site = { f, t: 0 };
  const b = sys.byId[plan.body];
  const cargo = state.space.cargo;
  const rng = state.rng;
  const out = { feature: f.kind, label: FEATURE_LABELS[f.kind] || f.kind, km: Math.round(f.x / 100) / 10, body: b.name };
  // the rover's sample bins carry far more than a suit's pouch
  if (['outcrop', 'crater_rim', 'regolith_plain', 'boulder_field', 'scarp', 'ejecta_ray', 'dune', 'fumarole'].includes(f.kind) && b.ore > 0) {
    const kg = Math.round(b.ore * range(rng, 6, 18) * 10) / 10;
    cargo.ore += kg; plan.samples.ore += kg; out.oreKg = kg;
  }
  if (f.kind === 'ice_ridge' || (b.ice && chance(rng, 0.35))) {
    const kg = Math.round(range(rng, 15, 45) * 10) / 10;
    cargo.ice += kg; plan.samples.ice += kg; out.iceKg = kg;
  }
  emit(state, 'rover_site', out);
  if (f.kind === 'bio_mat') {
    cargo.bio += 1; plan.samples.bio += 1;
    confirmLife(state, data, sys, b);
  } else if (['crystalline_spires', 'patterned_vents', 'unexplained_signal'].includes(f.kind)) {
    feelWonder(state, 0.2, true);
    addKeepsake(state, { kind: 'anomaly_fragment', label: `${FEATURE_LABELS[f.kind]} — ${b.name}` });
  } else if (['geyser', 'scarp', 'ejecta_ray'].includes(f.kind) || chance(rng, 0.12)) {
    feelWonder(state, 0.04);
    if (chance(rng, 0.4)) addKeepsake(state, { kind: 'mineral', label: `${FEATURE_LABELS[f.kind] || f.kind} specimen — ${b.name}` });
  }
}

/** The rover recharges on its bay platform from ship power. Per slow tick. */
export function chargeRover(state, data, dt) {
  const r = state.ship.rover;
  if (!r || r.out || r.charge >= 1) return;
  if (state.ship.power.mode !== 'normal') return;
  r.charge = clamp(r.charge + (data.space.rover.chargePerHour * dt) / 3600);
}
