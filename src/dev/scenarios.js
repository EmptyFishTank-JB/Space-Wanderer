// Staged scenarios: throwaway simulations run up to a moment worth seeing.
// Shared by the feed gallery (dev/gallery.html) and the tester (dev/tester.html).
// DEVELOPER GALLERY — renders every camera feed from staged sim scenarios
// (scooping, orbit, EVA, hyperspace, night, faults…) for visual QA. It builds
// its own throwaway simulations; it never touches the viewer's saved traveler.
import { createInitialState, step, drain } from '../sim/index.js';
import { loadData, fetchJson } from '../load.js';
import { neighbors } from '../space/galaxy.js';
import { getSystem } from '../space/system.js';
import { startJump, startDescent } from '../space/flight.js';
import { plotRoute } from '../space/navigator.js';
import { roverCanDrive } from '../space/rover.js';
import { stationIn, baseIn } from '../space/ports.js';
import { makePassenger } from '../space/people.js';
import { startCombat } from '../space/combat.js';
import { takePrisoner } from '../space/prisoners.js';
import { boardPassengers } from '../space/passengers.js';
import { renderFeed } from '../render/app.js';
import { Director } from '../render/director.js';
import { spaceView } from '../render/spaceview.js';
import { TravelerTracker } from '../render/actor.js';
import { startFault } from '../sim/ship/wear.js';
import { W, H } from '../render/gfx.js';
import { setShipModel } from '../render/hull3d.js';

const ROOM_FEEDS = ['CAM-01', 'CAM-02', 'CAM-03', 'CAM-04', 'CAM-05', 'CAM-06', 'CAM-07', 'CAM-09', 'CAM-10', 'CAM-11', 'CAM-12', 'CAM-13'];

export function runUntil(s, d, pred, max = 86400 * 2) {
  for (let i = 0; i < max; i++) {
    step(s, d);
    drain(s);
    if (pred(s)) return true;
  }
  return false;
}

export function findBody(s, d, test, range = 160) {
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, range, d.space)) {
    const sys = getSystem(s.space.galaxySeed, c.id, d.space);
    const b = sys.bodies.find((x) => test(x, sys));
    if (b) return { sys, b };
  }
  return null;
}

function moveTo(s, sys, b, mode = 'orbit') {
  Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: { [b.id]: true }, agenda: [] });
  Object.assign(s.ship.flight, { mode, at: b.id, target: null, v: 0 });
}

/** Landed on a world the rover can drive, the first walk already done, then run until `until`. */
function roverScene(d, until, feeds) {
  const s = createInitialState(d, { seed: 'gallery-rover' });
  runUntil(s, d, (x) => x.t > 3 * 3600);
  const f = findBody(s, d, (b) => roverCanDrive(d, b) && b.gravity > 0.2 && b.gravity < 1.4);
  if (f) {
    moveTo(s, f.sys, f.b);
    s.space.agenda = [{ kind: 'visit', body: f.b.id, land: true, eva: 1, rover: 1, lingerH: 0, done: { scanned: true, landed: false, evas: 1, rovers: 0, lingerUntil: null, leftSurface: false } }];
    runUntil(s, d, until, 86400 * 2);
  }
  return { s, feeds };
}

/** In a system with a settlement on the ground, set on landing there, then run until `until`. */
function baseScene(d, until, feeds) {
  const s = createInitialState(d, { seed: 'gallery-base' });
  runUntil(s, d, (x) => x.t > 3 * 3600);
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 160, d.space)) {
    const base = baseIn(s.space.galaxySeed, c.id, d.space);
    if (!base) continue;
    const sys = getSystem(s.space.galaxySeed, c.id, d.space);
    Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), systemName: sys.name, surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: {}, route: null });
    Object.assign(s.ship.flight, { mode: 'idle', at: null, target: null, v: 0, pos: { x: sys.star.radius * 30, y: 0 } });
    s.space.agenda = [{ kind: 'port', station: base.id, body: base.body, base: true, why: 'company', done: { ashore: false } }];
    runUntil(s, d, until, 86400 * 2);
    break;
  }
  return { s, feeds };
}

