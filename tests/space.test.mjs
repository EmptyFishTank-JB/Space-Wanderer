import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, assertFinite, clone, DAY, HOUR } from './helpers.mjs';
import { step, drain, shipHour } from '../src/sim/index.js';
import { getSystem, generateSystem, bodyPos } from '../src/space/system.js';
import { neighbors, density, starsInCell } from '../src/space/galaxy.js';
import { currentSystem, setCourse, startJump, shipPos } from '../src/space/flight.js';
import { plotRoute, heading } from '../src/space/navigator.js';
import { serialize, deserialize, FORMAT } from '../src/persist/snapshot.js';
import { missionSeconds } from '../src/sim/clock.js';

const space = data.space;

/** Step the sim without the traveler AI interfering (pure ship processes). */
function shipOnly(s, n, until) {
  for (let i = 0; i < n; i++) {
    s.t += 1;
    s.tick += 1;
    // just the flight model, no traveler AI
    flightTick(s);
    if (until && until(s)) return i + 1;
  }
  return n;
}
import { updateFlight } from '../src/space/flight.js';
function flightTick(s) { updateFlight(s, data, 1); }

/** Find a nearby system with a landable rocky body. */
function landableNearStart(s) {
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 120, space)) {
    const sys = getSystem(s.space.galaxySeed, c.id, space);
    const b = sys.bodies.find((x) => x.landable && x.kind === 'planet' && x.gravity < 1.5 && x.a < 3000);
    if (b) return { sys, b };
  }
  throw new Error('no landable body nearby');
}

function placeInOrbit(s, sys, b) {
  Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: {}, agenda: [] });
  Object.assign(s.ship.flight, { mode: 'orbit', at: b.id, target: null, v: 0 });
}

test('galaxy & systems are deterministic and plausibly populated', () => {
  const s = fresh('gal');
  const seed = s.space.galaxySeed;
  const id = s.space.systemId;
  assert.deepEqual(JSON.parse(JSON.stringify(generateSystem(seed, id, space))), JSON.parse(JSON.stringify(generateSystem(seed, id, space))));
  const counts = {};
  let n = 0;
  for (let x = -6; x <= 6; x++) for (let y = -6; y <= 6; y++) for (const st of starsInCell(seed, x, y, 0, space)) { counts[st.cls] = (counts[st.cls] || 0) + 1; n++; }
  assert.ok(n > 200, `only ${n} stars`);
  assert.ok(counts.M / n > 0.45, `red dwarfs should dominate: ${JSON.stringify(counts)}`);
  const sys = currentSystem(s, data);
  assert.ok(['G', 'K'].includes(sys.star.cls), 'mission starts at a sun-like star');
});

test('rifts exist along the mission heading', () => {
  const s = fresh('rift');
  const H = heading(data);
  let below = 0;
  for (let d = 0; d < 12000; d += 50) {
    const p = s.space.pos.map((v, i) => v + H[i] * d);
    if (density(s.space.galaxySeed, p, space.galaxy) < space.galaxy.riftThreshold) below++;
  }
  assert.ok(below > 5, `no rifts in 12,000 ly (${below})`);
});

test('supercruise: worlds take real minutes to reach, far ones longer, and speed is capped by gravity wells', () => {
  const s = fresh('cruise');
  // find a system with a distant world to make the long trip meaningful
  let pick = null;
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 150, space)) {
    const sys = getSystem(s.space.galaxySeed, c.id, space);
    const planets = sys.bodies.filter((b) => b.parent === 'star' && b.kind === 'planet').sort((a, b) => a.a - b.a);
    const far = planets.find((b) => b.a > 2500 && b.a < 8000);
    const near = planets.find((b) => b.a > 200 && b.a < 1500);
    if (far && near) { pick = { sys, far, near }; break; }
  }
  assert.ok(pick, 'no suitable system nearby');
  Object.assign(s.space, { systemId: pick.sys.id, pos: pick.sys.pos.slice() });
  s.ship.flight.pos = { x: 8 * pick.sys.star.radius, y: 0 };
  const run = (b) => {
    const c = clone(s);
    setCourse(c, data, b.id);
    let vmax = 0;
    const secs = shipOnly(c, 4 * HOUR, (x) => { vmax = Math.max(vmax, x.ship.flight.v); return x.ship.flight.mode === 'orbit'; });
    assert.equal(c.ship.flight.mode, 'orbit', `never reached ${b.name}`);
    return { secs, vmax };
  };
  const near = run(pick.near);
  const far = run(pick.far);
  assert.ok(near.secs >= 60 && near.secs < 15 * 60, `${Math.round(pick.near.a)} Ls trip took ${near.secs}s`);
  assert.ok(far.secs > near.secs, 'the outer world should take longer');
  assert.ok(far.secs < 40 * 60, `${Math.round(pick.far.a)} Ls trip took ${far.secs}s`);
  assert.ok(far.vmax > 50 && far.vmax <= space.supercruise.maxLsPerSec, `peak ${far.vmax} Ls/s`);
});

