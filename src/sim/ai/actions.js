// Action library for the traveler's utility AI.
//
// Each action definition:
//   category   sleep | critical | repair | need | chore | leisure | micro
//   exertion   0 asleep · 0.5 seated · 1 standing · 1.3+ labour · 3 exercise
//   posture    hint for the renderer (lying, sitting, standing, kneeling, crouching)
//   gen(s, d, opts) -> [{score, locs:[{room, station}|{room, x}], params}]
//                      opts.routine: return a feasible candidate even if the
//                      score is low (habits run regardless of urgency)
//   start(s, d, a)     on arrival, before duration is computed
//   duration(s, d, a)  seconds, or -1 for open-ended (then `done` decides)
//   done(s, d, a)      open-ended completion test (checked at slow ticks)
//   rates              per-hour need/mood deltas while performing
//   complete(s, d, a)  discrete effects on completion
//   interrupt(s, d, a) cleanup if abandoned
//   minCommit          seconds of task inertia before ordinary switching
import { clamp, smooth, ramp, inWindow, hoursAfter, HOUR } from '../util.js';
import { range, int, rand } from '../rng.js';
import { shipHour, missionDay } from '../clock.js';
import { emit, emptyDigest } from '../events.js';
import { factor, applyRepair, applyMaintenance, perceive, FAB_COST } from '../ship/wear.js';
import { chooseCrop, TRAY_RESERVOIR_L } from '../ship/hydroponics.js';
import { assembleMeal, addHarvest, preservable, preserveSurplus } from '../ship/food.js';
import { workSlowdown } from '../traveler/physiology.js';
import { buildLogFacts } from './logfacts.js';
import { writeLog } from '../../memory/logwriter.js';
import { pickMemory, markRecalled } from '../../memory/recall.js';
import { FLIGHT_ACTIONS } from '../../space/actions.js';
import { viewSubject } from '../../space/view.js';
import { feelWonder } from '../../space/discovery.js';
import { mealDrink, fillMug, ensureMug } from '../traveler/mug.js';

const sinceH = (s, key) => (s.t - s.traveler.history[key]) / HOUR;
const at = (room, station) => ({ room, station });
const here = (s) => ({ room: s.traveler.pos.room, x: s.traveler.pos.x });
const one = (score, locs, params = {}, extra = {}) => [{ score, locs: Array.isArray(locs) ? locs : [locs], params, ...extra }];
const floor = (opts, sc, min = 0.4) => (opts && opts.routine ? Math.max(sc, min) : sc);

function boredom(s, id, halfLifeH = 6) {
  const last = s.traveler.history.recent[id];
  if (last === undefined) return 0;
  return Math.exp(-(s.t - last) / HOUR / halfLifeH);
}

function leisureScore(s, d, id, { solitudeW = 0, wonderW = 0, eveningW = 0.12 } = {}) {
  const tr = s.traveler;
  const n = tr.needs;
  const hr = shipHour(s);
  const w = d.traveler.hobbies[id] ?? 0.5;
  let sc = w * (0.16 + 0.22 * n.stress + solitudeW * n.solitude + wonderW * (1 - tr.mood.wonder) * 0.5 +
    (inWindow(hr, 19, 23) ? eveningW : 0) + 0.08 * tr.mood.weariness);
  sc *= 1 - 0.75 * boredom(s, id);
  if (n.fatigue > 0.85) sc *= 0.4;
  return Math.min(sc, 0.6);
}

function hobbyComplete(id) {
  return (s) => emit(s, 'hobby', { activity: id, room: s.traveler.pos.room });
}

const ROOM_HINTS = {
  bridge: ['tap_gauge', 'watch_stars'], lounge: ['lean_viewport', 'wipe_condensation'], quarters: ['look_keepsake', 'straighten_blanket'],
  galley: ['sip_tea', 'wipe_counter'], hydro: ['inspect_leaf', 'touch_leaf', 'wipe_glass'], lifesupport: ['check_leds', 'tap_gauge'],
  engineering: ['listen_reactor', 'tap_gauge'], workshop: ['sort_tools'], storage: ['check_labels'], airlock: ['look_suit'],
  corridor_fore: ['lean_railing', 'check_panel'], corridor_aft: ['lean_railing', 'check_panel'],
};

// rooms with a 'mid' station worth wandering through
const TINKER_OBJECTS = ['pocket watch', 'puzzle box', 'model ship', 'old radio', 'music box', 'brass compass'];
const STROLL_ROOMS = ['corridor_fore', 'corridor_aft', 'hydro', 'lifesupport', 'storage', 'workshop', 'engineering', 'gallery_s', 'gallery_p'];

/** Tomorrow's clothes: not the same top as today, warmer when the ship runs cold, shorts when it runs warm. */
function pickOutfit(s, w, prev) {
  if (!w) return prev;
  const heat = s.ship.thermal.heat;
  const pick = (list, ok) => { const c = list.filter(ok); const pool = c.length ? c : list; return pool[Math.floor(rand(s.rng) * pool.length)]; };
  const top = pick(w.tops, (t) => t.id !== prev.top && (heat < 0.35 ? true : !t.warm));
  const bottom = pick(w.bottoms, (b) => (b.shorts ? heat > 0.45 || rand(s.rng) < 0.2 : true));
  const shoes = pick(w.shoes, () => true);
  return { top: top.id, bottom: bottom.id, shoes: shoes.id, socks: w.socks[Math.floor(rand(s.rng) * w.socks.length)], underwear: w.underwear[Math.floor(rand(s.rng) * w.underwear.length)] };
}

const ALGAE_STORE_KCAL = 30000;
const FAB_TARGET = { parts: 12, filters: 4, cartridges: 3, seals: 10 };

function useWater(s, litres) {
  const w = s.ship.water;
  const got = Math.min(w.potable, litres);
  w.potable -= got;
  return got;
}