/** In a settled system near the start, with a reason to put in at its station, then run until `until`. */
function portScene(d, until, feeds) {
  const s = createInitialState(d, { seed: 'gallery-port' });
  runUntil(s, d, (x) => x.t > 3 * 3600);
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 120, d.space)) {
    const stn = stationIn(s.space.galaxySeed, c.id, d.space);
    if (!stn) continue;
    const sys = getSystem(s.space.galaxySeed, c.id, d.space);
    Object.assign(s.space, { systemId: sys.id, pos: sys.pos.slice(), systemName: sys.name, surveyed: true, detected: sys.bodies.map((x) => x.id), scanned: {}, route: null });
    Object.assign(s.ship.flight, { mode: 'idle', at: null, target: null, v: 0, pos: { x: sys.star.radius * 30, y: 0 } });
    s.space.cargo.ore = 24; s.space.dataUnsold = 3;
    s.space.agenda = [{ kind: 'port', station: stn.id, body: stn.body, why: 'company', done: { ashore: false } }];
    runUntil(s, d, until, 86400);
    break;
  }
  return { s, feeds };
}

// a few interior cameras by room, for scenes that follow the traveler somewhere
const CAMERAS_BY_ROOM = { corridor_aft: 'CAM-11', cross_main: 'CAM-22', gallery_p: 'CAM-24', fwd_main: 'CAM-21', brig: 'CAM-29', airlock: 'CAM-13', armory: 'CAM-33' };

/** A wanted-alive contract in a system with a station, the target taken and drifting alongside. */
function prisonerScene(d, seed) {
  const s = createInitialState(d, { seed });
  runUntil(s, d, (x) => x.t > 4 * 3600);
  const m = { id: `${seed}-b`, kind: 'bounty', alive: true, title: 'Wanted alive: Kestrel', faction: 'elsewhere', target: { name: 'Kestrel', cls: 'raider' }, reward: 4200, to: { starId: s.space.systemId, system: s.space.systemName }, from: { starId: s.space.systemId, station: 'nowhere' }, deadlineT: s.t + 6 * 86400, acceptedT: s.t, captured: true };
  s.space.missions = [m];
  takePrisoner(s, d, { name: 'Kestrel', cls: 'raider' }, m);
  return s;
}

