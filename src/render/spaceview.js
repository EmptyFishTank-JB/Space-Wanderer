// What the ship can see, at true scale. Converts the sim's light-second
// geometry into camera space: bearings and angular radii. A world 1000 Ls
// away is a pinpoint; in orbital cruise it fills the glass.
import { missionSeconds } from '../sim/clock.js';
import { currentSystem, shipPos, orbitArrive } from '../space/flight.js';
import { bodyPos, KM_PER_LS } from '../space/system.js';
import { starById } from '../space/galaxy.js';
import { hash, strHash } from './gfx.js';
import { skyFor } from './sky.js';
import { LS_PER_AU, LS_PER_RSUN } from '../space/system.js';

const len = (x, y) => Math.sqrt(x * x + y * y);
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** Ship's actual position for viewing (orbit standoff is off-axis so terminators show). */
function viewerPos(state, data, sys, mt) {
  const f = state.ship.flight;
  if (f.at && ['orbit', 'descent', 'landed', 'ascent'].includes(f.mode)) {
    const c = bodyPos(sys, f.at, mt);
    const r = len(c.x, c.y) || 1;
    const ux = -c.x / r, uy = -c.y / r; // toward the star
    const ang = 1.05; // standing a little off the sunward line
    const dx = ux * Math.cos(ang) - uy * Math.sin(ang);
    const dy = ux * Math.sin(ang) + uy * Math.cos(ang);
    let stand = orbitArrive(sys, f.at);
    if (f.mode !== 'orbit' && f.altitudeKm !== undefined) stand = sys.byId[f.at].radius + Math.max(0.0001, f.altitudeKm / KM_PER_LS);
    return { x: c.x + dx * stand, y: c.y + dy * stand };
  }
  return shipPos(state, data);
}

import { stationIn, portHere } from '../space/ports.js';