const CORE_ACTIONS = {
  // ───────────────────────── rest ─────────────────────────
  sleep: {
    category: 'sleep', exertion: 0, posture: 'lying', minCommit: 3 * HOUR,
    gen(s, d, opts) {
      const n = s.traveler.needs;
      const { sleepHour, wakeHour } = s.traveler.prefs;
      const hr = shipHour(s);
      const night = inWindow(hr, sleepHour - 0.5, wakeHour - 0.5);
      let sc = smooth(n.fatigue, 0.6, 0.97) * 0.9;
      const awakeH = sinceH(s, 'lastWakeT');
      if (night && awakeH > 3) {
        sc = Math.max(sc, (0.35 + 0.35 * smooth(n.fatigue, 0.25, 0.55) + 0.25 * clamp(hoursAfter(hr, sleepHour - 0.5) / 3)) * smooth(n.fatigue, 0.15, 0.4));
      }
      return one(floor(opts, sc), at('quarters', 'bunk'));
    },
    duration: () => -1,
    start(s, d, a) {
      // Each night's alarm-less wake time drifts a little around the habit.
      a.params.wakeAt = s.traveler.prefs.wakeHour + range(s.rng, -0.7, 0.5);
      emit(s, 'sleep_start', { room: s.traveler.pos.room, fatigue: round2(s.traveler.needs.fatigue) });
      s.traveler.history.lastSleepT = s.t;
    },
    done(s, d, a) {
      const n = s.traveler.needs;
      const hr = shipHour(s);
      const wakeAt = a.params.wakeAt ?? s.traveler.prefs.wakeHour;
      const e = a.elapsed / HOUR;
      if (e > 10.5) return true;
      if (e < 3) return false;
      if (n.fatigue < 0.15 && inWindow(hr, wakeAt, wakeAt + 4)) return true;
      if (n.fatigue < 0.3 && inWindow(hr, wakeAt + 1.5, wakeAt + 6)) return true;
      return false;
    },
    rates: null,
    tick(s, d, a, dt) {
      const n = s.traveler.needs;
      const q = clamp(1 - 0.4 * n.stress - 0.3 * ramp(s.ship.atmo.co2, 2000, 5000) - (n.hunger > 0.85 ? 0.2 : 0) - (s.ship.thermal.heat > 0.8 ? 0.15 : 0), 0.3, 1);
      a.params.qSum = (a.params.qSum || 0) + q * dt;
      a.params.qT = (a.params.qT || 0) + dt;
      n.fatigue = clamp(n.fatigue - (0.16 * q * dt) / HOUR);
      n.stress = clamp(n.stress - (0.03 * dt) / HOUR);
    },
    complete(s, d, a) { wakeUp(s, a); },
    interrupt(s, d, a) { wakeUp(s, a, true); },
  },

  nap: {
    category: 'sleep', exertion: 0, posture: 'lying', minCommit: 900,
    gen(s, d) {
      const n = s.traveler.needs;
      const hr = shipHour(s);
      if (!inWindow(hr, 12, 19.5) || n.fatigue < 0.55) return [];
      return one(smooth(n.fatigue, 0.55, 0.85) * 0.55, [at('lounge', 'couch'), at('quarters', 'bunk')]);
    },
    duration: (s) => range(s.rng, 1200, 2700),
    rates: { fatigue: -0.15, stress: -0.04 },
    complete(s) { emit(s, 'nap', { room: s.traveler.pos.room }); },
  },

  doze: { // involuntary — only started by collapse
    category: 'sleep', exertion: 0, posture: 'slumped', minCommit: 1800,
    gen: () => [],
    duration: () => -1,
    done(s, d, a) { return s.traveler.needs.fatigue < 0.35 || a.elapsed > 3 * HOUR; },
    rates: { fatigue: -0.15 },
    complete(s) { emit(s, 'wake', { hours: 0, quality: 0.3, dozed: true }); },
  },

  // ───────────────────────── food & water ─────────────────────────
  cook_meal: {
    category: 'need', exertion: 1, posture: 'standing', minCommit: 600,
    gen(s, d, opts) {
      const tr = s.traveler;
      if (s.ship.food.mealReady) return [];
      const n = tr.needs;
      const hr = shipHour(s);
      // Mealtime habit only pulls if this window's meal hasn't happened yet.
      const win = d.traveler.mealWindows.find(([a, b]) => inWindow(hr, a, b));
      const ateThisWindow = win && sinceH(s, 'lastMealT') < hoursAfter(hr, win[0]);
      let sc = smooth(n.hunger, 0.3, 0.8) * 0.75 + (win && !ateThisWindow && n.hunger > 0.25 ? 0.15 : 0);
      if (sinceH(s, 'lastMealT') < 3.5) sc *= 0.3;
      if (inWindow(hr, 21.5, 6)) sc *= 0.4; // too late (or too early) to cook — a snack will do
      if (n.fatigue > 0.9) sc *= 0.5;
      return one(floor(opts, sc, 0.35), at('galley', 'stove'), {}, { startsRoutine: 'meal' });
    },
    start(s, d, a) {
      const p = s.ship.power;
      const heaterSpeed = factor(s, d, 'galley_heater', 'speed');
      const powered = factor(s, d, 'junction_box_fore', 'galleyPower') > 0 && p.mode !== 'limp';
      a.params.hot = heaterSpeed > 0 && powered;
      a.params.speed = a.params.hot ? heaterSpeed : 1;
    },
    duration(s, d, a) {
      return a.params.hot ? (range(s.rng, 900, 1800) / a.params.speed) * workSlowdown(s) : range(s.rng, 420, 720);
    },
    complete(s, d, a) {
      const n = s.traveler.needs;
      const target = 640 + range(s.rng, 0, 200) + 150 * smooth(n.hunger, 0.7, 1);
      const meal = assembleMeal(s, d, target, { hot: a.params.hot });
      s.ship.food.mealReady = { ...meal, readyT: s.t };
      s.ship.clutter.galley = clamp(s.ship.clutter.galley + 0.08);
      emit(s, 'meal_prepared', { kcal: meal.kcal, hot: meal.hot, room: 'galley' });
    },
  },

  eat_meal: {
    category: 'need', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      if (!s.ship.food.mealReady) return [];
      return one(0.5 + 0.4 * s.traveler.needs.hunger, at('galley', 'table'));
    },
    duration: (s) => range(s.rng, 900, 1500),
    complete(s) {
      const tr = s.traveler;
      const meal = s.ship.food.mealReady;
      s.ship.food.mealReady = null;
      eatEffects(s, meal);
      mealDrink(s); // a hot drink with the meal, carried off afterwards
      s.ship.clutter.galley = clamp(s.ship.clutter.galley + 0.05);
      emit(s, 'meal', { kcal: meal.kcal, quality: round2(meal.quality), freshShare: round2(meal.freshShare), algaeShare: round2(meal.algaeShare), hot: meal.hot, crops: meal.crops, room: tr.pos.room });
    },
  },

  snack: {
    category: 'need', exertion: 0.6, posture: 'standing', minCommit: 120,
    gen(s, d) {
      const n = s.traveler.needs;
      if (s.ship.food.mealReady || n.hunger < 0.55) return [];
      const hr = shipHour(s);
      const reluctant = n.fatigue > 0.75 || inWindow(hr, 21.5, 6) || factor(s, d, 'galley_heater', 'speed') === 0;
      if (!reluctant) return [];
      return one(smooth(n.hunger, 0.55, 0.9) * 0.6, at('galley', 'pantry'));
    },
    duration: (s) => range(s.rng, 150, 300),
    complete(s, d) {
      const meal = assembleMeal(s, d, 350, { hot: false });
      eatEffects(s, meal, true);
      emit(s, 'meal', { kcal: meal.kcal, quality: round2(meal.quality), freshShare: round2(meal.freshShare), algaeShare: round2(meal.algaeShare), hot: false, snack: true, crops: meal.crops, room: s.traveler.pos.room });
    },
  },

  drink_water: {
    category: 'need', exertion: 0.6, posture: 'standing', minCommit: 30,
    gen(s, d, opts) {
      const sc = smooth(s.traveler.needs.thirst, 0.3, 0.85) * 0.8;
      return one(floor(opts, sc, 0.3), [at('galley', 'sink'), at('quarters', 'sink')]);
    },
    duration: (s) => range(s.rng, 40, 90),
    complete(s) {
      const got = useWater(s, 0.4);
      s.traveler.needs.thirst = clamp(s.traveler.needs.thirst - 0.45 * (got / 0.4));
      s.traveler.needs.bladder = clamp(s.traveler.needs.bladder + 0.1 * (got / 0.4));
      if (ensureMug(s).fill < 0.15) fillMug(s, 'water', 0.6, 18); // tops up the mug while he's at the tap
      s.ship.water.gray += got * 0.8;
      s.ship.atmo.airWater += got * 0.2;
      if (got < 0.4) s.traveler.needs.stress = clamp(s.traveler.needs.stress + 0.05);
    },
  },

  wash: {
    category: 'need', exertion: 0.8, posture: 'standing', minCommit: 300,
    gen(s, d, opts) {
      const n = s.traveler.needs;
      const hr = shipHour(s);
      let sc = smooth(n.hygiene, 0.35, 0.85) * 0.55 + ((inWindow(hr, 6, 10) || inWindow(hr, 20, 23.5)) && n.hygiene > 0.25 ? 0.1 : 0);
      if (s.ship.water.potable < 80) sc *= 0.5;
      return one(floor(opts, sc, 0.3), at('quarters', 'sink'));
    },
    duration: (s) => range(s.rng, 600, 1100),
    complete(s) {
      const want = s.ship.water.potable < 80 ? 2 : 5;
      const got = useWater(s, want);
      s.ship.water.gray += got * 0.9;
      s.ship.atmo.airWater += got * 0.1;
      const n = s.traveler.needs;
      n.hygiene = clamp(0.04 + 0.3 * (1 - got / want));
      n.stress = clamp(n.stress - 0.03);
      s.traveler.history.lastWashT = s.t;
      emit(s, 'wash', { litres: round2(got), room: 'quarters' });
    },
  },

  use_toilet: {
    category: 'need', exertion: 0.5, posture: 'sitting', minCommit: 60,
    gen(s, d, opts) {
      const b = s.traveler.needs.bladder;
      const sc = b > 0.97 ? 0.97 : smooth(b, 0.45, 0.95) * 0.9;
      return one(floor(opts, sc, b > 0.15 ? 0.3 : 0), at('quarters', 'toilet'));
    },
    duration: (s) => (rand(s.rng) < 0.22 ? range(s.rng, 300, 600) : range(s.rng, 80, 200)),
    complete(s) {
      const got = useWater(s, 0.5); // flush, then washing hands
      s.ship.water.gray += got;
      const n = s.traveler.needs;
      n.bladder = clamp(0.03);
      n.hygiene = clamp(n.hygiene + 0.01);
      s.traveler.history.lastToiletT = s.t;
      emit(s, 'toilet', { room: 'quarters' });
    },
  },

  change_clothes: {
    category: 'need', exertion: 0.8, posture: 'standing', minCommit: 120,
    gen(s, d, opts) {
      const h = s.traveler.history;
      if (h.lastDressDay === missionDay(s)) return [];
      const hr = shipHour(s);
      // dress once a day, soon after getting up (not in the first few minutes of being awake)
      const awakeH = (s.t - h.lastWakeT) / HOUR;
      if (awakeH < 0.15) return [];
      const sc = awakeH < 4 ? 0.55 : 0.4;
      return one(floor(opts, sc, 0.3), at('quarters', 'locker'));
    },
    duration: (s) => range(s.rng, 150, 320),
    complete(s, d) {
      const tr = s.traveler;
      tr.outfit = pickOutfit(s, d.traveler.wardrobe, tr.outfit);
      tr.history.lastDressDay = missionDay(s);
      tr.history.laundry = (tr.history.laundry || 0) + 1;
      if (tr.history.laundry >= 6) {
        // a load through the washer: water to gray, a little to the air
        const got = useWater(s, 3);
        s.ship.water.gray += got * 0.9;
        s.ship.atmo.airWater += got * 0.1;
        tr.history.laundry = 0;
      }
      emit(s, 'dressed', { outfit: { ...tr.outfit }, room: 'quarters' });
    },
  },

  // ───────────────────────── body ─────────────────────────
  exercise: {
    category: 'chore', exertion: 3, posture: 'exercising', minCommit: 1200,
    gen(s) {
      const tr = s.traveler;
      const hr = shipHour(s);
      if (!inWindow(hr, 8.5, 20.5)) return [];
      const days = sinceH(s, 'lastExerciseT') / 24;
      let sc = smooth(days, 0.6, 2) * 0.38 + (1 - tr.body.fitness) * 0.2;
      if (tr.needs.fatigue > 0.65) sc *= 0.2;
      if (tr.needs.hunger > 0.7) sc *= 0.5;
      return one(sc, at('lounge', 'exercise'));
    },
    duration: (s) => range(s.rng, 1800, 2700),
    rates: { stress: -0.12, weariness: -0.003 },
    complete(s) {
      const tr = s.traveler;
      tr.body.fitness = clamp(tr.body.fitness + 0.035);
      tr.needs.hygiene = clamp(tr.needs.hygiene + 0.2);
      tr.needs.thirst = clamp(tr.needs.thirst + 0.15);
      tr.history.lastExerciseT = s.t;
      emit(s, 'exercise', { room: 'lounge' });
    },
  },

  stretch: {
    category: 'micro', exertion: 1, posture: 'stretching', minCommit: 60,
    gen(s, d, opts) {
      const justWoke = sinceH(s, 'lastWakeT') < 0.3;
      return one(floor(opts, 0.05 + (justWoke ? 0.3 : 0), 0.3), here(s));
    },
    duration: (s) => range(s.rng, 150, 300),
    rates: { stress: -0.1 },
  },

  // ───────────────────────── hydroponics ─────────────────────────
  tend_trays: {
    category: 'chore', exertion: 1.2, posture: 'crouching', minCommit: 900,
    gen(s, d, opts) {
      const trays = s.ship.trays.filter((t) => t.crop && !t.dead);
      if (!trays.length) return [];
      const dry = trays.reduce((a, t) => a + Math.max(0, 0.6 - t.water), 0) / trays.length;
      const sick = trays.reduce((a, t) => a + Math.max(0, 0.8 - t.health), 0) / trays.length;
      const sc = Math.min(0.75, smooth(sinceH(s, 'lastTendT'), 16, 40) * 0.42 + dry * 0.8 + sick * 0.6);
      return one(floor(opts, sc, 0.3), at('hydro', 'mid'));
    },
    duration(s) {
      const live = s.ship.trays.filter((t) => t.crop && !t.dead).length;
      return (900 + 120 * live) * workSlowdown(s) * range(s.rng, 0.9, 1.15);
    },
    complete(s, d) {
      for (const t of s.ship.trays) {
        if (!t.crop || t.dead) continue;
        if (t.water < 0.95) t.water += useWater(s, (0.95 - t.water) * TRAY_RESERVOIR_L) / TRAY_RESERVOIR_L;
        t.health = clamp(t.health + 0.1 * (1 - t.health));
      }
      const tr = s.traveler;
      tr.history.lastTendT = s.t;
      tr.needs.solitude = clamp(tr.needs.solitude - 0.04);
      tr.needs.stress = clamp(tr.needs.stress - 0.04);
      tr.mood.wonder = clamp(tr.mood.wonder + 0.004);
      s.ship.clutter.hydro = clamp(s.ship.clutter.hydro + 0.03);
      perceive(s, d, 'hydro', true);
      emit(s, 'tend_trays', { room: 'hydro' });
    },
  },

  harvest_tray: {
    category: 'chore', exertion: 1.3, posture: 'crouching', minCommit: 600,
    gen(s) {
      const out = [];
      s.ship.trays.forEach((t, i) => {
        if (!t.crop) return;
        if (t.dead) out.push({ score: 0.35, locs: [at('hydro', `tray_${i}`)], params: { tray: i, clear: true } });
        else if (t.growth >= 0.9) out.push({ score: 0.32 + smooth(t.growth, 0.9, 1.15) * 0.35, locs: [at('hydro', `tray_${i}`)], params: { tray: i } });
      });
      return out;
    },
    duration: (s, d, a) => (a.params.clear ? range(s.rng, 500, 800) : range(s.rng, 900, 1500)) * workSlowdown(s),
    complete(s, d, a) {
      const t = s.ship.trays[a.params.tray];
      if (!t.crop) return;
      if (a.params.clear || t.dead) {
        s.ship.food.compost += 2;
        emit(s, 'tray_cleared', { tray: a.params.tray, crop: t.crop, room: 'hydro' });
      } else {
        const crop = d.crops[t.crop];
        const kg = crop.yieldKg * (0.4 + 0.6 * t.health) * (t.growth > 1.1 ? 0.8 : 1) * range(s.rng, 0.9, 1.1);
        addHarvest(s, d, t.crop, kg);
        const seeds = int(s.rng, crop.seedsPerHarvest[0], crop.seedsPerHarvest[1]);
        s.ship.seeds[t.crop] += seeds;
        const tr = s.traveler;
        tr.mood.wonder = clamp(tr.mood.wonder + 0.02);
        tr.needs.stress = clamp(tr.needs.stress - 0.04);
        emit(s, 'harvest', { tray: a.params.tray, crop: t.crop, kg: round2(kg), seeds, room: 'hydro' });
      }
      Object.assign(t, { crop: null, growth: 0, health: 0, water: t.water, dead: false });
      s.ship.clutter.hydro = clamp(s.ship.clutter.hydro + 0.06);
    },
  },

  plant_tray: {
    category: 'chore', exertion: 1.1, posture: 'crouching', minCommit: 300,
    gen(s, d) {
      const empty = [];
      s.ship.trays.forEach((t, i) => { if (!t.crop) empty.push(i); });
      if (!empty.length || !chooseCrop(s, d)) return [];
      return empty.map((i) => ({ score: 0.3 + 0.06 * empty.length, locs: [at('hydro', `tray_${i}`)], params: { tray: i } }));
    },
    duration: (s) => range(s.rng, 600, 900) * workSlowdown(s),
    complete(s, d, a) {
      const t = s.ship.trays[a.params.tray];
      if (t.crop) return;
      const crop = chooseCrop(s, d);
      if (!crop) return;
      let vault = false;
      if (s.ship.seeds[crop] > 0) s.ship.seeds[crop]--;
      else { s.ship.seedVault[crop]--; vault = true; }
      let health = 0.85;
      if (s.ship.food.compost >= 1) { s.ship.food.compost -= 1; health = 0.92; }
      Object.assign(t, { crop, growth: 0, health, water: 1, dead: false, plantedDay: missionDay(s) });
      emit(s, 'plant', { tray: a.params.tray, crop, fromVault: vault, room: 'hydro' });
    },
  },

  tend_algae: {
    category: 'chore', exertion: 1, posture: 'standing', minCommit: 300,
    gen(s, d, opts) {
      const alg = s.ship.algae;
      const sc = smooth(sinceH(s, 'lastAlgaeT'), 18, 48) * 0.38 + 0.15 * ramp(alg.buffer, 4000, 9000) + (s.ship.food.algae < 1500 ? 0.1 : 0);
      return one(floor(opts, sc, 0.3), at('hydro', 'algae'));
    },
    duration: (s) => range(s.rng, 600, 900) * workSlowdown(s),
    complete(s) {
      const alg = s.ship.algae;
      // paste is bagged into cold storage; the rest stays in the vat
      const kcal = Math.max(0, Math.min(alg.buffer, ALGAE_STORE_KCAL - s.ship.food.algae));
      s.ship.food.algae += kcal;
      alg.buffer -= kcal;
      alg.health = clamp(alg.health + 0.15 * (1 - alg.health));
      s.traveler.history.lastAlgaeT = s.t;
      emit(s, 'tend_algae', { kcal: Math.round(kcal), density: round2(alg.density), room: 'hydro' });
    },
  },

  // ───────────────────────── ship upkeep ─────────────────────────
  repair: {
    category: 'repair', exertion: 1.4, posture: 'kneeling', minCommit: 1200,
    gen(s, d) {
      const out = [];
      const sh = s.ship;
      const n = s.traveler.needs;
      for (const id of d.componentIds) {
        const c = sh.components[id];
        if (!c.fault || !c.known) continue;
        const def = d.components[id];
        if (def.exterior && sh.flight.mode !== 'landed') continue;
        const crit = def.criticality;
        let sc = c.fault.severity === 'major' ? 0.6 + 0.35 * crit : 0.38 + 0.25 * crit;
        if (id === 'thermal_vents' || id === 'reactor_core') sc += 0.3 * ramp(sh.thermal.heat, 0.7, 1);
        if (id === 'o2_scrubber') sc += 0.3 * ramp(sh.atmo.co2, 1500, 4000);
        if (id === 'ogs') sc += 0.3 * ramp(19.8 - sh.atmo.o2, 0, 1.5);
        if (id === 'water_recycler') sc += 0.25 * ramp(100 - sh.water.potable, 0, 80);
        if (id.startsWith('hydro_pump') || id.startsWith('grow_lamps')) sc += 0.1 * (c.fault.severity === 'major' ? 1 : 0);
        if (c.fault.severity === 'minor' && n.fatigue > 0.85) sc *= 0.5;
        sc = Math.min(sc, 0.98);
        out.push({ score: sc, locs: [at(def.room, def.station)], params: { component: id }, category: sc > 0.8 ? 'critical' : 'repair' });
      }
      return out;
    },
    duration(s, d, a) {
      const c = s.ship.components[a.params.component];
      const sev = c.fault ? c.fault.severity : 'minor';
      return d.components[a.params.component].repair[sev].seconds * range(s.rng, 0.85, 1.25) * workSlowdown(s);
    },
    complete(s, d, a) {
      const id = a.params.component;
      const r = applyRepair(s, d, id);
      const tr = s.traveler;
      const room = d.components[id].room;
      s.ship.clutter[room] = clamp(s.ship.clutter[room] + 0.08);
      tr.needs.hygiene = clamp(tr.needs.hygiene + 0.08);
      if (r && !r.ok) tr.needs.stress = clamp(tr.needs.stress + 0.06);
      else tr.needs.stress = clamp(tr.needs.stress - 0.05);
    },
  },

  maintain: {
    category: 'chore', exertion: 1.3, posture: 'kneeling', minCommit: 900,
    gen(s, d) {
      const out = [];
      const n = s.traveler.needs;
      const thr = 0.5 - 0.15 * d.traveler.traits.discipline;
      for (const id of d.componentIds) {
        const def = d.components[id];
        if (def.exterior && s.ship.flight.mode !== 'landed') continue; // hull work needs solid ground
        const c = s.ship.components[id];
        if (c.fault || c.knownWear < thr) continue;
        let sc = smooth(c.knownWear, thr, 0.85) * (0.3 + 0.25 * def.criticality);
        const item = def.maintain.item;
        if (item && s.ship.inventory[item] < def.maintain.qty) sc *= 0.5;
        if (n.fatigue > 0.75) sc *= 0.5;
        out.push({ score: sc, locs: [at(def.room, def.station)], params: { component: id } });
      }
      return out;
    },
    duration: (s, d, a) => d.components[a.params.component].maintain.seconds * range(s.rng, 0.85, 1.2) * workSlowdown(s),
    complete(s, d, a) {
      const id = a.params.component;
      if (s.ship.components[id].fault) return; // it failed while we worked: the repair action takes over
      applyMaintenance(s, d, id);
      const room = d.components[id].room;
      s.ship.clutter[room] = clamp(s.ship.clutter[room] + 0.05);
      s.traveler.needs.hygiene = clamp(s.traveler.needs.hygiene + 0.05);
    },
  },

  vent_heat: {
    category: 'critical', exertion: 1.2, posture: 'standing', minCommit: 300,
    gen(s) {
      const h = s.ship.thermal.heat;
      if (h < 0.75) return [];
      if (s.ship.flight.mode === 'scooping') return []; // at the helm, the answer is to pull away
      if (s.traveler.history.recent.vent_heat !== undefined && s.t - s.traveler.history.recent.vent_heat < 1800) return []; // coolant reservoir refilling
      return one(smooth(h, 0.7, 0.95) * 0.95, at('engineering', 'vents'), {}, { category: 'critical' });
    },
    duration: (s) => range(s.rng, 400, 700),
    complete(s) {
      const th = s.ship.thermal;
      th.heat = Math.max(0.3, th.heat - 0.25);
      useWater(s, 3);
      emit(s, 'vent_purge', { heat: round2(th.heat), room: 'engineering' });
    },
  },

  fabricate: {
    category: 'chore', exertion: 1, posture: 'standing', minCommit: 1200,
    gen(s, d) {
      const inv = s.ship.inventory;
      if (inv.feedstock < 1 || s.ship.power.mode !== 'normal' || factor(s, d, 'fabricator', 'speed') === 0) return [];
      let deficit = 0;
      for (const k in FAB_TARGET) deficit += Math.max(0, FAB_TARGET[k] - inv[k]) / FAB_TARGET[k];
      deficit /= 4;
      if (deficit <= 0.05) return [];
      let sc = 0.2 + 0.45 * deficit;
      if (s.traveler.needs.fatigue > 0.8) sc *= 0.4;
      return one(sc, at('workshop', 'fabricator'));
    },
    duration: (s, d) => range(s.rng, 2400, 4200) / Math.max(0.3, factor(s, d, 'fabricator', 'speed')),
    complete(s) {
      const inv = s.ship.inventory;
      let budget = 6;
      const made = {};
      for (;;) {
        let best = null;
        let bestGap = 0;
        for (const k in FAB_TARGET) {
          const gap = (FAB_TARGET[k] - inv[k]) / FAB_TARGET[k];
          if (gap > bestGap && inv.feedstock >= FAB_COST[k] && budget >= FAB_COST[k]) { bestGap = gap; best = k; }
        }
        if (!best) break;
        inv[best]++;
        inv.feedstock -= FAB_COST[best];
        budget -= FAB_COST[best];
        made[best] = (made[best] || 0) + 1;
      }
      s.ship.clutter.workshop = clamp(s.ship.clutter.workshop + 0.1);
      emit(s, 'fabricate', { made, feedstock: round2(inv.feedstock), room: 'workshop' });
    },
  },

  inspect_engineering: {
    category: 'chore', exertion: 1, posture: 'standing', minCommit: 600,
    gen(s, d, opts) {
      const sc = smooth(sinceH(s, 'lastInspectEngT'), 30, 70) * 0.32 * (0.6 + 0.4 * d.traveler.traits.discipline);
      return one(floor(opts, sc, 0.3), at('engineering', 'console'));
    },
    duration: (s) => range(s.rng, 900, 1500),
    complete(s, d) { inspect(s, d, 'engineering', 'lastInspectEngT'); },
  },

  inspect_lifesupport: {
    category: 'chore', exertion: 1, posture: 'standing', minCommit: 600,
    gen(s, d, opts) {
      const sc = smooth(sinceH(s, 'lastInspectLsT'), 30, 70) * 0.32 * (0.6 + 0.4 * d.traveler.traits.discipline);
      return one(floor(opts, sc, 0.3), at('lifesupport', 'mid'));
    },
    duration: (s) => range(s.rng, 700, 1200),
    complete(s, d) { inspect(s, d, 'lifesupport', 'lastInspectLsT'); },
  },

  organize_storage: {
    category: 'chore', exertion: 1.2, posture: 'standing', minCommit: 900,
    gen(s) {
      const inv = s.ship.inventory;
      const sc = smooth(sinceH(s, 'lastStorageT'), 72, 200) * 0.25 + (inv.feedstock < 6 && s.ship.salvage.remainingKg > 0 ? 0.3 : 0) + 0.2 * ramp(s.ship.clutter.storage, 0.3, 0.7);
      return one(sc, at('storage', 'shelves'));
    },
    duration: (s) => range(s.rng, 1200, 2400) * workSlowdown(s),
    complete(s) {
      const sh = s.ship;
      sh.clutter.storage = Math.min(sh.clutter.storage, 0.05);
      s.traveler.history.lastStorageT = s.t;
      if (sh.salvage.remainingKg > 0) {
        const kg = Math.min(sh.salvage.remainingKg, range(s.rng, 0.3, 1.5) + (sh.inventory.feedstock < 6 ? range(s.rng, 1, 3) : 0));
        sh.salvage.remainingKg -= kg;
        sh.inventory.feedstock += kg;
        emit(s, 'salvage', { kg: round2(kg), room: 'storage' });
      }
    },
  },

  clean_room: {
    category: 'chore', exertion: 1.1, posture: 'standing', minCommit: 300,
    gen(s, d) {
      const n = s.traveler.needs;
      const thr = 0.32 + (1 - d.traveler.traits.tidiness) * 0.3 + 0.2 * Math.max(0, n.fatigue - 0.5);
      const out = [];
      for (const r of d.roomIds) {
        const c = s.ship.clutter[r];
        if (c < thr) continue;
        const st = d.rooms[r].stations;
        out.push({ score: smooth(c, thr, thr + 0.3) * 0.42, locs: [st.mid !== undefined ? at(r, 'mid') : { room: r, x: d.rooms[r].width / 2 }], params: { room: r } });
      }
      return out;
    },
    duration: (s, d, a) => (600 + 1500 * s.ship.clutter[a.params.room]) * workSlowdown(s),
    complete(s, d, a) {
      s.ship.clutter[a.params.room] *= 0.15;
      s.traveler.needs.stress = clamp(s.traveler.needs.stress - 0.03);
      s.traveler.needs.hygiene = clamp(s.traveler.needs.hygiene + 0.05);
      emit(s, 'clean', { room: a.params.room });
    },
  },

  wash_dishes: {
    category: 'chore', exertion: 0.9, posture: 'standing', minCommit: 120,
    gen(s, d, opts) {
      const c = s.ship.clutter.galley;
      if (c < (opts && opts.routine ? 0.05 : 0.12)) return [];
      const sc = sinceH(s, 'lastMealT') < 1 ? 0.25 * d.traveler.traits.tidiness + 0.2 * c : 0.1 * c;
      return one(floor(opts, sc, 0.3), at('galley', 'sink'));
    },
    duration: (s) => range(s.rng, 300, 600),
    complete(s) {
      s.ship.clutter.galley = Math.max(0, s.ship.clutter.galley - 0.15);
      const got = useWater(s, 3);
      s.ship.water.gray += got;
    },
  },

  preserve_food: {
    category: 'chore', exertion: 1, posture: 'standing', minCommit: 900,
    gen(s) {
      const kcal = preservable(s);
      if (kcal < 500) return [];
      return one(0.3 + 0.2 * ramp(kcal, 500, 4000), at('galley', 'counter'));
    },
    duration: (s) => range(s.rng, 1500, 2400) * workSlowdown(s),
    complete(s) {
      const r = preserveSurplus(s);
      s.ship.clutter.galley = clamp(s.ship.clutter.galley + 0.06);
      if (r.kcal > 0) emit(s, 'preserve', { ...r, room: 'galley' });
    },
  },

  // ───────────────────────── bridge ─────────────────────────
  check_scans: {
    category: 'chore', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s, d, opts) {
      const sc = smooth(sinceH(s, 'lastScanT'), 4, 12) * 0.32 * (0.6 + 0.5 * d.traveler.traits.curiosity);
      return one(floor(opts, sc, 0.3), at('bridge', 'scanner'));
    },
    duration: (s) => range(s.rng, 600, 1500),
    complete(s, d) {
      const q = factor(s, d, 'bridge_sensors', 'sensorQuality');
      s.traveler.history.lastScanT = s.t;
      s.traveler.mood.wonder = clamp(s.traveler.mood.wonder + 0.01 * q * rand(s.rng));
      perceive(s, d, 'bridge', true);
      // Phase 2 hooks: long-range contacts, anomalies, system survey results.
      emit(s, 'scan_check', { sensorQuality: q, room: 'bridge' });
    },
  },

  nav_review: {
    category: 'chore', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s) { return one(smooth(sinceH(s, 'lastNavT'), 20, 48) * 0.25, at('bridge', 'nav')); },
    duration: (s) => range(s.rng, 900, 1800),
    complete(s) {
      s.traveler.history.lastNavT = s.t;
      emit(s, 'nav_review', { fuel: round2(s.ship.fuel.tons), room: 'bridge' });
    },
  },

  // ───────────────────────── personal life ─────────────────────────
  write_log: {
    category: 'leisure', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s, d, opts) {
      const day = missionDay(s);
      const h = s.traveler.history;
      if (h.lastLogDay === day) return [];
      const hr = shipHour(s);
      let sc = inWindow(hr, 19, 23.6) ? 0.5 : day - h.lastLogDay > 1 && hr > 12 ? 0.35 : 0.04;
      return one(floor(opts, sc), [at('quarters', 'desk'), at('bridge', 'terminal')]);
    },
    start(s, d, a) {
      // the entry is composed as they sit down, so the terminal (and captions) can show it being typed
      const entry = s.traveler.history.logsWritten + 1;
      const facts = buildLogFacts(s, d);
      const log = writeLog({ state: s, data: d, facts, entry });
      a.params.entry = entry;
      a.params.header = log.header;
      a.params.text = log.text;
      a.params.sentences = log.sentences;
      a.params.callbackId = log.callback ? log.callback.id : null;
      a.params.facts = facts;
    },
    duration: (s, d, a) => Math.max(600, Math.min(1800, 300 + (a.params.text || '').length * 3.2)) * range(s.rng, 0.9, 1.1),
    complete(s, d, a) {
      const tr = s.traveler;
      tr.history.lastLogDay = missionDay(s);
      tr.history.logsWritten = a.params.entry || tr.history.logsWritten + 1;
      const rec = a.params.callbackId ? s.memory.records.find((r) => r.id === a.params.callbackId) : null;
      if (rec) {
        markRecalled(s, rec);
        emit(s, 'memory_recalled', { memoryId: rec.id, callback_count: rec.callback_count, via: 'log' });
      }
      const logs = s.memory.logs;
      logs.push({ entry: tr.history.logsWritten, day: missionDay(s), header: a.params.header, text: a.params.text });
      if (logs.length > 20) logs.shift(); // every entry is kept in IndexedDB; the snapshot holds the latest
      emit(s, 'log_entry', { entry: tr.history.logsWritten, header: a.params.header, text: a.params.text, callback: rec ? rec.subject : null, facts: a.params.facts, room: tr.pos.room });
      s.journal.sinceLastLog = freshDigest(s);
      tr.needs.solitude = clamp(tr.needs.solitude - 0.08);
      tr.mood.weariness = clamp(tr.mood.weariness - 0.01);
    },
  },

  // a living sample from the surface, under the glovebox and the microscope
  study_sample: {
    category: 'chore', exertion: 0.6, posture: 'standing', minCommit: 900,
    gen(s, d) {
      const bio = s.space && s.space.cargo.bio;
      if (!bio || s.traveler.needs.fatigue > 0.75) return [];
      const since = (s.t - (s.traveler.history.lastStudyT ?? -Infinity)) / HOUR;
      if (since < 20) return [];
      return one(0.36 + 0.22 * d.traveler.traits.curiosity, at('biolab', 'glovebox'));
    },
    duration: (s) => range(s.rng, 1800, 4200),
    rates: { stress: -0.04 },
    complete(s, d) {
      s.traveler.history.lastStudyT = s.t;
      const m = s.traveler.mood;
      m.wonder = clamp(m.wonder + 0.04 * (1 - m.wonder));
      emit(s, 'study_sample', { samples: s.space.cargo.bio, room: 'biolab' });
    },
  },

  gaze_viewport: {
    category: 'leisure', exertion: 0.4, posture: 'standing', minCommit: 600,
    gen(s, d) {
      // What is outside matters: a ringed giant filling the glass pulls harder than the starfield.
      const v = viewSubject(s, d);
      let sc = leisureScore(s, d, 'gaze_viewport', { wonderW: 0.3 }) + 0.35 * v.interest * (1 - 0.6 * boredom(s, 'gaze_viewport', 3));
      const it = s.space.agenda[0];
      if (it && it.kind === 'visit' && it.done.lingerUntil && s.t < it.done.lingerUntil) sc += 0.25;
      const fl = s.ship.flight;
      if (fl.mode === 'landed' && fl.touchdownT !== undefined && s.t - fl.touchdownT < 2 * HOUR) sc += 0.2; // landed somewhere new: look at it
      if (v.interest > 0.6 && !s.space.awed[`${v.kind}:${v.id}`]) sc += 0.2;
      if (s.traveler.needs.fatigue > 0.85) sc *= 0.4;
      return one(Math.min(0.85, sc), [at('lounge', 'viewport'), at('bridge', 'viewport'), at('gallery_s', 'viewport'), at('gallery_p', 'viewport')], { subject: v.kind, id: v.id ?? null, name: v.name ?? null, interest: Math.round(v.interest * 100) / 100 });
    },
    // a long look, not an hour frozen at the glass: the interest stretches it, but only so far
    duration: (s, d, a) => range(s.rng, 300, 1100) * (1 + 0.5 * a.params.interest),
    rates: { stress: -0.08, solitude: -0.02 },
    complete(s, d, a) {
      const m = s.traveler.mood;
      m.wonder = clamp(m.wonder + (0.01 + 0.02 * a.params.interest) * (1 - m.wonder));
      const key = `${a.params.subject}:${a.params.id}`;
      if (a.params.interest > 0.6 && !s.space.awed[key]) {
        s.space.awed[key] = true;
        feelWonder(s, 0.05);
        s.traveler.history.daysSinceNovelty = Math.max(0, s.traveler.history.daysSinceNovelty - 0.25);
        emit(s, 'awe', { subject: a.params.subject, id: a.params.id, name: a.params.name, room: s.traveler.pos.room });
      }
      hobbyComplete('gaze_viewport')(s);
    },
  },

  read: {
    category: 'leisure', exertion: 0.3, posture: 'reclining', minCommit: 900,
    gen(s, d) { return one(leisureScore(s, d, 'read'), [at('quarters', 'bunk'), at('lounge', 'couch')]); },
    duration: (s) => range(s.rng, 1800, 3600),
    rates: { stress: -0.1, weariness: -0.002 },
    complete(s, d, a) {
      const lib = s.traveler.library;
      const books = d.traveler.library;
      lib.page += Math.round((a.elapsed / 3600) * (30 + 15 * (1 - s.traveler.needs.fatigue)));
      const book = books[lib.book % books.length];
      if (lib.page >= book.pages) {
        lib.page = 0;
        lib.book++;
        lib.finished++;
        emit(s, 'book_finished', { title: book.title, room: s.traveler.pos.room });
      }
      hobbyComplete('read')(s);
    },
  },

  listen_music: {
    category: 'leisure', exertion: 0.3, posture: 'reclining', minCommit: 900,
    gen(s, d) { return one(leisureScore(s, d, 'listen_music', { solitudeW: 0.35 }), [at('lounge', 'speaker'), at('quarters', 'desk')]); },
    start(s) { emit(s, 'music_start', { track: int(s.rng, 0, 39), room: s.traveler.pos.room }); },
    duration: (s) => range(s.rng, 1500, 3000),
    rates: { stress: -0.1, solitude: -0.12 },
    complete(s) { emit(s, 'music_stop', { room: s.traveler.pos.room }); hobbyComplete('listen_music')(s); },
    interrupt(s) { emit(s, 'music_stop', { room: s.traveler.pos.room }); },
  },

  sketch: {
    category: 'leisure', exertion: 0.5, posture: 'sitting', minCommit: 900,
    gen(s, d) { return one(leisureScore(s, d, 'sketch', { wonderW: 0.2 }), at('lounge', 'easel')); },
    duration: (s) => range(s.rng, 1800, 3600),
    rates: { stress: -0.09 },
    complete(s) {
      const tr = s.traveler;
      tr.history.sketches++;
      tr.skills.sketch = clamp(tr.skills.sketch + 0.012 * (1 - tr.skills.sketch));
      // draws from memory: the most recent sight not yet sketched, else the view
      const drawn = new Set(tr.sketchesOf.map((x) => x.memoryId));
      const subject = [...s.memory.records].reverse().find((r) => !drawn.has(r.id) && (r.tags.includes('awe') || r.tags.includes('body') || r.tags.includes('eva') || r.tags.includes('star')));
      if (subject) {
        tr.sketchesOf.push({ memoryId: subject.id, subject: subject.subject, day: missionDay(s), quality: Math.round(tr.skills.sketch * 100) / 100 });
        if (tr.sketchesOf.length > 12) tr.sketchesOf.shift();
        s.journal.sinceLastLog.sketch = subject.subject;
      }
      tr.mood.wonder = clamp(tr.mood.wonder + 0.01);
      s.ship.clutter.lounge = clamp(s.ship.clutter.lounge + 0.04);
      hobbyComplete('sketch')(s);
    },
  },

  play_solitaire: {
    category: 'leisure', exertion: 0.4, posture: 'sitting', minCommit: 600,
    gen(s, d) { return one(leisureScore(s, d, 'play_solitaire'), at('galley', 'table')); },
    duration: (s) => range(s.rng, 1200, 2400),
    rates: { stress: -0.08 },
    complete(s) {
      const sk = s.traveler.skills;
      sk.chess = clamp(sk.chess + 0.006 * (1 - sk.chess));
      hobbyComplete('play_solitaire')(s);
    },
  },

  play_instrument: {
    category: 'leisure', exertion: 0.6, posture: 'sitting', minCommit: 600,
    gen(s, d) { return one(leisureScore(s, d, 'play_instrument', { solitudeW: 0.25 }), at('quarters', 'desk')); },
    duration: (s) => range(s.rng, 1200, 2400),
    rates: { stress: -0.08, solitude: -0.08 },
    complete(s, d, a) {
      const sk = s.traveler.skills;
      // practice pays, slowly
      sk.instrument = clamp(sk.instrument + 0.01 * (a.elapsed / 1800) * (1 - sk.instrument));
      hobbyComplete('play_instrument')(s);
    },
  },

  stroll: {
    category: 'leisure', exertion: 1, posture: 'standing', minCommit: 40,
    gen(s, d) {
      // thinking on the move: walk somewhere else in the ship, look around, carry on
      const here_ = s.traveler.pos.room;
      const rooms = STROLL_ROOMS.filter((r) => r !== here_);
      // scored many times per decision, so pick without touching the RNG stream
      const slot = Math.floor(s.t / 300);
      const room = rooms[slot % rooms.length];
      const sc = leisureScore(s, d, 'stroll', { solitudeW: 0.25 }) * (1 - 0.5 * boredom(s, 'stroll', 1.5)) + 0.08 * s.traveler.needs.stress + 0.14;
      const hints = ROOM_HINTS[room] || ['pause'];
      return one(Math.min(0.5, sc), at(room, 'mid'), { hint: hints[Math.floor(slot / rooms.length) % hints.length] });
    },
    duration: (s) => range(s.rng, 45, 150),
    rates: { stress: -0.04, solitude: -0.01 },
    start(s, d, a) { emit(s, 'micro', { hint: a.params.hint, room: s.traveler.pos.room }); },
    complete(s) {
      if (rand(s.rng) < 0.3) {
        const rec = pickMemory(s, rand(s.rng), { minAgeDays: 1 });
        if (rec) { markRecalled(s, rec); emit(s, 'memory_recalled', { memoryId: rec.id, callback_count: rec.callback_count, via: 'stroll' }); }
      }
      hobbyComplete('stroll')(s);
    },
  },

  tinker: {
    category: 'leisure', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      return one(leisureScore(s, d, 'tinker'), [at('quarters', 'desk'), at('workshop', 'bench')]);
    },
    start(s, d, a) { a.params.object = TINKER_OBJECTS[Math.floor(rand(s.rng) * TINKER_OBJECTS.length)]; },
    duration: (s) => range(s.rng, 900, 2400),
    rates: { stress: -0.06 },
    complete(s, d, a) {
      emit(s, 'tinker', { object: a.params.object, room: s.traveler.pos.room });
      hobbyComplete('tinker')(s);
    },
  },

  reflect: {
    category: 'leisure', exertion: 0.3, posture: 'sitting', minCommit: 300,
    gen(s, d) { return one(leisureScore(s, d, 'reflect', { solitudeW: 0.45, eveningW: 0.15 }), at('quarters', 'shelf')); },
    duration: (s) => range(s.rng, 600, 1200),
    rates: { solitude: -0.2, stress: -0.05 },
    complete(s) {
      // turning over a memory: good ones lift the long-haul tiredness a little
      const rec = pickMemory(s, rand(s.rng), { minAgeDays: 1 });
      if (rec) {
        markRecalled(s, rec);
        const tr = s.traveler;
        if (rec.valence > 0) tr.mood.weariness = clamp(tr.mood.weariness - 0.03 * rec.emotional_weight);
        else tr.needs.stress = clamp(tr.needs.stress + 0.02 * rec.emotional_weight);
        tr.needs.solitude = clamp(tr.needs.solitude - 0.05 * rec.emotional_weight);
        emit(s, 'memory_recalled', { memoryId: rec.id, callback_count: rec.callback_count, via: 'reflection' });
        emit(s, 'reflection', { memoryId: rec.id, subject: rec.subject, room: tr.pos.room });
      }
      hobbyComplete('reflect')(s);
    },
  },

  linger: {
    category: 'micro', exertion: 0.6, posture: 'standing', minCommit: 30,
    gen(s) {
      const hints = ROOM_HINTS[s.traveler.pos.room] || ['pause'];
      return one(0.09, here(s), { hint: hints[Math.floor(rand(s.rng) * hints.length)] });
    },
    duration: (s) => range(s.rng, 60, 240),
    start(s, d, a) { emit(s, 'micro', { hint: a.params.hint, room: s.traveler.pos.room }); },
  },
};

