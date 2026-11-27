// Discovery: what the traveler learns about each system, and how it moves
// them. New star classes, rare worlds and signals feed wonder and reset the
// monotony clock; long chains of dim red dwarfs let weariness creep in.
import { clamp } from '../sim/util.js';
import { rand } from '../sim/rng.js';
import { emit } from '../sim/events.js';
import { missionDay } from '../sim/clock.js';
import { factor } from '../sim/ship/wear.js';

export function feelWonder(state, amount, novelty = false) {
  const m = state.traveler.mood;
  // diminishing returns: a mind already full of wonder takes in less
  m.wonder = clamp(m.wonder + amount * (1 - m.wonder));
  const h = state.traveler.history;
  // Wonder and weariness are separate axes: a pretty view lifts the mood but
  // only genuinely new things cut through the long-haul tiredness.
  if (novelty) {
    h.daysSinceNovelty = 0;
    m.weariness = clamp(m.weariness - amount * 0.25);
  }
}

function record(state, kind, data) {
  const sp = state.space;
  const rec = { kind, day: missionDay(state), ...data };
  sp.discoveries.push(rec);
  sp.stats.discoveries[kind] = (sp.stats.discoveries[kind] || 0) + 1;
  emit(state, 'discovery', { kind, ...data, room: 'bridge' });
}

export function onArrival(state, data, sys, { ly, via }) {
  const sp = state.space;
  const cls = sys.star.type || sys.star.cls; // a red giant is a new sight even after many K dwarfs
  const first = !sp.classesSeen[cls];
  sp.classesSeen[cls] = (sp.classesSeen[cls] || 0) + 1;
  emit(state, 'system_arrival', {
    system: sys.name, systemId: sys.id, star: cls, label: sys.star.label, color: sys.star.color,
    ly: Math.round(ly * 100) / 100, via, first, bodies: sys.bodies.length, scoopable: sys.star.scoopable,
  });
  const r = sys.star.rarity;
  feelWonder(state, 0.01 + 0.06 * r * (first ? 1.5 : 1), first || r >= 0.9);
  if (!first && r < 0.9) {
    // another ordinary sun: a little fresh, not new
    const h = state.traveler.history;
    h.daysSinceNovelty = Math.max(0, h.daysSinceNovelty - 0.15);
  }
  if (first || r >= 0.85) record(state, 'star', { system: sys.name, star: cls, label: sys.star.label, rarity: r, first });
}

function notable(b) {
  const giant = b.type === 'gas_giant' || b.type === 'ice_giant';
  return b.type === 'earth_like' || b.type === 'water_world' || b.type === 'ammonia' || (b.rings && giant) ||
    (b.rings && !giant) || b.signals.bio > 0 || b.signals.geo >= 3 || !!b.signals.anomaly;
}

/** Full-spectrum survey from the bridge. Sensor wear hides faint bodies. */
export function surveySystem(state, data, sys) {
  const sp = state.space;
  const q = factor(state, data, 'bridge_sensors', 'sensorQuality') * (1 - 0.25 * state.ship.components.bridge_sensors.wear);
  const detected = sys.bodies.filter((b) => q >= 0.8 || rand(state.rng) < q + 0.15).map((b) => b.id);
  sp.detected = detected;
  sp.surveyed = true;
  let count = 0;
  for (const id of detected) {
    const b = sys.byId[id];
    if (!notable(b)) continue;
    count++;
    const firstType = !sp.typesSeen[b.type];
    sp.typesSeen[b.type] = (sp.typesSeen[b.type] || 0) + 1;
    record(state, 'body', { system: sys.name, body: b.name, bodyId: b.id, bodyType: b.type, rings: b.rings, signals: b.signals, rarity: b.rarity });
    feelWonder(state, (0.01 + 0.04 * b.rarity) / Math.max(1, count * 0.7), firstType && b.rarity >= 0.6);
  }
  emit(state, 'system_survey', { system: sys.name, detected: detected.length, total: sys.bodies.length, notable: count, sensorQuality: Math.round(q * 100) / 100 });
  return { detected: detected.length, notable: count };
}

/** Detailed surface scan from orbit. */
export function scanBody(state, data, sys, b) {
  const sp = state.space;
  sp.scanned[b.id] = true;
  sp.stats.scans++;
  sp.dataUnsold = (sp.dataUnsold || 0) + 1;
  emit(state, 'body_scan', {
    body: b.name, bodyId: b.id, bodyType: b.type, gravity: Math.round(b.gravity * 100) / 100, tempK: b.tempK,
    atmosphere: b.atmosphere, landable: b.landable, signals: b.signals, ore: b.ore, room: 'bridge',
  });
  if (b.signals.bio > 0) {
    record(state, 'bio_signal', { system: sys.name, body: b.name, bodyId: b.id, count: b.signals.bio });
    feelWonder(state, 0.12, true);
  }
  if (b.signals.anomaly) {
    record(state, 'anomaly', { system: sys.name, body: b.name, bodyId: b.id, anomaly: b.signals.anomaly });
    feelWonder(state, 0.15, true);
  }
}

export function addKeepsake(state, item) {
  const ks = state.traveler.keepsakes;
  ks.push({ ...item, day: missionDay(state) });
  if (ks.length > 24) ks.shift();
  emit(state, 'keepsake', { ...item, room: 'quarters' });
}

/** Life confirmed in person. The mission's reason for being. */
export function confirmLife(state, data, sys, b) {
  const sp = state.space;
  if (sp.lifeConfirmed[b.id]) return;
  sp.lifeConfirmed[b.id] = true;
  record(state, 'life', { system: sys.name, body: b.name, bodyId: b.id, bodyType: b.type });
  feelWonder(state, 0.3, true);
  state.traveler.needs.solitude = clamp(state.traveler.needs.solitude - 0.25);
  addKeepsake(state, { kind: 'bio_sample', label: `sealed sample vial — ${b.name}` });
}
