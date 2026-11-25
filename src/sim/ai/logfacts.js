// Structured facts for a log entry. Phase 1 records *what* the traveler would
// write about; Phase 5's grounded log generator turns these into prose.
import { missionDay, missionYear, dayOfYear } from '../clock.js';
import { pantryDays } from '../ship/food.js';
import { trayStage } from '../ship/hydroponics.js';
import { currentSystem } from '../../space/flight.js';

const r2 = (x) => Math.round(x * 100) / 100;

export function buildLogFacts(s, d) {
  const dg = s.journal.sinceLastLog;
  const tr = s.traveler;
  const sh = s.ship;
  const worn = d.componentIds
    .filter((id) => !d.components[id].phase2 && sh.components[id].knownWear > 0.6 && !sh.components[id].fault)
    .map((id) => d.components[id].name);
  const openFaults = d.componentIds
    .filter((id) => sh.components[id].fault && sh.components[id].known)
    .map((id) => ({ component: d.components[id].name, fault: sh.components[id].fault.id, severity: sh.components[id].fault.severity }));
  const stages = {};
  for (const t of sh.trays) { const st = trayStage(t); stages[st] = (stages[st] || 0) + 1; }
  return {
    missionDay: missionDay(s), year: missionYear(s), dayOfYear: dayOfYear(s),
    flight: sh.flight.mode,
    voyage: voyageFacts(s, d, dg),
    meals: dg.meals, avgMealQuality: dg.meals ? r2(dg.mealQuality / dg.meals) : null, algaeHeavyMeals: dg.algaeMeals,
    sleep: dg.sleeps.length ? { hours: r2(dg.sleeps.reduce((a, x) => a + x.hours, 0)), quality: r2(dg.sleeps.reduce((a, x) => a + x.quality, 0) / dg.sleeps.length) } : null,
    faults: dg.faults, repairs: dg.repairs, mistakes: dg.mistakes, maintenance: dg.maintenance,
    harvests: dg.harvests, plantings: dg.plantings, deadTrays: dg.deadTrays, spoiledKg: r2(dg.spoiledKg),
    fabricated: dg.fabricated, salvageKg: r2(dg.salvageKg), powerModes: dg.powerModes, alarms: dg.alarms,
    hobbies: dg.hobbies, exercised: dg.exercise > 0, resourceLow: dg.resourceLow,
    openFaults, worn, trayStages: stages,
    pantryDays: Math.round(pantryDays(s)), potableL: Math.round(sh.water.potable), fuelT: r2(sh.fuel.tons),
    co2: Math.round(sh.atmo.co2), heat: r2(sh.thermal.heat), power: sh.power.mode,
    mood: { wonder: r2(tr.mood.wonder), weariness: r2(tr.mood.weariness), stress: r2(tr.needs.stress), solitude: r2(tr.needs.solitude) },
    daysSinceNovelty: Math.round(tr.history.daysSinceNovelty * 10) / 10,
    books: dg.books || [], sketch: dg.sketch || null,
    skills: tr.skills ? { ...tr.skills } : null,
  };
}

function voyageFacts(s, d, dg) {
  const sp = s.space;
  const sys = currentSystem(s, d);
  const f = s.ship.flight;
  return {
    system: sys.name, star: sys.star.label, starClass: sys.star.cls, at: f.at ? sys.byId[f.at].name : null, mode: f.mode,
    atBody: f.at ? (({ name, type, rings, atmosphere, beauty }) => ({ name, type, rings, atmosphere, beauty }))(sys.byId[f.at]) : null,
    arrivals: dg.arrivals, discoveries: dg.discoveries, landings: dg.landings, evas: dg.evas, scoops: dg.scoops,
    awe: dg.awe, torpor: dg.torpor, heatDamage: dg.heatDamage, keepsakes: dg.keepsakes,
    lyTotal: Math.round(sp.stats.ly), systemsTotal: sp.stats.systems, yearsInTorpor: Math.round(sp.stats.torporYears * 10) / 10,
    nextLeg: sp.void ? { void: true, ly: Math.round(sp.void.ly), years: Math.round(sp.void.years * 10) / 10 } : sp.route ? { to: sp.route.name, ly: Math.round(sp.route.dist * 10) / 10 } : null,
  };
}
