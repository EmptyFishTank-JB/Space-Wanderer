// DEVELOPER INSPECTOR — loaded only with ?debug. This is a build/QA tool for
// verifying the headless simulation before the renderer exists. It is NOT
// part of the experience and must never ship enabled: the spec forbids
// non-diegetic HUDs. It only reads state; it has no controls.
import { formatShipTime, pantryDays, trayStage } from '../sim/index.js';
import { currentSystem, starDistance } from '../space/flight.js';

function flightLine(t) {
  const s = t.state;
  const f = s.ship.flight;
  const sys = currentSystem(s, t.data);
  const where = f.at ? sys.byId[f.at].name : `${(starDistance(s, t.data) / sys.star.radius).toFixed(1)} R from star`;
  const extra = f.mode === 'cruise' ? ` · ${f.v.toFixed(3)} Ls/s (${Math.round(f.v * 299792)} km/s) · ${f.targetDist.toFixed(2)} Ls to go`
    : f.mode === 'descent' || f.mode === 'ascent' ? ` · ${f.phases ? f.phases.list[f.phases.i].name : ''} · alt ${f.altitudeKm.toFixed(1)} km`
    : f.mode === 'scooping' ? ` · ${f.scoop.r.toFixed(2)} R` : '';
  return `${sys.name} (${sys.star.cls} ${sys.star.label}) · ${f.mode} · ${where}${extra} · ext heat ${f.externalHeat.toFixed(2)} · solar ${f.solarKW.toFixed(1)} kW`;
}

const pct = (x) => `${Math.round(x * 100)}`.padStart(3);
const bar = (x) => '█'.repeat(Math.round(x * 10)).padEnd(10, '·');

export function mountInspector(t) {
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed', inset: '8px auto auto 8px', margin: 0, padding: '10px 12px', maxWidth: 'calc(100vw - 16px)',
    font: '12px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#9fb4c8', background: 'rgba(5,6,10,0.85)',
    border: '1px solid #1d2733', whiteSpace: 'pre-wrap', pointerEvents: 'none', zIndex: 10,
  });
  document.body.appendChild(el);
  const log = [];
  const QUIET = new Set(['hatch_cycle', 'walk_start', 'activity_end', 'routine_end', 'micro']);
  t.onEvents((evs) => {
    for (const e of evs) {
      if (QUIET.has(e.type)) continue;
      const { id, t: _t, mt, day, type, ...rest } = e;
      log.push(`${formatShipTime({ ...t.state, t: e.t })}  ${type}  ${JSON.stringify(rest).slice(0, 110)}`);
    }
    if (log.length > 14) log.splice(0, log.length - 14);
  });
  const draw = () => {
    const s = t.state;
    const tr = s.traveler;
    const sh = s.ship;
    const a = tr.activity;
    const n = tr.needs;
    const faults = Object.entries(sh.components).filter(([, c]) => c.fault).map(([k, c]) => `${k}:${c.fault.id}(${c.fault.severity}${c.known ? '' : ',unnoticed'})`);
    el.textContent = [
      `DEV INSPECTOR (?debug) — not part of the experience`,
      `${formatShipTime(s)}   tick ${s.tick}   cargo ore ${s.space.cargo.ore.toFixed(1)} kg · ice ${s.space.cargo.ice.toFixed(1)} kg · keepsakes ${tr.keepsakes.length}`,
      `traveler  ${tr.pos.room} @ ${tr.pos.x.toFixed(1)}m   ${tr.move ? 'walking → ' : ''}${a ? `${a.id}${a.routine ? ` [${a.routine}]` : ''} ${a.phase}` : 'idle'}`,
      `needs     fatigue ${bar(n.fatigue)} hunger ${bar(n.hunger)} thirst ${bar(n.thirst)}`,
      `          hygiene ${bar(n.hygiene)} stress ${bar(n.stress)} solitude ${bar(n.solitude)}`,
      `mood      wonder ${pct(tr.mood.wonder)}  weariness ${pct(tr.mood.weariness)}  fitness ${pct(tr.body.fitness)}  condition ${pct(tr.body.condition)}`,
      `power     ${sh.power.mode}  ${sh.power.reactorOut.toFixed(1)}/${sh.power.reactorMax.toFixed(0)} kW  demand ${sh.power.demand.toFixed(1)}  battery ${pct(sh.power.battery / sh.power.batteryCap)}%  heat ${sh.thermal.heat.toFixed(2)}  fuel ${sh.fuel.tons.toFixed(2)} t`,
      `air/water O2 ${sh.atmo.o2.toFixed(2)}%  CO2 ${Math.round(sh.atmo.co2)} ppm  RH ${pct(sh.atmo.airWater / 5.8)}%   potable ${Math.round(sh.water.potable)} L  grey ${Math.round(sh.water.grey)} L  reserve ${Math.round(sh.water.reserve)} L`,
      `food      pantry ${pantryDays(s).toFixed(0)} d  algae ${Math.round(sh.food.algae)} kcal  fresh ${sh.food.fresh.length} lots  emergency ${sh.food.emergencyOpened ? 'OPEN' : 'sealed'}`,
      `racks     ${sh.trays.map((x) => (x.crop ? `${x.crop}:${trayStage(x)}` : 'empty')).join('  ')}`,
      `stores    ${Object.entries(sh.inventory).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}`).join('  ')}`,
      `voyage    ${flightLine(t)}`,
      `          ${s.space.stats.systems} systems · ${Math.round(s.space.stats.ly)} ly · ${s.space.stats.landings} landings · ${s.space.stats.evas} EVAs · ${s.space.stats.torpors} torpor (${s.space.stats.torporYears.toFixed(1)} y) · agenda ${s.space.agenda.map((i) => i.kind === 'visit' ? (i.land ? 'land ' : 'visit ') + i.body : i.kind).join(', ') || '—'}`,
      `faults    ${faults.join('  ') || 'none'}`,
      `memory    ${(s.memory && s.memory.records.length) || 0} records · skills ${s.traveler.skills ? Object.entries(s.traveler.skills).map(([k, v]) => `${k} ${Math.round(v * 100)}`).join(' ') : '-'} · reading ${t.data.traveler.library[(s.traveler.library.book) % t.data.traveler.library.length].title} p.${s.traveler.library.page}`,
      `last log  ${s.memory && s.memory.logs.length ? `#${s.memory.logs[s.memory.logs.length - 1].entry} ${s.memory.logs[s.memory.logs.length - 1].text.slice(0, 150)}…` : '—'}`,
      ``,
      ...log,
    ].join('\n');
  };
  setInterval(draw, 1000);
  draw();
}
