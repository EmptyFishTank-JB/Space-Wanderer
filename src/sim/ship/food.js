// Galley stores: shelf-stable pantry, fresh produce lots (spoil), algae paste,
// and a sealed emergency ration crate.
import { clamp, smooth, DAY } from '../util.js';
import { range } from '../rng.js';
import { emit } from '../events.js';

export const KCAL_PER_DAY = 2400;

export const pantryDays = (state) => state.ship.food.pantry / KCAL_PER_DAY;

export function freshKcal(state) {
  return state.ship.food.fresh.reduce((s, l) => s + l.kcal, 0);
}

/** Hazard tick: spoilage of fresh lots. */
export function updateFood(state) {
  const f = state.ship.food;
  for (let i = f.fresh.length - 1; i >= 0; i--) {
    const lot = f.fresh[i];
    if (state.t >= lot.spoilT) {
      f.fresh.splice(i, 1);
      f.compost += lot.kg;
      emit(state, 'spoiled', { crop: lot.crop, kg: Math.round(lot.kg * 10) / 10, room: 'galley' });
    }
  }
}

export function addHarvest(state, data, cropId, kg) {
  const crop = data.crops[cropId];
  state.ship.food.fresh.push({ crop: cropId, kg, kcal: kg * crop.kcalPerKg, spoilT: state.t + crop.spoilDays * DAY });
}

/**
 * Pull ingredients for one meal. Fresh produce nearest to spoiling first, then
 * pantry staples. As the pantry runs down the traveler leans on algae paste —
 * nourishing, but nobody's favourite.
 */
export function assembleMeal(state, data, target, { hot = true } = {}) {
  const f = state.ship.food;
  let need = target;
  let fresh = 0;
  let morale = 0;
  const lots = f.fresh.slice().sort((a, b) => a.spoilT - b.spoilT);
  let freshBudget = target * 0.55;
  const crops = [];
  for (const lot of lots) {
    if (freshBudget <= 1) break;
    const take = Math.min(lot.kcal, freshBudget);
    const frac = take / lot.kcal;
    lot.kcal -= take;
    lot.kg -= lot.kg * frac;
    freshBudget -= take;
    fresh += take;
    morale = Math.max(morale, data.crops[lot.crop].morale);
    crops.push(lot.crop);
  }
  f.fresh = f.fresh.filter((l) => l.kcal > 1);
  need -= fresh;

  const days = pantryDays(state);
  const algaeShare = 0.08 + 0.5 * smooth(60 - days, 0, 50);
  let algae = Math.min(f.algae, need * algaeShare);
  f.algae -= algae;
  need -= algae;

  let pantry = Math.min(f.pantry, need);
  f.pantry -= pantry;
  need -= pantry;
  if (need > 1) {
    // pantry is bare: algae paste before breaking the emergency seal
    const more = Math.min(f.algae, need);
    f.algae -= more;
    algae += more;
    need -= more;
  }
  if (need > 1 && f.emergency > 0) {
    if (!f.emergencyOpened) {
      f.emergencyOpened = true;
      emit(state, 'emergency_reserve', { resource: 'rations', kcal: Math.round(f.emergency) });
    }
    const e = Math.min(f.emergency, need);
    f.emergency -= e;
    pantry += e;
    need -= e;
  }
  const kcal = fresh + algae + pantry;
  const share = (x) => (kcal > 0 ? x / kcal : 0);
  let quality = 0.45 + 0.35 * share(fresh) + 0.12 * morale - 0.4 * share(algae) + range(state.rng, -0.05, 0.05);
  if (!hot) quality -= 0.12;
  return {
    kcal: Math.round(kcal), quality: clamp(quality, 0.1, 1), freshShare: share(fresh), algaeShare: share(algae),
    crops: [...new Set(crops)], hot,
  };
}

/** Fresh lots that will spoil before they can plausibly be eaten. */
export function preservable(state) {
  const f = state.ship.food;
  let kcal = 0;
  for (const lot of f.fresh) {
    const daysLeft = (lot.spoilT - state.t) / DAY;
    if (daysLeft < 3 && lot.kcal > 300) kcal += lot.kcal;
  }
  return kcal;
}

/** Dry / pickle surplus fresh produce into the pantry. */
export function preserveSurplus(state) {
  const f = state.ship.food;
  let kcal = 0;
  let kg = 0;
  f.fresh = f.fresh.filter((lot) => {
    const daysLeft = (lot.spoilT - state.t) / DAY;
    if (daysLeft < 3 && lot.kcal > 300) {
      kcal += lot.kcal * 0.9;
      kg += lot.kg;
      return false;
    }
    return true;
  });
  f.pantry += kcal;
  return { kcal: Math.round(kcal), kg: Math.round(kg * 10) / 10 };
}