// ───────────────────────── helpers ─────────────────────────
function round2(x) { return Math.round(x * 100) / 100; }

function wakeUp(s, a, interrupted = false) {
  const tr = s.traveler;
  const hours = a.elapsed / HOUR;
  const quality = a.params.qT ? a.params.qSum / a.params.qT : 0.8;
  tr.history.lastWakeT = s.t;
  emit(s, 'wake', { hours: round2(hours), quality: round2(quality), interrupted, room: tr.pos.room });
  if (!interrupted) tr.routine = { id: 'morning', i: 0, startT: s.t };
}

function eatEffects(s, meal, snack = false) {
  const tr = s.traveler;
  const n = tr.needs;
  n.hunger = clamp(n.hunger - meal.kcal / 1000);
  n.thirst = clamp(n.thirst - (snack ? 0.02 : 0.08));
  n.bladder = clamp(n.bladder + (snack ? 0.01 : 0.05));
  n.stress = clamp(n.stress - 0.06 * meal.quality + (meal.algaeShare > 0.4 ? 0.03 : 0));
  tr.mood.weariness = clamp(tr.mood.weariness - 0.01 * (meal.quality - 0.5));
  tr.history.lastMealT = s.t;
  tr.history.mealsToday++;
  s.ship.salvage.remainingKg += 0.004 * (meal.kcal / 100); // packaging back into the scrap stream
}

function inspect(s, d, room, key) {
  s.traveler.history[key] = s.t;
  perceive(s, d, room, true);
  s.traveler.needs.stress = clamp(s.traveler.needs.stress - 0.02);
  const worn = d.componentIds.filter((id) => d.components[id].room === room && !d.components[id].phase2 && s.ship.components[id].wear > 0.5);
  emit(s, 'inspection', { room, worn });
}

function freshDigest(s) {
  return { ...emptyDigest(), sinceT: s.t };
}

export const ACTIONS = { ...CORE_ACTIONS, ...FLIGHT_ACTIONS };
