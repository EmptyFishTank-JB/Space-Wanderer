// Hydroponic racks and the algae vat. Plants depend on grow-lamp power, pump
// irrigation, humidity, CO2 and the traveler's care; they in turn feed the
// atmosphere (O2) and the galley.
import { clamp, ph, pd, smooth } from '../util.js';
import { factor } from './wear.js';
import { emit } from '../events.js';
import { AIR_WATER_SAT_L } from './lifesupport.js';

export const TRAY_RESERVOIR_L = 8;

export function trayBank(i) {
  return i < 5
    ? { lamp: 'grow_lamps_a', pump: 'hydro_pump_1' }
    : { lamp: 'grow_lamps_b', pump: 'hydro_pump_2' };
}

/** Visual stage for the renderer and logs. */
export function trayStage(tray) {
  if (!tray.crop) return 'empty';
  if (tray.dead) return 'dead';
  if (tray.health < 0.45) return 'wilting';
  if (tray.growth < 0.2) return 'seedling';
  if (tray.growth < 0.8) return 'healthy';
  if (tray.growth <= 1.1) return 'mature';
  return 'overgrown';
}

export function updateHydro(state, data, dt) {
  const s = state.ship;
  if (s.hydroDormant) {
    // winterised for torpor: chilled, dark, metabolism suspended
    s.ops.photoO2 = 0;
    s.ops.transpiration = 0;
    return;
  }
  const ops = s.ops;
  const p = s.power;
  const w = s.water;
  const pp = data.photoperiod;
  const photoFrac = (pp.off - pp.on) / 24;
  const careHours = (state.t - state.traveler.history.lastTendT) / 3600;
  const hum = s.atmo.airWater / AIR_WATER_SAT_L;
  const co2 = s.atmo.co2;
  let photo = 0;
  let transp = 0;

  for (let i = 0; i < s.trays.length; i++) {
    const tray = s.trays[i];
    if (!tray.crop || tray.dead) continue;
    const bank = trayBank(i);
    const crop = data.crops[tray.crop];
    const light = ops.lampOn ? p.lampLevel * factor(state, data, bank.lamp, 'level') : 0;
    const flow = factor(state, data, bank.pump, 'flow') * (1 - 0.3 * s.components[bank.pump].wear);
    const canopy = clamp(tray.growth * 1.4, 0.05, 1);

    // water use and auto-irrigation
    const tl = 0.12 * canopy * light * (0.5 + 0.5 * tray.health);
    tray.water = clamp(tray.water - ph(tl, dt) / TRAY_RESERVOIR_L);
    transp += tl;
    if (tray.water < 0.85 && flow > 0 && w.potable > 5) {
      const add = Math.min(ph(2 * flow, dt), (0.95 - tray.water) * TRAY_RESERVOIR_L);
      tray.water += add / TRAY_RESERVOIR_L;
      w.potable -= add;
    }

    // growth: cycleDays assumes full lamps over the photoperiod
    const wf = smooth(tray.water, 0.12, 0.45);
    const rate = (light / photoFrac / crop.cycleDays) * (0.35 + 0.65 * tray.health) * wf;
    tray.growth += pd(rate, dt);

    // health
    let dh = 0;
    if (tray.water < 0.25) dh -= 0.25 * (1 - tray.water / 0.25);
    if (tray.growth > 1.1) dh -= 0.05;
    if (careHours > 60) dh -= 0.02;
    if (hum > 0.85) dh -= 0.04;
    if (co2 > 4000) dh -= 0.03;
    if (ops.lampOn && light < 0.05) dh -= 0.05;
    if (dh === 0 && tray.water > 0.4 && tray.health < 0.92) dh = 0.015;
    tray.health = clamp(tray.health + pd(dh, dt));
    if (tray.health <= 0) {
      tray.dead = true;
      emit(state, 'tray_died', { tray: i, crop: tray.crop, room: 'hydro' });
    }
    photo += 0.0028 * canopy * tray.health * light;
  }

  // algae vat — the hardy backstop: the culture never fully dies (a starter
  // culture is kept frozen), so there is always something to eat.
  const alg = s.algae;
  const aLight = ops.lampOn ? Math.max(p.lampLevel, 0.3) : 0;
  const g = factor(state, data, 'algae_bubbler', 'growth');
  const algaeCareH = (state.t - state.traveler.history.lastAlgaeT) / 3600;
  alg.density = clamp(alg.density + pd(0.5 * alg.density * (1 - alg.density) * (aLight / photoFrac) * alg.health * g - 0.02 * alg.density, dt), 0.05, 1);
  alg.buffer = Math.min(9000, alg.buffer + pd(1100 * alg.density * alg.health * (aLight / photoFrac) * g, dt));
  alg.health = clamp(alg.health + pd(algaeCareH > 96 ? -0.03 : alg.health < 0.9 ? 0.01 : 0, dt), 0.1, 1);
  photo += 0.02 * alg.density * alg.health * aLight * g;

  ops.photoO2 = photo;
  ops.transpiration = transp;
}

/** Choose what to plant in an empty rack: the most under-represented crop we hold seed for. */
export function chooseCrop(state, data) {
  const counts = {};
  for (const t of state.ship.trays) if (t.crop && !t.dead) counts[t.crop] = (counts[t.crop] || 0) + 1;
  let best = null;
  let bestGap = -Infinity;
  for (const id of data.cropIds) {
    const have = state.ship.seeds[id] + state.ship.seedVault[id];
    if (have <= 0) continue;
    const gap = data.crops[id].targetTrays - (counts[id] || 0);
    if (gap > bestGap) { bestGap = gap; best = id; }
  }
  return best;
}
