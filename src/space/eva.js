// Planetary EVA, seen later through the traveler's helmet camera.
// One continuous activity with phases:
//   suit_up → cycle_out → surface → cycle_in → suit_off
// On the surface the traveler is in the pseudo-room 'surface' at x metres
// from the ship, walking out past features and back.
import { range, int, chance, pick } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { emit } from '../sim/events.js';
import { addKeepsake, confirmLife, feelWonder } from './discovery.js';

const FEATURE_LABELS = {
  outcrop: 'layered outcrop', crater_rim: 'crater rim', regolith_plain: 'regolith plain', ice_ridge: 'pressure ridge in the ice',
  dune: 'wind-cut dunes', geyser: 'geyser vent', fumarole: 'fumarole field', bio_mat: 'pigmented mat in a sheltered hollow',
  crystalline_spires: 'crystalline spires', patterned_vents: 'vents in a regular pattern', unexplained_signal: 'the source of the signal',
};

export function planEva(state, data, sys, b) {
  const e = data.space.eva;
  const tr = state.traveler;
  const rng = state.rng;
  const curiosity = data.traveler.traits.curiosity;
  const surfaceS = clamp(range(rng, e.surfaceMinutes[0], e.surfaceMinutes[1]) * 60 * (0.6 + 0.6 * curiosity) * (1 - 0.4 * tr.needs.fatigue), 20 * 60, 150 * 60);
  const maxX = e.walkSpeed * surfaceS * 0.38;
  const kinds = ['outcrop', 'crater_rim', 'regolith_plain'];
  if (b.ice) kinds.push('ice_ridge');
  if (b.atmosphere === 'thin' || b.atmosphere === 'thick') kinds.push('dune');
  const features = [];
  const n = int(rng, 1, 3);
  for (let i = 0; i < n; i++) features.push({ kind: pick(rng, kinds) });
  if (b.signals.geo) features.push({ kind: chance(rng, 0.5) ? 'geyser' : 'fumarole' });
  if (b.signals.bio) features.push({ kind: 'bio_mat' });
  if (b.signals.anomaly) features.push({ kind: b.signals.anomaly });
  features.forEach((f) => { f.x = Math.round(range(rng, 0.2, 1) * maxX); f.visited = false; });
  features.sort((a, c) => a.x - c.x);
  const phases = [
    { name: 'suit_up', dur: range(rng, ...e.suitUpSeconds) },
    { name: 'cycle_out', dur: e.cycleSeconds },
    { name: 'surface', dur: surfaceS },
    { name: 'cycle_in', dur: e.cycleSeconds },
    { name: 'suit_off', dur: range(rng, ...e.suitOffSeconds) },
  ];
  return { body: b.id, phases, i: 0, t: 0, features, maxX: Math.round(maxX), x: 0, returning: false, suitO2: 1, samples: { ore: 0, ice: 0, bio: 0 }, hullPatched: false };
}

export const evaDuration = (plan) => plan.phases.reduce((s, p) => s + p.dur, 0);