export function spaceView(state, data) {
  const f = state.ship.flight;
  const sp = state.space;
  const sys = currentSystem(state, data);
  const mt = missionSeconds(state);
  const view = { mode: f.mode, scene: 'space', sys, star: sys.star, objects: [], heading: 0, speed: 0, seed: strHash(sys.id) };

  if (f.mode === 'void') { view.scene = 'void'; return view; }
  if (f.mode === 'hyperspace') {
    view.scene = 'hyperspace';
    const dest = f.jump ? starById(sp.galaxySeed, f.jump.to, data.space) : null;
    view.tunnelColor = dest ? data.space.starClasses[dest.cls].color : '#cfe0ff';
    view.timer = f.timer;
    return view;
  }
  const at = f.at ? sys.byId[f.at] : null;
  if (at && (f.mode === 'landed' || ((f.mode === 'descent' || f.mode === 'ascent') && f.phases && ['entry', 'glide', 'powered', 'touchdown', 'liftoff', 'climb'].includes(f.phases.list[f.phases.i].name)))) {
    view.scene = 'surface';
    view.body = at;
    view.altitudeKm = f.mode === 'landed' ? 0 : f.altitudeKm;
    view.phase = f.phases ? f.phases.list[f.phases.i].name : 'landed';
    view.entryHeat = f.entryHeat || 0;
    view.buffeting = f.buffeting || 0;
    const port = f.port && sp ? portHere(state, data) : null;
    if (port && port.kind === 'base') view.base = port;
  }

  const p = viewerPos(state, data, sys, mt);
  // where the ship is looking
  let heading;
  if (at) {
    const c = bodyPos(sys, at.id, mt);
    heading = Math.atan2(c.y - p.y, c.x - p.x);
  } else if (f.mode === 'cruise' && f.target) {
    const c = bodyPos(sys, f.target.body, mt);
    heading = Math.atan2(c.y - p.y, c.x - p.x);
    view.speed = f.wellRatio || 0;
  } else if (f.mode === 'scooping') {
    heading = Math.atan2(-p.y, -p.x);
  } else {
    heading = Math.atan2(-p.y, -p.x) + 0.3; // parked: the star hangs off to one side
  }
  view.heading = heading;
  view.charging = f.mode === 'charging' ? 1 - f.timer / data.space.drive.chargeSeconds : 0;

  // the star
  const rs = len(p.x, p.y) || 1e-6;
  const starAng = Math.asin(Math.min(1, sys.star.radius / rs));
  view.objects.push({ kind: 'star', id: 'star', bearing: wrap(Math.atan2(-p.y, -p.x) - heading), elev: 0.04, angR: starAng, dist: rs, color: sys.star.color, star: sys.star });
  // a binary companion, far out: a bright point (or small disc) of its own color
  const comp = sys.star.companion;
  if (comp) {
    const def = data.space.starClasses[comp.cls];
    const cx = Math.cos(comp.angle) * comp.sepAU * LS_PER_AU, cy = Math.sin(comp.angle) * comp.sepAU * LS_PER_AU;
    const dx = cx - p.x, dy = cy - p.y;
    const dc = len(dx, dy) || 1;
    const rad = Math.sqrt(def.radius[0] * def.radius[1]) * LS_PER_RSUN;
    const lum = Math.sqrt(Math.max(def.lum[0], 1e-6) * def.lum[1]);
    view.objects.push({ kind: 'star', id: 'companion', bearing: wrap(Math.atan2(dy, dx) - heading), elev: 0.09, angR: Math.asin(Math.min(1, rad / dc)), dist: dc, color: def.color,
      star: { cls: comp.cls, color: def.color, lum, label: `${def.label} companion`, radius: rad } });
  }
  view.sky = skyFor(sp.galaxySeed, sys, data.space);

  // bodies (the one we orbit sits low, its limb a horizon)
  for (const b of sys.bodies) {
    if (b.kind === 'belt') continue;
    const c = bodyPos(sys, b.id, mt);
    const dx = c.x - p.x, dy = c.y - p.y;
    const d = Math.max(len(dx, dy), b.radius * 1.0001);
    const angR = Math.asin(Math.min(1, b.radius / d));
    if (angR < 0.0006 && b.id !== (f.target && f.target.body)) continue; // below a pixel and not our destination
    const bearing = wrap(Math.atan2(dy, dx) - heading);
    let elev = (hash(strHash(b.id), 3) - 0.5) * 0.18;
    if (at && b.id === at.id) elev = -Math.min(1.2, angR * 0.78);
    if (f.mode === 'cruise' && f.target && b.id === f.target.body) elev = -0.02;
    // light direction from the body toward the star, in camera terms
    const lx = -c.x, ly = -c.y;
    const ll = len(lx, ly) || 1;
    const fwdx = dx / d, fwdy = dy / d;
    const rightx = -fwdy, righty = fwdx;
    const light = [(lx * rightx + ly * righty) / ll, 0.12, -(lx * fwdx + ly * fwdy) / ll];
    view.objects.push({ kind: 'body', id: b.id, bearing, elev, angR, dist: d, body: b, light, at: at && b.id === at.id });
  }
  // the station, if this system has one: a speck near its world, growing as we come in to dock
  const stn = sp && stationIn(sp.galaxySeed, sp.systemId, data.space);
  if (stn) {
    const host = sys.byId[stn.body];
    const c = bodyPos(sys, stn.body, mt);
    const dx = c.x - p.x, dy = c.y - p.y, d = Math.max(len(dx, dy), 1e-6);
    let bearing = wrap(Math.atan2(dy, dx) - heading) + 0.12, elev = 0.05, angR = Math.max(0.0035, 0.0004 / (d / host.radius + 0.1));
    if (f.mode === 'docking' && f.phases) {
      const ph = f.phases.list[f.phases.i], u = Math.min(1, f.phases.t / ph.dur);
      if (ph.name === 'request') { angR = 0.03; bearing = 0.05; elev = 0.03; }
      if (ph.name === 'approach') { angR = 0.03 + 0.45 * u * u; bearing = 0.05 * (1 - u); elev = 0.03 * (1 - u); }
      if (ph.name === 'slot') { angR = 0.48 + 0.9 * u; bearing = 0; elev = 0; }
      if (ph.name === 'pad') view.scene = 'docked';
    }
    if (f.mode === 'docked') view.scene = 'docked';
    if (f.mode === 'undocking' && f.phases) {
      const ph = f.phases.list[f.phases.i], u = Math.min(1, f.phases.t / ph.dur);
      if (ph.name === 'lift') view.scene = 'docked';
      if (ph.name === 'slot') { angR = 1.2 - 0.8 * u; bearing = Math.PI; }
      if (ph.name === 'clear') { angR = 0.4 * (1 - u) + 0.02; bearing = Math.PI - 0.2; }
    }
    view.objects.push({ kind: 'station', id: stn.id, bearing, elev, angR, dist: ['docking', 'docked', 'undocking'].includes(f.mode) ? 0.001 : d, station: stn, seed: strHash(stn.id) });
    view.station = stn;
  }
  view.objects.sort((a, b) => b.dist - a.dist); // far first
  view.glare = Math.min(1, starAng * 6 + (f.mode === 'scooping' ? 0.6 : 0));
  return view;
}
