// The fixed-step simulation core. `step` advances exactly one tick (1 s). It
// depends only on (state, data) — no wall clock, no DOM, no Math.random — so
// live play and offline catch-up produce identical histories.
//
// Cadences (all tick-indexed, so deterministic):
//   every tick         traveler movement, activity progress, decisions
//   every slowEvery    ship systems + physiology (dt = slowEvery)
//   every hazardEvery  wear, faults, spoilage, perception (dt = hazardEvery)
import { tickTraveler, currentExertion, isAsleep, actionDef } from './ai/brain.js';
import { updateOps, updatePower, updateThermal } from './ship/power.js';
import { updateLifeSupport } from './ship/lifesupport.js';
import { updateHydro } from './ship/hydroponics.js';
import { updateFood } from './ship/food.js';
import { updateWear } from './ship/wear.js';
import { updatePhysiology } from './traveler/physiology.js';
import { updateMug } from './traveler/mug.js';
import { chargeRover } from '../space/rover.js';
import { expireMissions } from '../space/ports.js';
import { tickPassengers } from '../space/passengers.js';
import { stepCombat, checkEncounters } from '../space/combat.js';
import { missionDay } from './clock.js';
import { updateFlight, updateFlightEnvironment } from '../space/flight.js';
import { advanceAgenda } from '../space/navigator.js';

export function step(state, data) {
  const cfg = data.config;
  state.t += 1;
  state.tick += 1;

  updateFlight(state, data, 1);
  if (state.space) stepCombat(state, data, 1);
  tickTraveler(state, data, 1);

  if (state.tick % cfg.slowEvery === 0) slowTick(state, data, cfg.slowEvery);
  if (state.tick % cfg.hazardEvery === 0) hazardTick(state, data, cfg.hazardEvery);
}

function slowTick(state, data, dt) {
  const tr = state.traveler;
  tr.exertion = currentExertion(state);
  updateFlightEnvironment(state, data, dt);
  advanceAgenda(state, data);
  updateOps(state, data);
  updatePower(state, data, dt);
  updateThermal(state, data, dt);
  updateHydro(state, data, dt);
  updateLifeSupport(state, data, dt);

  const a = tr.activity;
  const performing = a && a.phase === 'perform' && !tr.move;
  const def = performing ? actionDef(a.id) : null;
  // In torpor the body is held: no needs accrue and mood does not drift.
  if (!(performing && a.id === 'enter_torpor')) updatePhysiology(state, data, dt, tr.exertion, isAsleep(state), def && def.rates);
  if (def && def.tick) def.tick(state, data, a, dt);
  updateMug(state, dt);
  if (state.ship.rover && state.space) chargeRover(state, data, dt);
  if (state.space) { expireMissions(state); tickPassengers(state, data, dt); checkEncounters(state, data, dt); }

  const day = missionDay(state);
  if (tr.history.mealsDay !== day) {
    tr.history.mealsDay = day;
    tr.history.mealsToday = 0;
  }
}

function hazardTick(state, data, dt) {
  updateWear(state, data, dt);
  updateFood(state, data, dt);
}

/** Advance n ticks synchronously. */
export function run(state, data, n) {
  for (let i = 0; i < n; i++) step(state, data);
}