export const SCENARIOS = {
  day(d) { const s = createInitialState(d, { seed: 'gallery' }); runUntil(s, d, (x) => x.t > 3.3 * 3600); return { s, feeds: [...ROOM_FEEDS, 'CAM-08'] }; },
  hull(d) { const s = createInitialState(d, { seed: 'gallery' }); runUntil(s, d, (x) => x.t > 3.3 * 3600); return { s, feeds: ['CAM-08', 'CAM-14', 'CAM-15', 'CAM-16', 'CAM-17', 'CAM-18', 'CAM-19'] }; },
  scoop(d) {
    const s = createInitialState(d, { seed: 'gallery-scoop' });
    runUntil(s, d, (x) => x.t > 3 * 3600);
    Object.assign(s.space, { surveyed: true, agenda: [{ kind: 'scoop' }] });
    s.ship.fuel.tons = 4;
    runUntil(s, d, (x) => x.ship.flight.mode === 'scooping' && x.ship.thermal.heat > 0.72);
    return { s, feeds: ['CAM-15', 'CAM-16', 'CAM-01', 'CAM-08', 'CAM-07', 'CAM-02'] };
  },
  ringed(d) {
    const s = createInitialState(d, { seed: 'gallery-ring' });
    runUntil(s, d, (x) => x.t > 4 * 3600);
    const f = findBody(s, d, (b) => b.rings && (b.type === 'gas_giant' || b.type === 'ice_giant'), 300);
    if (f) moveTo(s, f.sys, f.b);
    return { s, feeds: ['CAM-08', 'CAM-01', 'CAM-02', 'CAM-05'] };
  },
  earthlike(d) {
    const s = createInitialState(d, { seed: 'gallery-earth' });
    runUntil(s, d, (x) => x.t > 4 * 3600);
    const f = findBody(s, d, (b) => b.type === 'earth_like' || b.type === 'water_world', 600);
    if (f) moveTo(s, f.sys, f.b);
    return { s, feeds: ['CAM-08', 'CAM-02'] };
  },
  eva(d) {
    const s = createInitialState(d, { seed: 'gallery-eva' });
    runUntil(s, d, (x) => x.t > 3 * 3600);
    const f = findBody(s, d, (b) => b.landable && b.kind !== 'belt' && b.gravity < 1.5 && (b.signals.geo > 0 || b.ice));
    if (f) {
      moveTo(s, f.sys, f.b);
      s.space.agenda = [{ kind: 'visit', body: f.b.id, land: true, eva: 1, lingerH: 0, done: { scanned: true, landed: false, evas: 0, lingerUntil: null, leftSurface: false } }];
      runUntil(s, d, (x) => x.traveler.pos.room === 'surface' && x.traveler.activity.params.plan.x > 60);
    }
    return { s, feeds: ['EVA-POV', 'CAM-19', 'CAM-17', 'CAM-08', 'CAM-13', 'CAM-01'] };
  },
  rover(d) { return roverScene(d, (x) => x.traveler.activity?.id === 'rover_outing' && x.traveler.activity.params.plan?.aboard && x.traveler.activity.params.plan.x > 1500, ['ROVER-CAM', 'CAM-20', 'CAM-19', 'CAM-17']); },
  roversite(d) { return roverScene(d, (x) => x.traveler.activity?.id === 'rover_outing' && x.traveler.activity.params.plan?.site && x.traveler.activity.params.plan.site.t > 120, ['EVA-POV', 'ROVER-CAM', 'CAM-20']); },
  docking(d) { return portScene(d, (x) => x.ship.flight.mode === 'docking' && x.ship.flight.phases && x.ship.flight.phases.i >= 1 && x.ship.flight.phases.t > 200, ['CAM-08', 'CAM-14', 'CAM-01']); },
  docked(d) { return portScene(d, (x) => x.ship.flight.mode === 'docked', ['CAM-08', 'CAM-17', 'CAM-02']); },
  concourse(d) { return portScene(d, (x) => x.traveler.activity?.id === 'go_ashore' && x.traveler.activity.params.plan?.i >= 2, ['PORT-CAM', 'CAM-08']); },
  base(d) { return baseScene(d, (x) => x.ship.flight.mode === 'landed' && x.ship.flight.port, ['CAM-17', 'CAM-08', 'CAM-02']); },
  basehall(d) { return baseScene(d, (x) => x.traveler.activity?.id === 'go_ashore' && x.traveler.activity.params.plan?.i >= 2, ['PORT-CAM', 'CAM-19']); },
  combat(d) {
    const s = createInitialState(d, { seed: 'gallery-fight' });
    runUntil(s, d, (x) => x.t > 4 * 3600);
    startCombat(s, d, { name: 'Lark', cls: 'raider', wanted: true, bounty: 3500 }, 'pirate');
    runUntil(s, d, (x) => x.space.combat && x.space.combat.firing && x.space.combat.t > 30, 3600);
    return { s, feeds: ['CAM-08', 'CAM-14', 'CAM-01'] };
  },
  // a raider and two wingmen; system security answers a minute in
  pack(d) {
    const s = createInitialState(d, { seed: 'gallery-pack' });
    runUntil(s, d, (x) => x.t > 4 * 3600);
    startCombat(s, d, [{ name: 'Sable', cls: 'raider', wanted: true, bounty: 2400 }, { name: 'Pike', cls: 'interceptor', wanted: true, bounty: 450, role: 'wing' }, { name: 'Moss', cls: 'interceptor', wanted: true, bounty: 400, role: 'wing' }], 'pirate');
    s.space.combat.patrol = { dueT: s.t + 60, here: false, name: 'Concord security', ships: 2 };
    runUntil(s, d, (x) => x.space.combat && x.space.combat.patrol && x.space.combat.patrol.here && x.space.combat.t > 75, 3600);
    return { s, feeds: ['CAM-08', 'CAM-34', 'CAM-14'] };
  },
  // outgunned with a hold full of somebody else's cargo: cut the drive and let them have it
  submit(d) {
    let s;
    for (let k = 0; k < 8; k++) {
      s = createInitialState(d, { seed: `gallery-submit-${k}` });
      runUntil(s, d, (x) => x.t > 4 * 3600);
      s.traveler.needs.stress = 0.85;
      s.space.missions = [{ id: 'gallery-cargo', kind: 'cargo', title: 'Reactor spares for Halden 2210', tons: 14, reward: 1900, to: { starId: 'none', system: 'Halden 2210' }, deadlineT: s.t + 6 * 86400, acceptedT: s.t }];
      startCombat(s, d, [{ name: 'Grieve', cls: 'gunship', wanted: true, bounty: 4200 }, { name: 'Rook', cls: 'interceptor', role: 'wing' }], 'pirate');
      if (runUntil(s, d, (x) => x.space.combat && x.space.combat.submitT && x.t > x.space.combat.submitT - 15, 1800)) break;
    }
    return { s, feeds: ['CAM-08', 'CAM-35', 'CAM-14'] };
  },
  // the morning after a fight: realigning the gimbals in fire control
  firecontrol(d) {
    const s = createInitialState(d, { seed: 'gallery-firecontrol' });
    runUntil(s, d, (x) => x.t > 4 * 3600);
    startCombat(s, d, { name: 'Lark', cls: 'interceptor', wanted: true, bounty: 1200 }, 'pirate');
    runUntil(s, d, (x) => !x.space.combat, 3600);
    runUntil(s, d, (x) => x.traveler.activity && x.traveler.activity.id === 'service_weapons' && x.traveler.activity.phase === 'perform' && x.traveler.activity.elapsed > 60, 86400);
    return { s, feeds: ['CAM-34', 'CAM-35', 'CAM-33'] };
  },
  // wanted alive: the drive shot out, their ship drifting alongside, the traveler at the armory rack
  capture(d) {
    const s = prisonerScene(d, 'gallery-capture');
    runUntil(s, d, (x) => x.traveler.activity && x.traveler.activity.id === 'arm_up' && x.traveler.activity.phase === 'perform', 3600);
    return { s, feeds: ['CAM-08', 'CAM-33', 'CAM-14'] };
  },
  // walking the prisoner through the ship to the brig
  escort(d) {
    const s = prisonerScene(d, 'gallery-escort');
    runUntil(s, d, (x) => x.space.prisoners[0] && x.space.prisoners[0].state === 'escorted' && ['cross_main', 'gallery_p', 'fwd_main', 'corridor_aft'].includes(x.traveler.pos.room), 3600);
    const room = s.traveler.pos.room;
    const f = CAMERAS_BY_ROOM[room];
    return { s, feeds: [f || 'CAM-29', 'CAM-29', 'CAM-13'] };
  },
  // a prisoner in the brig, a meal through the hatch
  brig(d) {
    const s = prisonerScene(d, 'gallery-brig');
    runUntil(s, d, (x) => x.space.prisoners[0] && x.space.prisoners[0].state === 'held', 3600);
    s.space.missions.forEach((m) => { m.faction = 'elsewhere'; }); // keep them aboard
    runUntil(s, d, (x) => x.traveler.activity && x.traveler.activity.id === 'feed_prisoner' && x.traveler.activity.phase === 'perform', 86400);
    return { s, feeds: ['CAM-29'] };
  },
  passengers(d) {
    const s = createInitialState(d, { seed: 'gallery-pax' });
    const m = { id: 'gallery-pax', passengers: 3, to: { system: 'Halden 2210' } };
    boardPassengers(s, d, m, [0, 1, 2].map((i) => makePassenger(s.space.galaxySeed, m.id, i, 'Okafor Station', 'Halden 2210')));
    runUntil(s, d, (x) => x.t > 9.5 * 3600 && x.space.passengers.some((p) => p.pos.room === 'gallery_s' && !p.moving));
    return { s, feeds: ['CAM-23', 'CAM-28', 'CAM-25'] };
  },
  descent(d) {
    const s = createInitialState(d, { seed: 'gallery-descent' });
    runUntil(s, d, (x) => x.t > 3 * 3600);
    const f = findBody(s, d, (b) => b.landable && (b.atmosphere === 'thin' || b.atmosphere === 'thick'), 400);
    if (f) {
      moveTo(s, f.sys, f.b);
      startDescent(s, d);
      runUntil(s, d, (x) => x.ship.flight.phases && x.ship.flight.phases.list[x.ship.flight.phases.i].name === 'entry' && x.ship.flight.phases.t > 60, 3000);
    }
    return { s, feeds: ['CAM-08', 'CAM-01'] };
  },
  hyperspace(d) {
    const s = createInitialState(d, { seed: 'gallery-jump' });
    runUntil(s, d, (x) => x.t > 3 * 3600);
    s.space.surveyed = true;
    const r = plotRoute(s, d);
    if (r.kind === 'jump') { startJump(s, d, r); runUntil(s, d, (x) => x.ship.flight.mode === 'hyperspace' && x.ship.flight.timer < 25, 200); }
    return { s, feeds: ['CAM-14', 'CAM-08', 'CAM-07', 'CAM-01'] };
  },
  // idle life: privacy mosaic, clothes, pastimes
  toilet(d) { const s = createInitialState(d, { seed: 'gallery-wc' }); runUntil(s, d, (x) => x.traveler.activity?.id === 'use_toilet' && x.traveler.activity.phase === 'perform' && x.traveler.activity.elapsed > 20); return { s, feeds: ['CAM-03'] }; },
  shower(d) { const s = createInitialState(d, { seed: 'gallery-wash' }); runUntil(s, d, (x) => x.traveler.activity?.id === 'wash' && x.traveler.activity.phase === 'perform' && x.traveler.activity.elapsed > 20); return { s, feeds: ['CAM-03'] }; },
  dressed(d) { const s = createInitialState(d, { seed: 'gallery-dress' }); runUntil(s, d, (x) => x.traveler.history.lastDressDay >= 0 && x.t > 30 * 3600 && x.traveler.activity?.phase === 'perform' && !['sleep', 'use_toilet', 'wash'].includes(x.traveler.activity.id), 86400 * 4); return { s, feeds: [...ROOM_FEEDS] }; },
  tinker(d) { const s = createInitialState(d, { seed: 'gallery-tinker' }); runUntil(s, d, (x) => x.traveler.activity?.id === 'tinker' && x.traveler.activity.phase === 'perform', 86400 * 6); return { s, feeds: ['CAM-03', 'CAM-09'] }; },
  gaze(d) { const s = createInitialState(d, { seed: 'gallery-gaze' }); runUntil(s, d, (x) => x.traveler.activity?.id === 'gaze_viewport' && x.traveler.activity.phase === 'perform' && x.traveler.activity.elapsed > 30, 86400 * 4); return { s, feeds: ['CAM-01', 'CAM-02'] }; },
  night(d) {
    const s = createInitialState(d, { seed: 'gallery-night' });
    runUntil(s, d, (x) => x.traveler.activity && x.traveler.activity.id === 'sleep' && x.traveler.activity.elapsed > 3600 && x.t > 10 * 3600);
    return { s, feeds: ['CAM-03', 'CAM-10', 'CAM-05'] };
  },
  faults(d) {
    const s = createInitialState(d, { seed: 'gallery-faults' });
    runUntil(s, d, (x) => x.t > 5 * 3600);
    startFault(s, d, 'corridor_lights_aft', 'minor');
    startFault(s, d, 'junction_box_fore', 'minor');
    startFault(s, d, 'hydro_pump_1', 'minor');
    startFault(s, d, 'grow_lamps_b', 'minor');
    s.ship.thermal.heat = 0.92;
    s.ship.atmo.airWater = 5.2;
    return { s, feeds: ['CAM-11', 'CAM-10', 'CAM-05', 'CAM-07', 'CAM-06'] };
  },
  torpor(d) {
    const s = createInitialState(d, { seed: 'gallery-torpor' });
    runUntil(s, d, (x) => x.t > 10 * 3600);
    const target = neighbors(s.space.galaxySeed, s.space.pos, 200, d.space).find((c) => c.dist > 120 && d.space.starClasses[c.cls].scoopable);
    Object.assign(s.space, { surveyed: true, agenda: [], route: null, void: { ly: target.dist, years: target.dist / 38, star: target.id, name: 'gallery' } });
    runUntil(s, d, (x) => x.traveler.activity && x.traveler.activity.id === 'enter_torpor' && x.traveler.activity.phase === 'perform' && x.traveler.activity.elapsed > 600);
    return { s, feeds: ['CAM-03', 'CAM-08', 'CAM-05'] };
  },
};

