// Component wear, fault onset/escalation, perception and repair outcomes.
import { rand, range, chance } from '../rng.js';
import { clamp, ph } from '../util.js';
import { emit } from '../events.js';

/** Multiplier for an effect key from the component's current fault (1 if none). */
export function factor(state, data, compId, key) {
  const c = state.ship.components[compId];
  if (!c || !c.fault) return 1;
  const eff = data.components[compId].faults[c.fault.severity].effect;
  return eff[key] === undefined ? 1 : eff[key];
}

export function hasFault(state, compId, severity) {
  const f = state.ship.components[compId].fault;
  return !!f && (!severity || f.severity === severity);
}

/** How hard the component is working right now (0..1). */
export function runFraction(state, compId) {
  const ops = state.ship.ops;
  switch (compId) {
    case 'reactor_core': return ops.reactorFrac;
    case 'water_recycler': return 0.35 + 0.65 * ops.recyclerDuty;
    case 'o2_scrubber': return 0.3 + 0.7 * ops.scrubberDuty;
    case 'ogs': return 0.2 + 0.8 * ops.ogsDuty;
    case 'grow_lamps_a':
    case 'grow_lamps_b': return ops.lampOn ? state.ship.power.lampLevel : 0;
    case 'corridor_lights_aft': return state.ship.power.lightLevel;
    case 'galley_heater': return ops.cooking ? 1 : 0.02;
    case 'fabricator': return ops.fabricating ? 1 : 0;
    case 'drive_coil': { const m = state.ship.flight.mode; return m === 'charging' || m === 'hyperspace' ? 1 : 0; }
    case 'scoop_manifold': return state.ship.flight.mode === 'scooping' ? 1 : 0;
    case 'hull_plating': {
      const f = state.ship.flight;
      if (f.entryHeat > 0.05) return 1;
      return f.mode === 'cruise' ? 0.02 : 0;
    }
    case 'airlock_seals': return ops.airlockCycling ? 1 : 0;
    default: return 1;
  }
}

/** Hazard tick: wear accrual, random fault onset, escalation, perception. */
export function updateWear(state, data, dt) {
  const heat = state.ship.thermal.heat;
  // During a torpor crossing the ship idles at minimum: almost nothing wears.
  const idle = state.ship.flight.mode === 'void' ? 0.1 : 1;
  const heatMult = (1 + Math.max(0, heat - 0.65) * 4) * idle;
  const rng = state.rng;
  for (const id of data.componentIds) {
    const def = data.components[id];
    const c = state.ship.components[id];
    const run = runFraction(state, id);
    if (def.wearPerHour > 0 && run > 0) {
      c.wear = clamp(c.wear + ph(def.wearPerHour * run * heatMult * (c.patched ? 1.3 : 1), dt));
      c.runHours += ph(run, dt);
    }
    if (!c.fault) {
      if (def.hazard > 0 && run > 0) {
        const w = c.wear;
        const lambda = def.hazard * (0.04 + 8 * w * w * w * w) * run * idle * (c.patched ? 1.25 : 1);
        if (rand(rng) < ph(lambda, dt)) startFault(state, data, id, 'minor');
      }
    } else if (c.fault.severity === 'minor' && state.t >= c.fault.escalateT) {
      c.fault.severity = 'major';
      c.fault.id = def.faults.major.id;
      c.fault.sinceT = state.t;
      emit(state, 'fault_escalated', { component: id, fault: c.fault.id, room: def.room });
      if (def.alarm) raiseAlarm(state, data, id);
    }
  }
  perceive(state, data);
}

export function startFault(state, data, id, severity) {
  const def = data.components[id];
  const c = state.ship.components[id];
  const f = def.faults[severity];
  const esc = def.faults.minor.escalateHours;
  c.fault = {
    id: f.id, severity, sinceT: state.t,
    // 0 = never escalates (already major). Never use Infinity: it is not JSON-safe.
    escalateT: severity === 'minor' ? state.t + range(state.rng, esc[0], esc[1]) * 3600 : 0,
  };
  c.known = false;
  emit(state, 'fault', { component: id, fault: f.id, severity, room: def.room });
  if (def.alarm) raiseAlarm(state, data, id);
}

function raiseAlarm(state, data, id) {
  state.ship.components[id].known = true;
  emit(state, 'alarm', { component: id, fault: state.ship.components[id].fault.id, severity: state.ship.components[id].fault.severity, room: data.components[id].room });
}

/**
 * The traveler notices components in the room they are standing in: faults
 * become known (rattles, flicker, LEDs) and their sense of the wear updates.
 * `thorough` (inspections) reveals wear precisely; casual passing is noisy.
 */
