#!/usr/bin/env node
// Headless runner for inspecting the Phase 1 simulation from a terminal.
//
//   node tools/run.mjs --hours 8 --seed voyager --timeline
//   node tools/run.mjs --days 30 --summary
//   node tools/run.mjs --hours 8 --save /tmp/t.json   (then --load /tmp/t.json)
import { writeFileSync, readFileSync } from 'node:fs';
import { loadData } from './node-data.mjs';
import { createInitialState, step, drain, formatShipTime, pantryDays, trayStage } from '../src/sim/index.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i < 0 ? def : args[i + 1]; };
const flag = (name) => args.includes(`--${name}`);

const data = loadData();
const seed = opt('seed', 'voyager');
const hours = Number(opt('hours', 0)) + 24 * Number(opt('days', 0)) || 8;
const state = opt('load') ? deserialize(readFileSync(opt('load'), 'utf8'), data) : createInitialState(data, { seed });

const SHOW = new Set(['activity_start', 'activity_interrupted', 'fault', 'fault_escalated', 'alarm', 'repair', 'repair_mistake', 'maintenance',
  'harvest', 'plant', 'tray_died', 'power_mode', 'resource_low', 'resource_recovered', 'emergency_reserve', 'log_entry', 'fabricate',
  'salvage', 'overheat', 'collapse', 'spoiled', 'preserve', 'wake', 'sleep_start', 'meal', 'music_start', 'routine_start',
  'system_arrival', 'system_survey', 'agenda', 'discovery', 'body_scan', 'route_plotted', 'void_ahead', 'stranded', 'hyperspace_charge',
  'hyperspace_enter', 'scoop_start', 'scoop_end', 'scoop_abort', 'scoop_misjudge', 'heat_warning', 'heat_damage', 'supercruise_engage',
  'orbit_entered', 'descent_phase', 'touchdown', 'liftoff', 'eva_phase', 'eva_step_out', 'eva_feature', 'eva_turnback', 'eva_end',
  'keepsake', 'awe', 'refine', 'melt_ice', 'bay_dormant', 'torpor_start', 'torpor_end', 'thermal_retreat']);
const counts = {};
const activityTime = {};
const t0 = performance.now();
const ticks = Math.round(hours * 3600);
for (let i = 0; i < ticks; i++) {
  step(state, data);
  if (state.outbox.length) {
    for (const e of drain(state)) {
      counts[e.type] = (counts[e.type] || 0) + 1;
      if (e.type === 'activity_end') activityTime[e.activity] = (activityTime[e.activity] || 0) + e.seconds;
      if (flag('timeline') && SHOW.has(e.type)) {
        const { id, t, mt, day, type, facts, ...rest } = e;
        const detail = type === 'activity_start'
          ? `${rest.activity}${rest.routine ? ` [${rest.routine}]` : ''} @ ${rest.room}${rest.duration > 0 ? ` (${Math.round(rest.duration / 60)} min)` : ''}`
          : type === 'log_entry' ? `entry #${rest.entry}` : JSON.stringify(rest);
        console.log(`${formatShipTime({ ...state, t })}  ${type.padEnd(20)} ${detail}`);
      }
      if (flag('logs') && e.type === 'log_entry') console.log(JSON.stringify(e.facts, null, 2));
    }
  }
}
const ms = performance.now() - t0;

const s = state;
const sh = s.ship;
const tr = s.traveler;
const r = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
console.log(`\n── ${hours} h simulated in ${Math.round(ms)} ms (${r((ticks / ms) / 1000, 1)}M ticks/s) — seed "${s.seed}" — now ${formatShipTime(s)}`);
console.log('traveler   ', tr.pos.room, '·', tr.activity ? tr.activity.id : 'idle', '· needs', Object.fromEntries(Object.entries(tr.needs).map(([k, v]) => [k, r(v)])));
console.log('mood/body  ', { ...Object.fromEntries(Object.entries(tr.mood).map(([k, v]) => [k, r(v)])), fitness: r(tr.body.fitness), condition: r(tr.body.condition) });
console.log('power      ', sh.power.mode, `${r(sh.power.reactorOut, 1)} kW out, battery ${Math.round((100 * sh.power.battery) / sh.power.batteryCap)}%, heat ${r(sh.thermal.heat)}, fuel ${r(sh.fuel.tons)} t`);
console.log('air/water  ', `O2 ${r(sh.atmo.o2)}%, CO2 ${Math.round(sh.atmo.co2)} ppm, potable ${Math.round(sh.water.potable)} L, grey ${Math.round(sh.water.grey)} L, reserve ${Math.round(sh.water.reserve)} L`);
console.log('food       ', `pantry ${r(pantryDays(s), 1)} d, algae ${Math.round(sh.food.algae)} kcal, fresh lots ${sh.food.fresh.length}, emergency ${sh.food.emergencyOpened ? 'opened' : 'sealed'}`);
console.log('racks      ', sh.trays.map((t) => (t.crop ? `${t.crop}:${trayStage(t)}` : 'empty')).join(' '));
console.log('stores     ', sh.inventory.parts, 'parts,', sh.inventory.filters, 'filters,', sh.inventory.cartridges, 'cartridges,', sh.inventory.seals, 'seals,', r(sh.inventory.feedstock, 1), 'kg feedstock');
const sp = s.space;
const f = s.ship.flight;
console.log('flight     ', f.mode, f.at ? `@ ${f.at}` : '', `· system ${sp.systemId} · route ${sp.route ? sp.route.name : sp.void ? 'VOID ' + Math.round(sp.void.ly) + ' ly' : '-'} · agenda ${sp.agenda.length}`);
console.log('voyage     ', sp.stats, 'cargo', sp.cargo, 'keepsakes', tr.keepsakes.length, 'calendar +', r(s.calendar.torporSeconds / 86400 / 365.25, 1), 'y torpor');
console.log('faults     ', Object.entries(sh.components).filter(([, c]) => c.fault).map(([k, c]) => `${k}:${c.fault.id}`).join(', ') || 'none');
if (flag('summary') || !flag('timeline')) {
  console.log('events     ', counts);
  console.log('hours by activity', Object.fromEntries(Object.entries(activityTime).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r(v / 3600, 1)])));
}
if (opt('save')) {
  writeFileSync(opt('save'), serialize(s));
  console.log('saved snapshot →', opt('save'));
}