test('hyperspace jump: charge, transit, emergence near a new star; fuel and drive coil pay for it', () => {
  const s = fresh('jump');
  s.space.surveyed = true;
  const route = plotRoute(s, data);
  assert.equal(route.kind, 'jump');
  const fuel0 = s.ship.fuel.tons;
  const from = s.space.systemId;
  startJump(s, data, route);
  const evs = [];
  let secs = 0;
  for (; secs < 600; secs++) {
    flightTick(s);
    evs.push(...drain(s));
    if (s.ship.flight.mode === 'idle') break;
  }
  assert.notEqual(s.space.systemId, from);
  assert.ok(secs >= 45 && secs <= 80, `jump took ${secs}s`);
  assert.ok(Math.abs(fuel0 - route.cost - s.ship.fuel.tons) < 1e-9);
  const types = evs.map((e) => e.type);
  for (const t of ['hyperspace_charge', 'hyperspace_enter', 'hyperspace_exit', 'system_arrival']) assert.ok(types.includes(t), t);
  const r = Math.hypot(s.ship.flight.pos.x, s.ship.flight.pos.y) / currentSystem(s, data).star.radius;
  assert.ok(r >= 5.9, `emerged at ${r} radii`);
});

test('fuel scooping fills the tank without cooking the ship (traveler at the helm)', () => {
  const s = fresh('scoop');
  Object.assign(s.space, { surveyed: true, agenda: [{ kind: 'scoop' }] });
  s.ship.fuel.tons = 6;
  const evs = runCollect(s, DAY, ['scoop_end', 'heat_damage', 'scoop_abort']);
  const end = evs.find((e) => e.type === 'scoop_end');
  assert.ok(end, 'never scooped');
  assert.ok(end.tons > 15, `only ${end.tons} t`);
  assert.ok(end.peakHeat > 0.5 && end.peakHeat < 1.1, `peak heat ${end.peakHeat}`);
  assert.ok(end.t - evs.find((e) => e.type === 'scoop_end').t === 0);
});

test('landing, EVA through the helmet, liftoff: the four-stage descent in real time', () => {
  const s = fresh('lander');
  // run to a fresh morning first
  runCollect(s, 3 * HOUR);
  const { sys, b } = landableNearStart(s);
  placeInOrbit(s, sys, b);
  s.space.agenda = [{ kind: 'visit', body: b.id, land: true, eva: 1, lingerH: 0, done: { scanned: false, landed: false, evas: 0, lingerUntil: null, leftSurface: false } }];
  const evs = [];
  let sawSurface = false;
  for (let i = 0; i < 2 * DAY; i++) {
    step(s, data);
    if (s.traveler.pos.room === 'surface') sawSurface = true;
    if (s.outbox.length) evs.push(...drain(s));
    if (evs.some((e) => e.type === 'orbit_entered' && e.fromSurface)) break;
  }
  const seq = evs.filter((e) => ['body_scan', 'descent_phase', 'touchdown', 'eva_step_out', 'eva_end', 'liftoff', 'orbit_entered'].includes(e.type));
  const names = seq.map((e) => (e.type === 'descent_phase' ? e.phase : e.type));
  assert.ok(names.indexOf('body_scan') < names.indexOf('orbital'), names.join(' '));
  assert.ok(names.includes('touchdown') && names.includes('eva_step_out') && names.includes('eva_end') && names.includes('liftoff'), names.join(' '));
  const desc = seq.find((e) => e.type === 'descent_phase' && e.phase === 'orbital');
  const td = seq.find((e) => e.type === 'touchdown');
  const mins = (td.t - desc.t) / 60;
  assert.ok(mins >= 8 && mins <= 25, `descent took ${mins.toFixed(1)} min`);
  assert.ok(sawSurface, 'traveler never stood on the surface');
  const eva = seq.find((e) => e.type === 'eva_end');
  assert.ok(eva.walkedM > 100);
  assert.equal(s.ship.flight.mode, 'orbit');
  assert.notEqual(s.traveler.pos.room, 'surface');
});

test('torpor: a void crossing passes years on the calendar in one long night, with the bay held dormant', () => {
  const s = fresh('torpor');
  runCollect(s, 10 * HOUR); // mid-afternoon
  const target = neighbors(s.space.galaxySeed, s.space.pos, 200, space).find((c) => c.dist > 120 && space.starClasses[c.cls].scoopable);
  Object.assign(s.space, { surveyed: true, agenda: [], route: null, void: { ly: target.dist, years: target.dist / space.drive.voidLyPerYear, star: target.id, name: 'test' } });
  const evs = [];
  let growthAtStart = null;
  let hungerAtStart = null;
  for (let i = 0; i < 3 * DAY; i++) {
    step(s, data);
    const a = s.traveler.activity;
    if (a && a.id === 'enter_torpor' && a.phase === 'perform' && growthAtStart === null) {
      growthAtStart = s.ship.trays.map((t) => t.growth);
      hungerAtStart = s.traveler.needs.hunger;
    }
    if (s.outbox.length) evs.push(...drain(s));
    if (evs.some((e) => e.type === 'torpor_end')) break;
  }
  const start = evs.find((e) => e.type === 'torpor_start');
  const end = evs.find((e) => e.type === 'torpor_end');
  assert.ok(evs.some((e) => e.type === 'bay_dormant'), 'bay never winterised');
  assert.ok(start && end, 'no torpor');
  const startHour = shipHour({ ...s, t: start.t, calendar: { ...s.calendar, torporSeconds: 0 } });
  assert.ok(startHour >= 19.5 && startHour < 24, `entered torpor at ${startHour}`);
  const realH = (end.t - start.t) / HOUR;
  assert.ok(realH >= 10 && realH <= 15.1, `torpor lasted ${realH} h real time`);
  assert.ok(s.calendar.torporSeconds >= 2 * 365 * DAY, 'calendar did not jump by years');
  assert.equal(s.calendar.torporSeconds % DAY, 0, 'torpor must add whole days');
  assert.equal(s.space.systemId, target.id);
  assert.equal(s.ship.hydroDormant, false);
  assert.ok(end.years > 2);
  assert.ok(hungerAtStart !== null);
  assertFinite(s);
});

