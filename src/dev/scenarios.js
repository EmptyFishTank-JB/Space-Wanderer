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

