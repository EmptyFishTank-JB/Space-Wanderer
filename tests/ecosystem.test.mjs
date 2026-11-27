import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, assertFinite, DAY, HOUR } from './helpers.mjs';
import { startFault } from '../src/sim/ship/wear.js';
import { step } from '../src/sim/index.js';

/** Advance until the traveler is asleep at night. */
function untilAsleep(s) {
  for (let i = 0; i < 2 * DAY; i++) {
    step(s, data);
    s.outbox.length = 0;
    const a = s.traveler.activity;
    if (a && a.id === 'sleep' && a.phase === 'perform' && a.elapsed > HOUR && s.t > 6 * HOUR) return;
  }
  throw new Error('never fell asleep');
}

test('an alarm wakes the traveler and the vents get fixed before the reactor cooks', () => {
  const s = fresh('alarm');
  untilAsleep(s);
  startFault(s, data, 'thermal_vents', 'major');
  const evs = runCollect(s, 12 * HOUR);
  const wake = evs.find((e) => e.type === 'wake');
  assert.ok(wake && wake.interrupted, 'alarm did not wake the traveler');
  const repair = evs.find((e) => e.type === 'repair' && e.component === 'thermal_vents');
  assert.ok(repair, 'vents never repaired');
  assert.ok(repair.t - evs[0].t < 4 * HOUR, 'repair took too long');
  assert.equal(s.ship.components.thermal_vents.fault, null);
});

test('scrubber failure raises CO2, which the traveler notices and repairs', () => {
  const s = fresh('co2');
  startFault(s, data, 'o2_scrubber', 'major');
  s.ship.components.o2_scrubber.wear = 0.95;
  const evs = runCollect(s, DAY);
  assert.ok(evs.some((e) => e.type === 'repair' && e.component === 'o2_scrubber'));
  assert.ok(s.ship.atmo.co2 < 1500);
});

test('power starvation: adrift far from the star with no fuel the ship goes limp, then the traveler scoops and it recovers', () => {
  const s = fresh('limp');
  Object.assign(s.space, { surveyed: true, agenda: [] });
  s.ship.flight.pos = { x: 200000, y: 0 }; // deep in the outer system: no useful sunlight
  s.ship.fuel.tons = 0;
  s.ship.power.battery = 20;
  const evs = runCollect(s, 2 * DAY);
  const modes = evs.filter((e) => e.type === 'power_mode').map((e) => e.mode);
  assert.ok(modes.includes('limp'), `modes: ${modes}`);
  assert.ok(evs.some((e) => e.type === 'scoop_end' && e.tons > 5), 'never scooped');
  assert.ok(modes.lastIndexOf('normal') > modes.indexOf('limp'), `never recovered: ${modes}`);
  assert.ok(s.traveler.body.condition > 0.8);
  assertFinite(s);
});

test('anti-soft-lock: with no parts or feedstock left, jury-rigs keep the ship alive', () => {
  const s = fresh('austere');
  s.space.credits = 0; // broke as well: a station can't sell us a way out
  Object.assign(s.ship.inventory, { parts: 0, filters: 0, cartridges: 0, seals: 0, feedstock: 0 });
  s.ship.salvage.remainingKg = 0;
  for (const id of ['water_recycler', 'o2_scrubber', 'thermal_vents', 'hydro_pump_1', 'ogs']) startFault(s, data, id, 'major');
  const evs = runCollect(s, 10 * DAY);
  const jury = evs.filter((e) => e.type === 'repair' && e.juryRig);
  assert.ok(jury.length >= 5, `only ${jury.length} jury-rigs`);
  for (const id of ['water_recycler', 'o2_scrubber', 'thermal_vents']) {
    assert.ok(!s.ship.components[id].fault || s.ship.components[id].fault.severity === 'minor', `${id} still down`);
  }
  assert.ok(s.traveler.body.condition > 0.5);
  assert.ok(evs.filter((e) => e.type === 'meal').length >= 20, 'traveler stopped living');
  assertFinite(s);
});

test('starvation failsafe: an empty larder leans on the algae vat, never kills', () => {
  const s = fresh('hungry');
  s.space.credits = 0; // and no money for the station's bar or market
  Object.assign(s.ship.food, { pantry: 0, algae: 0, emergency: 0, fresh: [] });
  const evs = runCollect(s, 5 * DAY);
  assert.ok(evs.some((e) => e.type === 'tend_algae' && e.kcal > 0));
  assert.ok(evs.some((e) => e.type === 'meal' && e.algaeShare > 0.5));
  assert.ok(s.traveler.body.condition >= 0.15);
});

test('neglected racks dry out without pumps and recover once repaired', () => {
  const s = fresh('pumps');
  startFault(s, data, 'hydro_pump_1', 'major');
  startFault(s, data, 'hydro_pump_2', 'major');
  const evs = runCollect(s, 3 * DAY);
  assert.ok(evs.some((e) => e.type === 'repair' && e.component.startsWith('hydro_pump')));
  const live = s.ship.trays.filter((t) => t.crop && !t.dead);
  assert.ok(live.every((t) => t.water > 0.3), 'racks left dry');
});

test('fatigue makes repairs sloppier', async () => {
  const { applyRepair } = await import('../src/sim/ship/wear.js');
  const trial = (fatigue) => {
    let mistakes = 0;
    for (let i = 0; i < 400; i++) {
      const s = fresh(`mistake-${fatigue}-${i}`);
      s.traveler.needs.fatigue = fatigue;
      startFault(s, data, 'galley_heater', 'minor');
      if (!applyRepair(s, data, 'galley_heater').ok) mistakes++;
    }
    return mistakes;
  };
  assert.ok(trial(0.95) > trial(0.2) * 2);
});

