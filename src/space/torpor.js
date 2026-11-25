// Deep-void torpor: the in-world longevity model. When the route meets a
// galactic rift, the traveler winterises the hydroponics bay and spends one
// long night (10–15 real hours) in the torpor pod while the ship crosses the
// void. The mission calendar advances by years — always whole days, so the
// ship's clock keeps its rhythm. Ship systems idle at minimum while they sleep.
import { clamp, DAY } from '../sim/util.js';
import { emit } from '../sim/events.js';
import { arriveSystem } from './flight.js';
import { feelWonder } from './discovery.js';

export function beginTorpor(state, data, a) {
  const sp = state.space;
  const v = sp.void;
  state.ship.flight.mode = 'void';
  state.ship.flight.at = null;
  state.ship.flight.target = null;
  a.params.years = v.years;
  emit(state, 'torpor_start', { years: Math.round(v.years * 10) / 10, ly: Math.round(v.ly), to: v.name, room: 'quarters' });
}

export function endTorpor(state, data, a) {
  const sp = state.space;
  const v = sp.void;
  const tr = state.traveler;
  const days = Math.max(1, Math.round(v.years * 365.25));
  state.calendar.torporSeconds += days * DAY;
  sp.void = null;
  sp.stats.torpors++;
  sp.stats.torporYears += days / 365.25;
  sp.stats.ly += v.ly;
  state.ship.hydroDormant = false;
  // Years of cold idle leave their mark on the hardware.
  for (const id of data.componentIds) {
    const c = state.ship.components[id];
    c.wear = clamp(c.wear + 0.02);
  }
  // Revival: groggy, hungry, weak — and the sky has changed.
  const n = tr.needs;
  n.fatigue = Math.max(n.fatigue, 0.45);
  n.hunger = Math.max(n.hunger, 0.75);
  n.thirst = Math.max(n.thirst, 0.8);
  n.hygiene = Math.max(n.hygiene, 0.6);
  n.stress = clamp(n.stress + 0.08);
  n.solitude = clamp(n.solitude + 0.15);
  tr.body.fitness = clamp(tr.body.fitness - 0.08);
  tr.mood.weariness = clamp(tr.mood.weariness - 0.25);
  tr.history.lastWakeT = state.t;
  emit(state, 'torpor_end', { years: Math.round((days / 365.25) * 10) / 10, ly: Math.round(v.ly), room: 'quarters' });
  arriveSystem(state, data, v.star, { ly: v.ly, via: 'void' });
  feelWonder(state, 0.12, true);
  tr.routine = { id: 'morning', i: 0, startT: state.t };
}
