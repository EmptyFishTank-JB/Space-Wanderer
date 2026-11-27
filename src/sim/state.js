// Initial simulation state. Everything is plain JSON so a snapshot is just
// JSON.stringify(state). Units: litres, kg, kcal, kW, kWh, tonnes (fuel),
// ppm (CO2), percent (O2), 0..1 for needs/wear/health.
import { seedRng, range, int } from './rng.js';
import { baseSecondsFor } from './clock.js';
import { emptyDigest } from './events.js';
import { initSpace } from '../space/init.js';

export const STATE_VERSION = 10;

export function createInitialState(data, { seed = 'terrarium' } = {}) {
  const rng = seedRng(seed);
  const cfg = data.config;

  const components = {};
  for (const id of data.componentIds) {
    const def = data.components[id];
    const wear = range(rng, def.initialWear[0], def.initialWear[1]);
    components[id] = { wear, fault: null, knownWear: wear, known: false, patched: false, runHours: 0 };
  }

  // Ten racks, staggered so the bay looks lived-in from the first frame.
  const layout = ['potato', 'soy', 'wheat', 'soy', 'tomato', 'potato', 'soy', 'wheat', 'lettuce', 'herbs'];
  const trays = layout.map((crop, i) => ({
    crop,
    growth: i === 8 ? 0.95 : range(rng, 0.05, 0.85),
    health: range(rng, 0.78, 0.95),
    water: range(rng, 0.7, 0.95),
    dead: false,
    plantedDay: 0,
  }));

  const clutter = {};
  for (const id of data.roomIds) clutter[id] = range(rng, 0.03, 0.18);

  const sched = data.traveler.schedule;
  const baseSeconds = baseSecondsFor(cfg.missionStart);
  const startDay = Math.floor(baseSeconds / 86400);

  const state = {
    version: STATE_VERSION,
    seed: String(seed),
    rng,
    t: 0,
    tick: 0,
    calendar: { baseSeconds, torporSeconds: 0 },
    ship: {
      power: { mode: 'normal', battery: 190, batteryCap: 250, supply: 0, demand: 0, reactorOut: 0, reactorMax: 40, solar: 0.6, lampLevel: 1, lightLevel: 1 },
      thermal: { heat: 0.34, external: 0, overheat: false },
      fuel: { tons: 47.2, capacity: 64 },
      rover: { charge: 1, out: false, odometerKm: 0 },
      water: { potable: 255, gray: 35, capacity: 400, reserve: 60, reserveCap: 60, lost: 0 },
      atmo: { o2: 20.9, co2: 780, airWater: 2.6, o2Reserve: 40 },
      food: { pantry: 150000, algae: 2500, emergency: 75000, emergencyOpened: false, fresh: [], compost: 4, mealReady: null },
      algae: { density: 0.7, health: 0.88, buffer: 1800 },
      trays,
      seeds: { potato: 6, soy: 8, wheat: 6, tomato: 5, lettuce: 9, herbs: 7 },
      seedVault: { potato: 4, soy: 4, wheat: 4, tomato: 4, lettuce: 4, herbs: 4 },
      inventory: { parts: 22, filters: 6, cartridges: 5, seals: 16, feedstock: 48 },
      salvage: { remainingKg: 180 },
      components,
      clutter,
      ops: { cooking: false, fabricating: false, workshopTools: false, recyclerDuty: 0, ogsDuty: 0, scrubberDuty: 1, reactorFrac: 0.7, lampOn: false },
      flight: null, // set by initSpace
      flags: {},
    },
    traveler: {
      pos: { room: 'quarters', x: data.rooms.quarters.stations.bunk },
      move: null,
      activity: {
        id: 'sleep', params: {}, loc: { room: 'quarters', station: 'bunk' }, phase: 'perform',
        startT: -6.2 * 3600, performT: -6.2 * 3600, duration: -1 /* open-ended */, elapsed: 6.2 * 3600,
        score: 0.8, commitUntil: 0, category: 'sleep', routine: null,
      },
      routine: null,
      needs: { fatigue: 0.16, hunger: 0.42, thirst: 0.38, hygiene: 0.33, stress: 0.2, solitude: 0.34, bladder: 0.3 },
      outfit: defaultOutfit(),
      body: { fitness: 0.72, condition: 0.96 },
      mood: { wonder: 0.45, weariness: 0.3 },
      history: {
        lastMealT: -9 * 3600, mealsDay: -1, mealsToday: 0,
        lastExerciseT: -30 * 3600, lastWashT: -14 * 3600, lastTendT: -16 * 3600, lastAlgaeT: -20 * 3600,
        lastScanT: -14 * 3600, lastNavT: -30 * 3600, lastInspectEngT: -40 * 3600, lastInspectLsT: -40 * 3600,
        lastStorageT: -3 * 86400, lastLogDay: startDay - 1, eveningDay: startDay - 1, lastRoundsT: -30 * 3600,
        lastWakeT: -30 * 3600, lastSleepT: -6.2 * 3600, lastToiletT: -3 * 3600, lastDressDay: startDay - 1, laundry: 0,
        recent: {}, // action id -> last completion t (boredom / repetition)
        daysSinceNovelty: 3.5,
        sketches: 0, logsWritten: int(rng, 3000, 3400),
      },
      prefs: { sleepHour: sched.sleepHour, wakeHour: sched.wakeHour },
    },
    journal: {
      nextId: 1,
      recent: [],
      recentLimit: cfg.journal.recentLimit,
      outboxLimit: cfg.journal.outboxLimit,
      sinceLastLog: emptyDigest(),
    },
    outbox: [],
  };
  initSpace(state, data);
  initMemory(state);
  return state;
}

/** Phase 5 state: episodic memory, written logs, skills and the bookshelf. */
export function initMemory(state) {
  state.memory = state.memory || { records: [], nextId: 1, logs: [] };
  const tr = state.traveler;
  tr.skills = tr.skills || { instrument: 0.15, sketch: 0.35, chess: 0.2 };
  tr.library = tr.library || { book: 0, page: 0, finished: 0 };
  tr.sketchesOf = tr.sketchesOf || [];
}

/** What the traveler is wearing before the first morning picks something else. */
export function defaultOutfit() {
  return { top: 'gray_tee', bottom: 'cargo', shoes: 'boots', socks: 'gray socks', underwear: 'boxers' };
}