test('a Phase 1 (v1) snapshot upgrades into a galaxy and keeps living', () => {
  const s = fresh('legacy');
  runCollect(s, 2 * HOUR);
  const v1 = clone(s);
  delete v1.space;
  v1.ship.flight = { mode: 'interstellar_coast', solarKW: 0.6, externalHeat: 0, systemId: null };
  const text = JSON.stringify({ format: FORMAT, version: 1, savedAtMs: 1, state: v1 });
  assert.throws(() => deserialize(text), /needs the data/);
  const up = deserialize(text, data);
  assert.equal(up.version, 2);
  assert.ok(up.space && up.space.systemId);
  assert.equal(up.traveler.history.logsWritten, s.traveler.history.logsWritten);
  runCollect(up, DAY);
  assertFinite(up);
});

test('60-day voyage soak: keeps moving, never strands, never cooks, stays finite', () => {
  const s = fresh('soak');
  let minFuel = Infinity;
  let heatDamage = 0;
  let stranded = 0;
  for (let d = 0; d < 60; d++) {
    for (const e of runCollect(s, DAY, ['heat_damage', 'stranded'])) {
      if (e.type === 'heat_damage') heatDamage++;
      else stranded++;
    }
    minFuel = Math.min(minFuel, s.ship.fuel.tons);
  }
  const st = s.space.stats;
  assert.ok(st.systems >= 40, `${st.systems} systems`);
  assert.ok(st.landings >= 5 && st.evas >= 5, JSON.stringify(st));
  assert.ok(minFuel >= 0);
  assert.ok(heatDamage < 20, `${heatDamage} heat-damage ticks`);
  assert.ok(stranded < 3);
  assert.ok(s.traveler.mood.wonder > 0.2 && s.traveler.mood.wonder < 0.95);
  assert.ok(s.traveler.body.condition > 0.8);
  assertFinite(s);
  // the snapshot stays small: systems are regenerated, not stored
  assert.ok(serialize(s).length < 80000, `snapshot ${serialize(s).length} bytes`);
});

test('planets keep orbiting: positions move with mission time, including through torpor', () => {
  const s = fresh('orbits');
  const sys = currentSystem(s, data);
  const b = sys.bodies.find((x) => x.kind === 'planet');
  const p0 = bodyPos(sys, b.id, missionSeconds(s));
  const p1 = bodyPos(sys, b.id, missionSeconds(s) + b.period / 4);
  assert.ok(Math.hypot(p1.x - p0.x, p1.y - p0.y) > b.a * 0.5);
  assert.ok(Math.abs(Math.hypot(p0.x, p0.y) - b.a) < 1e-6);
  assert.ok(shipPos(s, data));
});

test('flying too close: a deep dive and a lapse of attention cook the manifold, forcing a pull-away and repairs', () => {
  const s = fresh('cooked');
  runCollect(s, 3 * HOUR);
  Object.assign(s.space, { surveyed: true, agenda: [{ kind: 'scoop' }] });
  s.ship.fuel.tons = 2;
  s.ship.fuel.capacity = 120; // keep the scoop running long enough to overheat
  const wear0 = s.ship.components.scoop_manifold.wear;
  const evs = [];
  let forced = false;
  for (let i = 0; i < DAY; i++) {
    step(s, data);
    const sc = s.ship.flight.scoop;
    if (!forced && s.ship.flight.mode === 'scooping' && sc && sc.state === 'active') {
      forced = true;
      sc.rTarget = data.space.scoop.minRadii; // misjudged dive...
      sc.nextCheckT = s.t + 1800; // ...and eyes off the gauges
    }
    if (s.outbox.length) evs.push(...drain(s));
  }
  assert.ok(forced, 'never scooped');
  assert.ok(evs.some((e) => e.type === 'heat_damage'), 'no heat damage');
  const end = evs.find((e) => e.type === 'scoop_end');
  assert.ok(end && end.peakHeat > 1.0, `scoop ended without overheating: ${JSON.stringify(end)}`);
  assert.ok(s.ship.components.scoop_manifold.wear > wear0 || evs.some((e) => e.type === 'repair' || e.type === 'maintenance'), 'no lasting consequence');
});
