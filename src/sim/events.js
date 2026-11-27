// Sim event bus. Events are plain JSON records pushed to state.outbox; the
// runner drains them to listeners (renderer/audio in later phases) and to the
// IndexedDB journal. Notable events are also kept in a small ring buffer
// inside the snapshot and folded into the "since last log" digest that the
// traveler's log entries are built from.
import { missionSeconds, missionDay } from './clock.js';
import { observe } from '../memory/observe.js';

/** Events worth persisting in the long-term journal. */
export const NOTABLE = new Set([
  'wake', 'sleep_start', 'meal', 'fault', 'fault_escalated', 'alarm', 'repair', 'repair_mistake',
  'maintenance', 'harvest', 'plant', 'tray_died', 'spoiled', 'preserve', 'fabricate', 'salvage',
  'power_mode', 'resource_low', 'resource_recovered', 'emergency_reserve', 'log_entry',
  'exercise', 'hobby', 'overheat', 'collapse', 'inspection', 'catchup', 'fault_noticed', 'vent_purge',
  'tray_cleared', 'tend_trays', 'tend_algae',
  // Phase 2
  'system_arrival', 'system_survey', 'agenda', 'discovery', 'body_scan', 'route_plotted', 'void_ahead', 'stranded',
  'hyperspace_charge', 'scoop_start', 'scoop_end', 'scoop_abort', 'scoop_misjudge', 'heat_damage', 'orbit_entered',
  'touchdown', 'liftoff', 'eva_step_out', 'eva_feature', 'eva_end', 'rover_out', 'rover_site', 'rover_end', 'docked', 'undocked', 'port_visit', 'trade', 'mission_accept', 'mission_complete', 'mission_fail', 'conversation', 'passenger_board', 'passenger_leave', 'study_sample', 'keepsake', 'awe', 'refine', 'melt_ice',
  'bay_dormant', 'torpor_start', 'torpor_end', 'system_record',
  // Phase 5
  'book_finished', 'reflection',
]);

/** Verbose-only events (movement, micro behavior) never go to the journal. */
export function emit(state, type, data = {}) {
  const j = state.journal;
  // Envelope fields always win over payload keys of the same name.
  const ev = { ...data, id: j.nextId++, t: state.t, mt: missionSeconds(state), day: missionDay(state), type };
  const limit = j.outboxLimit || 5000;
  if (state.outbox.length >= limit) state.outbox.splice(0, state.outbox.length - limit + 1);
  state.outbox.push(ev);
  if (NOTABLE.has(type)) {
    // the ring buffer keeps a compact copy; IndexedDB keeps the full event
    const { facts, record, ...compact } = ev;
    j.recent.push(compact);
    if (j.recent.length > j.recentLimit) j.recent.splice(0, j.recent.length - j.recentLimit);
    digest(j.sinceLastLog, ev);
    // episodic memory: notable events that matter enough become memories
    const rec = observe(state, ev);
    if (rec) state.outbox.push({ id: j.nextId++, t: state.t, mt: ev.mt, day: ev.day, type: 'memory_formed', record: { ...rec } });
  }
  return ev;
}

export function emptyDigest() {
  return {
    meals: 0, mealQuality: 0, algaeMeals: 0, sleeps: [], faults: [], repairs: [], mistakes: 0,
    maintenance: [], harvests: [], plantings: [], deadTrays: 0, spoiledKg: 0, fabricated: {},
    powerModes: [], alarms: [], hobbies: {}, exercise: 0, resourceLow: [], salvageKg: 0,
    // Phase 2 — the voyage
    arrivals: [], discoveries: [], landings: [], evas: [], rovers: [], ports: [], missions: [], talks: [], scoops: [], awe: [], torpor: null, heatDamage: 0, keepsakes: [],
    books: [],
  };
}

function digest(d, ev) {
  switch (ev.type) {
    case 'meal': d.meals++; d.mealQuality += ev.quality; if (ev.algaeShare > 0.4) d.algaeMeals++; break;
    case 'wake': d.sleeps.push({ hours: ev.hours, quality: ev.quality }); break;
    case 'fault': d.faults.push({ component: ev.component, fault: ev.fault, severity: ev.severity }); break;
    case 'fault_escalated': d.faults.push({ component: ev.component, fault: ev.fault, severity: 'major', escalated: true }); break;
    case 'repair': d.repairs.push({ component: ev.component, fault: ev.fault, juryRig: ev.juryRig }); break;
    case 'repair_mistake': d.mistakes++; break;
    case 'maintenance': d.maintenance.push(ev.component); break;
    case 'harvest': d.harvests.push({ crop: ev.crop, kg: ev.kg }); break;
    case 'plant': d.plantings.push(ev.crop); break;
    case 'tray_died': d.deadTrays++; break;
    case 'spoiled': d.spoiledKg += ev.kg; break;
    case 'fabricate': for (const [k, v] of Object.entries(ev.made)) d.fabricated[k] = (d.fabricated[k] || 0) + v; break;
    case 'power_mode': d.powerModes.push(ev.mode); break;
    case 'alarm': d.alarms.push(ev.component); break;
    case 'hobby': d.hobbies[ev.activity] = (d.hobbies[ev.activity] || 0) + 1; break;
    case 'exercise': d.exercise++; break;
    case 'resource_low': d.resourceLow.push(ev.resource); break;
    case 'salvage': d.salvageKg += ev.kg; break;
    case 'system_arrival': d.arrivals.push({ system: ev.system, star: ev.star, label: ev.label, ly: ev.ly, via: ev.via }); break;
    case 'discovery': d.discoveries.push({ kind: ev.kind, body: ev.body, bodyType: ev.bodyType, rings: ev.rings, star: ev.star, label: ev.label, rarity: ev.rarity, first: ev.first, system: ev.system, anomaly: ev.anomaly }); break;
    case 'touchdown': d.landings.push({ body: ev.body, bodyType: ev.bodyType, gravity: ev.gravity, tempK: ev.tempK, first: ev.first }); break;
    case 'eva_end': d.evas.push({ body: ev.body, walkedM: ev.walkedM, features: ev.features, samples: ev.samples }); break;
    case 'docked': d.ports.push({ station: ev.station, system: ev.system, faction: ev.faction, first: ev.first }); break;
    case 'conversation': d.talks.push({ who: ev.who, role: ev.role, met: ev.met, topic: ev.topic, place: ev.place }); break;
    case 'mission_complete': d.missions.push({ done: true, kind: ev.kind, title: ev.title, reward: ev.reward }); break;
    case 'mission_fail': d.missions.push({ done: false, kind: ev.kind, title: ev.title, reason: ev.reason }); break;
    case 'rover_end': d.rovers.push({ body: ev.body, km: ev.km, features: ev.features, samples: ev.samples }); break;
    case 'scoop_end': d.scoops.push({ tons: ev.tons, peakHeat: ev.peakHeat, reason: ev.reason }); break;
    case 'awe': d.awe.push(ev.subject); break;
    case 'torpor_end': d.torpor = { years: ev.years, ly: ev.ly }; break;
    case 'heat_damage': d.heatDamage++; break;
    case 'keepsake': d.keepsakes.push(ev.label); break;
    case 'book_finished': d.books.push(ev.title); break;
    default: break;
  }
}

/** Remove and return all pending events. */
export function drain(state) {
  const out = state.outbox;
  state.outbox = [];
  return out;
}
