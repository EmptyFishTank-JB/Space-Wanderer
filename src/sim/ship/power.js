// Reactor, battery, load shedding and the thermal loop.
import { clamp, ph, inWindow } from '../util.js';
import { shipHour } from '../clock.js';
import { factor } from './wear.js';
import { emit } from '../events.js';

const REACTOR_NOMINAL_KW = 40;
const FUEL_T_PER_HOUR_AT_FULL = 0.0012;

/** Derive activity-driven loads from what the traveler is actually doing. */
export function updateOps(state, data) {
  const ops = state.ship.ops;
  const a = state.traveler.activity;
  const performing = a && a.phase === 'perform' && !state.traveler.move;
  ops.cooking = performing && a.id === 'cook_meal' && !!a.params.hot;
  ops.fabricating = performing && a.id === 'fabricate';
  ops.workshopTools = performing && state.traveler.pos.room === 'workshop' && (a.id === 'repair' || a.id === 'maintain');
  const h = shipHour(state);
  ops.lampOn = !state.ship.hydroDormant && inWindow(h, data.photoperiod.on, data.photoperiod.off);
}

export function updatePower(state, data, dt) {
  const s = state.ship;
  const p = s.power;
  const ops = s.ops;
  const h = shipHour(state);

  // --- Load-shedding policy (from the mode decided last tick) ---
  const modeLamp = p.mode === 'normal' ? 1 : p.mode === 'conserve' ? 0.55 : 0;
  const modeLight = p.mode === 'normal' ? 1 : p.mode === 'conserve' ? 0.65 : 0.3;
  const dayLight = inWindow(h, 6.5, 22.5) ? 1 : 0.35; // circadian cabin lighting
  p.lampLevel = modeLamp;
  p.lightLevel = modeLight * dayLight;

  // --- Demand (kW) ---
  const lampA = ops.lampOn ? 7.0 * p.lampLevel * factor(state, data, 'grow_lamps_a', 'level') : 0;
  const lampB = ops.lampOn ? 7.0 * p.lampLevel * factor(state, data, 'grow_lamps_b', 'level') : 0;
  const algaeLamp = ops.lampOn ? 0.9 * Math.max(p.lampLevel, 0.3) : 0;
  let demand =
    3.2 + // computers, fans, avionics
    1.6 * p.lightLevel +
    0.8 + // sensor array
    1.8 + // drive standby
    1.5 * (0.3 + 0.7 * ops.recyclerDuty) +
    2.6 * ops.ogsDuty +
    1.0 * ops.scrubberDuty +
    0.7 + // dehumidifier
    lampA + lampB + algaeLamp +
    0.35 * (factor(state, data, 'hydro_pump_1', 'flow') + factor(state, data, 'hydro_pump_2', 'flow'));
  const galleyPowered = factor(state, data, 'junction_box_fore', 'galleyPower') > 0;
  if (ops.cooking && galleyPowered) demand += 2.2;
  if (ops.fabricating) demand += 4.0;
  if (ops.workshopTools) demand += 1.0;
  const jb = s.components.junction_box_fore.fault;
  if (jb) demand += data.components.junction_box_fore.faults[jb.severity].effect.powerLoss || 0; // arcing losses

  // --- Supply ---
  const fuelOk = s.fuel.tons > 0.05;
  const hot = s.thermal.heat > 1.0;
  p.reactorMax = fuelOk ? REACTOR_NOMINAL_KW * factor(state, data, 'reactor_core', 'output') * (hot ? 0.5 : 1) : 0;
  p.solar = s.flight.solarKW;
  const chargeWant = p.battery < p.batteryCap ? Math.min(8, (p.batteryCap - p.battery) * 2) : 0;
  p.reactorOut = clamp(demand + chargeWant - p.solar, 0, p.reactorMax);
  const net = p.reactorOut + p.solar - demand;
  p.battery = clamp(p.battery + ph(net, dt), 0, p.batteryCap);
  p.supply = p.reactorOut + p.solar;
  p.demand = demand;
  ops.reactorFrac = p.reactorOut / REACTOR_NOMINAL_KW;
  s.fuel.tons = Math.max(0, s.fuel.tons - ph(FUEL_T_PER_HOUR_AT_FULL * ops.reactorFrac, dt));

  // --- Mode transitions with hysteresis ---
  const soc = p.battery / p.batteryCap;
  const canCover = p.reactorMax + p.solar >= demand * 1.05;
  let mode = p.mode;
  if (mode === 'normal' && soc < 0.45 && net < 0) mode = 'conserve';
  else if (mode === 'conserve' && soc < 0.12) mode = 'limp';
  else if (mode === 'conserve' && soc > 0.6 && canCover) mode = 'normal';
  else if (mode === 'limp' && soc > 0.3) mode = 'conserve';
  if (mode !== p.mode) {
    emit(state, 'power_mode', { mode, from: p.mode, battery: Math.round(soc * 100) });
    p.mode = mode;
  }
}

export function updateThermal(state, data, dt) {
  const s = state.ship;
  const th = s.thermal;
  const gen = 0.42 * s.ops.reactorFrac * factor(state, data, 'reactor_core', 'heat') + 0.06 + s.flight.externalHeat;
  const vents = s.components.thermal_vents;
  const eff = factor(state, data, 'thermal_vents', 'efficiency') * (1 - 0.3 * vents.wear);
  const diss = 1.45 * eff * Math.max(0, th.heat - 0.05);
  th.heat = clamp(th.heat + ((gen - diss) * dt) / 600, 0, 1.5);
  const over = th.heat > 0.8;
  if (over && !th.overheat) emit(state, 'overheat', { heat: th.heat });
  th.overheat = over;
}
