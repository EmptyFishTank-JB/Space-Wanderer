// Closed-loop water and atmosphere.
//   water:  potable -> traveler/plants -> grey (+ air humidity -> condensate)
//           grey -> recycler -> potable (small brine loss, offset by reactor
//           coolant-loop make-up water while the reactor runs)
//   air:    traveler consumes O2 / exhales CO2; crops and algae photosynthesise
//           under the grow lamps; the OGS splits potable water into O2; the
//           scrubber removes residual CO2; sealed O2 tanks are a last resort.
import { clamp, ph } from '../util.js';
import { factor } from './wear.js';
import { emit } from '../events.js';

export const AIR_WATER_SAT_L = 5.8; // litres of vapour at 100% RH for the cabin volume
const O2_PCT_PER_KG = 0.2625;
const CO2_PPM_PER_KG = 1830;

export function updateLifeSupport(state, data, dt) {
  const s = state.ship;
  const w = s.water;
  const a = s.atmo;
  const ops = s.ops;
  const C = s.components;
  const limp = s.power.mode === 'limp';
  const metab = 0.75 + 0.25 * (state.traveler.exertion ?? 0.8);

  // --- Water recycler ---
  const recEff = factor(state, data, 'water_recycler', 'efficiency') * (1 - 0.4 * C.water_recycler.wear) * (limp ? 0.5 : 1);
  ops.recyclerDuty = w.grey > 1 ? 1 : 0;
  const processed = w.grey > 1 ? Math.min(w.grey, ph(8 * recEff, dt)) : 0;
  w.grey -= processed;
  w.potable += processed * 0.985;
  w.lost += processed * 0.015;
  if (s.power.reactorOut > 0) w.potable += ph(0.07, dt);

  // --- Humidity / dehumidifier ---
  const hum = a.airWater / AIR_WATER_SAT_L;
  const deEff = factor(state, data, 'dehumidifier', 'efficiency') * (1 - 0.3 * C.dehumidifier.wear);
  const drip = C.dehumidifier.fault && data.components.dehumidifier.faults[C.dehumidifier.fault.severity].effect.leak ? 0.25 : 0;
  const removeLh = Math.min(2, 4 * deEff * Math.max(0, hum - 0.42));
  a.airWater += ph((ops.transpiration || 0) + 0.04 * metab - removeLh, dt);
  w.grey += ph(removeLh, dt) * (1 - drip);
  w.lost += ph(removeLh, dt) * drip;
  if (a.airWater > AIR_WATER_SAT_L) {
    // condenses on bulkheads and bay glass; most is mopped into grey water
    const excess = a.airWater - AIR_WATER_SAT_L;
    a.airWater = AIR_WATER_SAT_L;
    w.grey += excess * 0.8;
    w.lost += excess * 0.2;
  }
  a.airWater = Math.max(0.5, a.airWater);

  // --- Oxygen ---
  const photo = ops.photoO2 || 0;
  const ogsEff = factor(state, data, 'ogs', 'efficiency') * (1 - 0.3 * C.ogs.wear) * (limp ? 0.5 : 1);
  const deficit = 20.95 - a.o2;
  let ogsRate = deficit > 0 ? Math.min(0.09 * ogsEff, 0.09 * clamp(deficit / 0.3)) : 0;
  if (w.potable < 5) ogsRate = 0;
  w.potable -= ph(ogsRate * 1.125, dt);
  ops.ogsDuty = ogsRate / 0.09;
  let reserveRate = 0;
  if (a.o2 < 19.6 && a.o2Reserve > 0) {
    reserveRate = 0.12;
    a.o2Reserve = Math.max(0, a.o2Reserve - ph(reserveRate, dt));
  }
  const sc = C.o2_scrubber.fault;
  const hull = C.hull_plating.fault;
  const leak = (sc && data.components.o2_scrubber.faults[sc.severity].effect.leak ? 0.02 : 0) +
    (hull && data.components.hull_plating.faults[hull.severity].effect.leak ? 0.03 : 0);
  a.o2 = clamp(a.o2 + ph(photo + ogsRate + reserveRate - 0.035 * metab - leak, dt) * O2_PCT_PER_KG, 15, 22.5);

  // --- Carbon dioxide ---
  const scrEff = factor(state, data, 'o2_scrubber', 'efficiency') * (1 - 0.35 * C.o2_scrubber.wear) * (limp ? 0.6 : 1);
  const scrRate = a.co2 > 600 ? Math.min(0.17 * scrEff, ((a.co2 - 600) / CO2_PPM_PER_KG) * 0.5) : 0;
  ops.scrubberDuty = scrRate / 0.17;
  a.co2 = clamp(a.co2 + ph((0.042 * metab - photo * 1.375 - scrRate) * CO2_PPM_PER_KG, dt), 350, 20000);

  // --- Water reserve (sealed tank) ---
  if (w.potable < 10 && w.reserve > 0) {
    const draw = Math.min(w.reserve, 20);
    w.reserve -= draw;
    w.potable += draw;
    emit(state, 'emergency_reserve', { resource: 'water', litres: draw });
  } else if (w.potable > 220 && w.reserve < w.reserveCap) {
    const top = Math.min(w.reserveCap - w.reserve, ph(1, dt));
    w.reserve += top;
    w.potable -= top;
  }
  const total = w.potable + w.grey;
  if (total > w.capacity) w.potable -= total - w.capacity; // overflow to brine/vent
  w.potable = Math.max(0, w.potable);

  watch(state, 'water', w.potable, 60, 100);
  watch(state, 'co2', -a.co2, -2500, -1500);
  watch(state, 'o2', a.o2, 19.5, 20.3);
}

/** Emits resource_low / resource_recovered with hysteresis. */
export function watch(state, key, value, low, recover) {
  const flags = state.ship.flags;
  const k = 'low_' + key;
  if (!flags[k] && value < low) {
    flags[k] = true;
    emit(state, 'resource_low', { resource: key, value: Math.abs(value) });
  } else if (flags[k] && value > recover) {
    flags[k] = false;
    emit(state, 'resource_recovered', { resource: key, value: Math.abs(value) });
  }
}