export function perceive(state, data, room = state.traveler.pos.room, thorough = false) {
  for (const id of data.componentIds) {
    const def = data.components[id];
    if (def.room !== room) continue;
    const c = state.ship.components[id];
    if (c.fault && !c.known) {
      c.known = true;
      emit(state, 'fault_noticed', { component: id, fault: c.fault.id, severity: c.fault.severity, room });
    }
    // Casual perception only catches wear once it is audible/visible.
    if (thorough || c.wear > 0.55) c.knownWear = thorough ? c.wear : Math.max(c.knownWear, c.wear - 0.1);
  }
}

/** Fabricator feedstock cost per item (kg) and the share recovered from scrap. */
export const FAB_COST = { parts: 1.5, filters: 0.8, cartridges: 1.2, seals: 0.25 };
const SCRAP_RECOVERY = 0.85;

export function scrapValue(items) {
  let kg = 0;
  for (const [k, v] of Object.entries(items)) kg += (FAB_COST[k] || 0) * v * SCRAP_RECOVERY;
  return kg;
}

/** Parts needed for a repair of the component's current fault. */
export function repairNeeds(data, id, severity) {
  const r = data.components[id].repair[severity];
  const needs = {};
  for (const k of ['parts', 'filters', 'cartridges', 'seals']) if (r[k]) needs[k] = r[k];
  return needs;
}

export function canAfford(state, needs) {
  const inv = state.ship.inventory;
  return Object.entries(needs).every(([k, v]) => inv[k] >= v);
}

function spend(state, needs) {
  const inv = state.ship.inventory;
  for (const [k, v] of Object.entries(needs)) inv[k] -= v;
}

/**
 * Apply a finished repair. Fatigue and stress make mistakes more likely.
 * Without parts the traveler jury-rigs: the fault clears but the component
 * stays worn and "patched" (wears faster) until a proper repair. This keeps
 * the ship from ever bricking while making the shortage visible.
 */
export function applyRepair(state, data, id) {
  const c = state.ship.components[id];
  if (!c.fault) return null;
  const tr = state.traveler;
  const sev = c.fault.severity;
  const needs = repairNeeds(data, id, sev);
  const juryRig = !canAfford(state, needs);
  const mistakeP = 0.03 + 0.3 * Math.max(0, tr.needs.fatigue - 0.6) + 0.06 * tr.needs.stress;
  if (chance(state.rng, mistakeP)) {
    // Botched: a major fault drops back to minor at best; the work must be redone.
    if (sev === 'major') {
      c.fault.severity = 'minor';
      c.fault.id = data.components[id].faults.minor.id;
      c.fault.escalateT = state.t + 12 * 3600;
    }
    if (!juryRig) spend(state, { parts: Math.min(1, state.ship.inventory.parts) });
    emit(state, 'repair_mistake', { component: id, fault: c.fault.id, room: data.components[id].room });
    return { ok: false };
  }
  const fault = c.fault.id;
  if (juryRig) {
    c.wear = Math.max(c.wear * 0.6, 0.35);
    c.patched = true;
  } else {
    spend(state, needs);
    // The workshop reclaims most of the removed hardware as fabricator feedstock.
    state.ship.inventory.feedstock += scrapValue(needs);
    c.wear = range(state.rng, 0.06, 0.16);
    c.patched = false;
  }
  c.fault = null;
  c.known = false;
  c.knownWear = c.wear;
  emit(state, 'repair', { component: id, name: data.components[id].name, fault, severity: sev, juryRig, room: data.components[id].room });
  return { ok: true, juryRig };
}

/** Preventive maintenance: knocks wear down without a fault present. */
export function applyMaintenance(state, data, id) {
  const def = data.components[id];
  const c = state.ship.components[id];
  const tr = state.traveler;
  const item = def.maintain.item;
  const has = !item || state.ship.inventory[item] >= def.maintain.qty;
  if (item && has) {
    state.ship.inventory[item] -= def.maintain.qty;
    state.ship.inventory.feedstock += scrapValue({ [item]: def.maintain.qty }) * 0.6; // spent filters/seals are partly reclaimable
  }
  const care = clamp(1 - 0.5 * Math.max(0, tr.needs.fatigue - 0.5));
  const reduce = (has ? range(state.rng, 0.45, 0.65) : 0.2) * care;
  c.wear = Math.max(0.04, c.wear - reduce);
  if (has && c.wear < 0.3) c.patched = false;
  c.knownWear = c.wear;
  emit(state, 'maintenance', { component: id, label: def.maintain.label, partial: !has, room: def.room });
}
