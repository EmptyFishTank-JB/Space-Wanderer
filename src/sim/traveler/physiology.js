// Traveler physiology and mood drift. Needs are 0..1 where 1 is urgent.
// Mood is two slow axes: wonder (awe, curiosity satisfied) and weariness
// (monotony, strain). Weariness is soft-capped and pulled back by a
// resilience term: the traveler can be tired of the void, never broken by it.
import { clamp, ph, pd, ramp, approach } from '../util.js';
import { pantryDays } from '../ship/food.js';
import { emit } from '../events.js';

export function stressTarget(state) {
  const s = state.ship;
  const n = state.traveler.needs;
  let t = 0.12;
  let faultLoad = 0;
  for (const id in s.components) {
    const c = s.components[id];
    if (c.fault && c.known) faultLoad += c.fault.severity === 'major' ? 0.12 : 0.04;
  }
  t += Math.min(0.35, faultLoad);
  t += 0.25 * ramp(s.atmo.co2, 1500, 5000);
  t += 0.2 * ramp(19.5 - s.atmo.o2, 0, 2);
  t += 0.15 * ramp(n.hunger, 0.75, 1);
  t += 0.15 * ramp(n.thirst, 0.7, 1);
  t += 0.15 * ramp(n.fatigue, 0.8, 1);
  t += 0.06 * ramp(n.hygiene, 0.8, 1);
  t += 0.1 * ramp(30 - pantryDays(state), 0, 30) * (s.food.emergencyOpened ? 1.5 : 1);
  t += 0.1 * ramp(80 - s.water.potable, 0, 60);
  t += s.power.mode === 'limp' ? 0.15 : s.power.mode === 'conserve' ? 0.05 : 0;
  t += 0.1 * ramp(s.thermal.heat, 0.75, 1.1);
  let clutter = 0;
  for (const r in s.clutter) clutter += s.clutter[r];
  t += 0.06 * ramp(clutter / Object.keys(s.clutter).length, 0.35, 0.7);
  let plants = 0;
  let live = 0;
  for (const tr of s.trays) if (tr.crop && !tr.dead) { plants += tr.health; live++; }
  if (live > 0 && plants / live > 0.75) t -= 0.03;
  return clamp(t);
}

/**
 * Continuous physiology for dt seconds. `exertion` comes from the current
 * activity (0 asleep, 0.5 seated, 1 standing work, 1.6 heavy labour, 3 exercise).
 * `rates` are the activity's own per-hour need deltas.
 */
export function updatePhysiology(state, data, dt, exertion, asleep, rates) {
  const tr = state.traveler;
  const n = tr.needs;
  const b = tr.body;
  const m = tr.mood;
  const a = state.ship.atmo;

  if (!asleep) {
    const env = 1 + 0.5 * ramp(a.co2, 2000, 5000) + 0.3 * ramp(19.5 - a.o2, 0, 2);
    n.fatigue += ph(0.052 * (0.7 + 0.3 * exertion) * env * (1 + 0.2 * n.stress) * (1.15 - 0.3 * b.fitness), dt);
  }
  n.hunger += ph((asleep ? 0.05 : 0.12) * (0.85 + 0.15 * exertion), dt);
  n.thirst += ph((asleep ? 0.05 : 0.17) * (0.8 + 0.2 * exertion) * (state.ship.thermal.heat > 0.6 ? 1.3 : 1), dt);
  n.hygiene += ph((asleep ? 0.012 : 0.028) * (0.7 + 0.3 * exertion), dt);
  n.bladder += ph(asleep ? 0.045 : 0.12, dt);
  if (n.bladder >= 1) n.stress += ph(0.3, dt); // holding it is miserable
  n.solitude += ph((asleep ? 0.005 : 0.018) * (1 + 0.5 * m.weariness) * (1.25 - 0.5 * data.traveler.traits.sociability), dt);

  // stress relaxes toward what the ship's condition justifies
  n.stress = approach(n.stress, stressTarget(state), ph(0.12, dt));

  if (rates) for (const k in rates) {
    if (k in n) n[k] += ph(rates[k], dt);
    else if (k in m) m[k] += ph(rates[k], dt);
    else if (k in b) b[k] += ph(rates[k], dt);
  }
  for (const k in n) n[k] = clamp(n[k]);

  // body condition: only real deprivation hurts; it always recovers
  const deprived = n.hunger >= 1 || n.thirst >= 1 || a.co2 > 6000 || a.o2 < 17;
  // floor: the failsafes (algae, reserve water, O2 candles) always keep them alive
  b.condition = clamp(b.condition + (deprived ? -ph(0.02, dt) : ph(0.01, dt)), 0.15, 1);
  b.fitness = clamp(b.fitness - pd(0.012, dt));

  // --- mood drift ---
  const res = data.traveler.traits.resilience;
  tr.history.daysSinceNovelty += dt / 86400;
  // wonder relaxes toward a curious baseline over a few days
  const wonderBase = 0.25 + 0.15 * data.traveler.traits.curiosity;
  m.wonder += pd((wonderBase - m.wonder) / 2.5, dt);
  // weariness: monotony and strain push up, rest and resilience pull back
  let up = 0.02 * (tr.history.daysSinceNovelty > 3 ? 1 : 0.3) + 0.04 * Math.max(0, n.stress - 0.4) + 0.015 * n.solitude;
  up *= m.weariness > 0.55 ? (1 - m.weariness) / 0.45 : 1; // soft cap
  const down = (n.stress < 0.2 ? 0.004 : 0) + (res * (m.weariness - 0.3)) / 6;
  m.weariness += pd(up - down, dt);
  m.wonder = clamp(m.wonder, 0.08, 1);
  m.weariness = clamp(m.weariness, 0, 0.78);
}

/** Walking speed multiplier — the gait the renderer will animate. */
export function gait(state) {
  const n = state.traveler.needs;
  const m = state.traveler.mood;
  return clamp(1.05 - 0.45 * Math.max(0, n.fatigue - 0.45) - 0.12 * m.weariness + 0.08 * m.wonder - 0.1 * Math.max(0, n.stress - 0.5), 0.55, 1.15);
}

/** Work-speed multiplier for chores (>1 = slower). */
export function workSlowdown(state) {
  const n = state.traveler.needs;
  return 1 + 0.6 * Math.max(0, n.fatigue - 0.5) + 0.15 * n.stress;
}

export function checkCollapse(state) {
  const n = state.traveler.needs;
  if (n.fatigue >= 0.995) {
    emit(state, 'collapse', { room: state.traveler.pos.room });
    return true;
  }
  return false;
}