/** Per-second EVA update. Returns the (possibly shortened) total duration. */
export function tickEva(state, data, a, sys, dt) {
  const plan = a.params.plan;
  const tr = state.traveler;
  const ph = plan.phases[plan.i];
  plan.t += dt;
  plan.suitO2 = clamp(plan.suitO2 - (ph.name === 'suit_up' || ph.name === 'suit_off' ? 0 : dt / (data.space.eva.suitO2Hours * 3600)));
  state.ship.ops.airlockCycling = ph.name === 'cycle_out' || ph.name === 'cycle_in';

  if (ph.name === 'surface') {
    const speed = data.space.eva.walkSpeed * (1.05 - 0.4 * Math.max(0, tr.needs.fatigue - 0.4));
    const left = ph.dur - plan.t;
    // turn back when half the time is gone or something calls us home
    if (!plan.returning && (plan.x / speed >= left - 30 || mustReturn(state, data, plan))) {
      plan.returning = true;
      ph.dur = plan.t + plan.x / speed + 20;
      emit(state, 'eva_turnback', { x: Math.round(plan.x), reason: mustReturn(state, data, plan) ? 'recall' : 'time' });
    }
    plan.x = clamp(plan.x + (plan.returning ? -speed : speed) * dt, 0, plan.maxX);
    tr.pos = { room: 'surface', x: plan.x };
    if (!plan.returning) {
      for (const f of plan.features) if (!f.visited && plan.x >= f.x) visitFeature(state, data, plan, sys, f);
    }
  }
  if (plan.t < ph.dur) return;
  plan.i++;
  plan.t = 0;
  const next = plan.phases[plan.i];
  if (!next) return;
  const b = sys.byId[plan.body];
  if (next.name === 'cycle_out') { tr.pos = { room: 'airlock', x: data.rooms.airlock.stations.outer_door }; }
  if (next.name === 'surface') {
    tr.pos = { room: 'surface', x: 0 };
    emit(state, 'room_enter', { room: 'surface', from: 'airlock', hatch: 'outer_door' });
    emit(state, 'eva_step_out', { body: b.name, bodyId: b.id, bodyType: b.type, gravity: Math.round(b.gravity * 100) / 100, tempK: b.tempK, atmosphere: b.atmosphere, features: plan.features.map((f) => f.kind) });
    if (!state.space.evaFirst[b.type]) {
      state.space.evaFirst[b.type] = true;
      feelWonder(state, 0.08, true);
    } else feelWonder(state, 0.03);
  }
  if (next.name === 'cycle_in') {
    tr.pos = { room: 'airlock', x: data.rooms.airlock.stations.outer_door };
    emit(state, 'room_enter', { room: 'airlock', from: 'surface', hatch: 'outer_door' });
  }
  if (next.name === 'suit_off') tr.pos = { room: 'airlock', x: data.rooms.airlock.stations.suit_rack };
  emit(state, 'eva_phase', { phase: next.name, body: b.name });
}

function mustReturn(state, data, plan) {
  const tr = state.traveler;
  if (plan.suitO2 < 0.35) return true;
  if (tr.needs.fatigue > 0.85 || tr.needs.thirst > 0.9) return true;
  for (const id of data.componentIds) {
    const c = state.ship.components[id];
    if (c.fault && c.known && c.fault.severity === 'major' && data.components[id].alarm) return true;
  }
  return false;
}

function visitFeature(state, data, plan, sys, f) {
  f.visited = true;
  const b = sys.byId[plan.body];
  const cargo = state.space.cargo;
  const rng = state.rng;
  const out = { feature: f.kind, label: FEATURE_LABELS[f.kind] || f.kind, x: f.x, body: b.name };
  if (['outcrop', 'crater_rim', 'regolith_plain', 'dune', 'fumarole'].includes(f.kind) && b.ore > 0) {
    const kg = Math.round(b.ore * range(rng, 1.5, 5) * 10) / 10;
    cargo.ore += kg;
    plan.samples.ore += kg;
    out.oreKg = kg;
  }
  if (f.kind === 'ice_ridge' || (b.ice && chance(rng, 0.3))) {
    const kg = Math.round(range(rng, 4, 12) * 10) / 10;
    cargo.ice += kg;
    plan.samples.ice += kg;
    out.iceKg = kg;
  }
  emit(state, 'eva_feature', out);
  if (f.kind === 'bio_mat') {
    cargo.bio += 1;
    plan.samples.bio += 1;
    confirmLife(state, data, sys, b);
  } else if (['crystalline_spires', 'patterned_vents', 'unexplained_signal'].includes(f.kind)) {
    feelWonder(state, 0.2, true);
    addKeepsake(state, { kind: 'anomaly_fragment', label: `${FEATURE_LABELS[f.kind]} — ${b.name}` });
  } else if (f.kind === 'geyser' || chance(rng, 0.08)) {
    feelWonder(state, 0.03);
    if (chance(rng, 0.35)) addKeepsake(state, { kind: 'mineral', label: `${FEATURE_LABELS[f.kind]} specimen — ${b.name}` });
  }
  // patch the hull while outside, if it needs it and we have plating
  const hull = state.ship.components.hull_plating;
  if (!plan.hullPatched && hull.wear > 0.45 && state.ship.inventory.parts >= 2 && !hull.fault) {
    plan.hullPatched = true;
    state.ship.inventory.parts -= 2;
    hull.wear = Math.max(0.1, hull.wear - 0.4);
    hull.knownWear = hull.wear;
    plan.phases[plan.i].dur += 1200;
    emit(state, 'maintenance', { component: 'hull_plating', label: 'patch hull plating on the surface', room: 'surface' });
  }
}
