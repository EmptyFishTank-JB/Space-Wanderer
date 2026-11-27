// Flight model. The ship runs its own processes (jump charge, hyperspace,
// supercruise autopilot, scooping, descent, ascent); the traveler starts them
// from the helm. Modes:
//   idle       normal space, parked relative to the star
//   cruise     supercruise toward flight.target (autopilot)
//   orbit      orbital cruise around flight.at
//   scooping   skimming the star's corona
//   charging   frame-shift drive spooling up
//   hyperspace witchspace transit
//   descent    orbital → entry → glide/powered → touchdown
//   landed     on the surface of flight.at
//   ascent     liftoff → climb → orbit insertion
//   void       torpor crossing of a galactic rift (driven by the torpor action)
import { range } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { missionSeconds } from '../sim/clock.js';
import { emit } from '../sim/events.js';
import { stationIn, baseIn, startDocking, stepDocking, landedAtBase } from './ports.js';
import { factor } from '../sim/ship/wear.js';
import { getSystem, bodyPos, bodyRadius, LS_PER_AU, LS_PER_REARTH, KM_PER_LS } from './system.js';
import { onArrival } from './discovery.js';

export function currentSystem(state, data) {
  return getSystem(state.space.galaxySeed, state.space.systemId, data.space);
}

const len = (x, y) => Math.sqrt(x * x + y * y);

/** Ship position in the system plane (Ls). */
export function shipPos(state, data) {
  const f = state.ship.flight;
  if (f.at && ['orbit', 'descent', 'landed', 'ascent', 'docking', 'docked', 'undocking'].includes(f.mode)) {
    return bodyPos(currentSystem(state, data), f.at, missionSeconds(state));
  }
  return f.pos;
}

/** Distance from the star's center in Ls. */
export function starDistance(state, data) {
  const p = shipPos(state, data);
  return Math.max(1e-6, len(p.x, p.y));
}

/** Orbital-cruise standoff from a body's center (Ls). */
export function orbitArrive(sys, bodyId) {
  const R = bodyRadius(sys, bodyId);
  return R + Math.max(0.004, 0.3 * R);
}

// ───────────────────────── per-tick update ─────────────────────────
export function updateFlight(state, data, dt) {
  const f = state.ship.flight;
  switch (f.mode) {
    case 'cruise': stepCruise(state, data, dt); break;
    case 'charging':
      f.timer -= dt;
      if (f.timer <= 0) {
        f.mode = 'hyperspace';
        f.timer = range(state.rng, ...data.space.drive.hyperspaceSeconds);
        state.ship.fuel.tons = Math.max(0, state.ship.fuel.tons - f.jump.cost);
        emit(state, 'hyperspace_enter', { to: f.jump.name, ly: round(f.jump.dist, 2) });
      }
      break;
    case 'hyperspace':
      f.timer -= dt;
      if (f.timer <= 0) arriveSystem(state, data, f.jump.to, { ly: f.jump.dist, via: 'jump' });
      break;
    case 'scooping': stepScoop(state, data, dt); break;
    case 'descent': stepPhases(state, data, dt, 'descent'); break;
    case 'ascent': stepPhases(state, data, dt, 'ascent'); break;
    case 'docking': case 'undocking': stepDocking(state, data, dt); break;
    default: break;
  }
}

/** Slow-tick environment: stellar heat, solar power, heat damage, stranded trickle. */
export function updateFlightEnvironment(state, data, dt) {
  const f = state.ship.flight;
  const sp = state.space;
  if (f.mode === 'hyperspace') { f.externalHeat = 0.05; f.solarKW = 0; return; }
  if (f.mode === 'void') { f.externalHeat = 0; f.solarKW = 0.05; return; }
  const sys = currentSystem(state, data);
  const star = sys.star;
  const r = starDistance(state, data);
  const rr = star.radius / r; // R/r
  f.starRadii = r / star.radius;
  f.externalHeat = data.space.scoop.heatScale * star.heat * rr * rr + (f.entryHeat || 0);
  const au = r / LS_PER_AU;
  f.solarKW = clamp(0.05 + (9 * star.lum) / Math.max(au * au, 1e-4), 0.05, 14);

  // heat damage when the thermal loop is overwhelmed
  const heat = state.ship.thermal.heat;
  if (heat > 1.0) {
    const k = ((heat - 1.0) * 4 + 0.5) * (dt / 60);
    const C = state.ship.components;
    C.scoop_manifold.wear = clamp(C.scoop_manifold.wear + 0.03 * k);
    C.hull_plating.wear = clamp(C.hull_plating.wear + 0.02 * k);
    C.thermal_vents.wear = clamp(C.thermal_vents.wear + 0.012 * k);
    C.bridge_sensors.wear = clamp(C.bridge_sensors.wear + 0.01 * k);
    if (!f.lastDamageT || state.t - f.lastDamageT > 120) {
      f.lastDamageT = state.t;
      emit(state, 'heat_damage', { heat: round(heat, 2), room: 'engineering' });
    }
  }

  // Ship computer safety: idling in a stellar oven? Back off to a safe standoff.
  if (f.mode === 'idle' && f.externalHeat > 0.25 && heat > 0.75) {
    const safe = star.radius * data.space.scoop.safeRadii * 1.5;
    const k = safe / r;
    f.pos = { x: f.pos.x * Math.max(1, k), y: f.pos.y * Math.max(1, k) };
    emit(state, 'thermal_retreat', { radii: Math.round(safe / star.radius), room: 'bridge' });
  }

  // anti-soft-lock: stranded beside a star we cannot scoop
  if (sp.stranded && (f.mode === 'idle' || f.mode === 'orbit')) {
    state.ship.fuel.tons = Math.min(state.ship.fuel.capacity, state.ship.fuel.tons + (data.space.drive.strandedTrickleTph * dt) / 3600);
  }
}

// ───────────────────────── supercruise ─────────────────────────
function wellCap(sc, r, R, well) {
  const x = Math.max(0, r - R) / well;
  return sc.maxLsPerSec * Math.min(1, x) ** sc.wellExponent;
}

function stepCruise(state, data, dt) {
  const f = state.ship.flight;
  const sc = data.space.supercruise;
  const sys = currentSystem(state, data);
  const mt = missionSeconds(state);
  const tgt = f.target;
  const tp = bodyPos(sys, tgt.body, mt);
  // Supercruise is flown in the destination's reference frame: the ship is
  // carried along with the target's orbital motion, so fast inner worlds and
  // moons can be caught.
  if (tgt.last) f.pos = { x: f.pos.x + (tp.x - tgt.last.x), y: f.pos.y + (tp.y - tgt.last.y) };
  tgt.last = { x: tp.x, y: tp.y };
  const dx = tp.x - f.pos.x;
  const dy = tp.y - f.pos.y;
  const dc = len(dx, dy);
  const d = dc - tgt.arrive;

  // gravity wells: star, target, and the target's parent
  const rs = len(f.pos.x, f.pos.y);
  let cap = wellCap(sc, rs, sys.star.radius, sc.starWellLs * Math.sqrt(Math.max(sys.star.mass, 0.05)));
  if (tgt.body !== 'star') {
    const b = sys.byId[tgt.body];
    cap = Math.min(cap, wellCap(sc, dc, b.radius, sc.planetWellLs * Math.sqrt(b.mass)));
    if (b.parent !== 'star') {
      const pb = sys.byId[b.parent];
      const pp = bodyPos(sys, b.parent, mt);
      cap = Math.min(cap, wellCap(sc, len(pp.x - f.pos.x, pp.y - f.pos.y), pb.radius, sc.planetWellLs * Math.sqrt(pb.mass)));
    }
  }
  const vt = Math.max(sc.minLsPerSec, Math.min(cap, d / sc.approachSeconds));
  if (f.v < vt) f.v = Math.min(vt, f.v * (1 + sc.accelPerSec * dt) + sc.accelLinear * dt);
  else f.v = Math.max(vt, f.v * (1 - sc.decelPerSec * dt));
  f.wellRatio = f.v / sc.maxLsPerSec;
  f.targetDist = d;

  if (d <= 0.0008) {
    arriveAtTarget(state, data, sys, tgt);
    return;
  }
  // Steer around the star rather than through it.
  let ux = dx / dc;
  let uy = dy / dc;
  const R = sys.star.radius;
  if (tgt.body !== 'star' && rs < 60 * R) {
    const rx = f.pos.x / rs;
    const ry = f.pos.y / rs;
    const inward = -(ux * rx + uy * ry);
    const miss = Math.abs(f.pos.x * uy - f.pos.y * ux); // closest approach of the straight line
    if (inward > 0 && miss < 6 * R && dc > rs * 0.5) {
      let tx = -ry;
      let ty = rx;
      if (tx * ux + ty * uy < 0) { tx = -tx; ty = -ty; }
      const k = rs < 8 * R ? 0.35 : 0;
      ux = 0.2 * ux + 0.8 * tx + k * rx;
      uy = 0.2 * uy + 0.8 * ty + k * ry;
      const n = len(ux, uy);
      ux /= n;
      uy /= n;
    }
  }
  const step = Math.min(f.v * dt, d);
  f.pos = { x: f.pos.x + ux * step, y: f.pos.y + uy * step };
}

function arriveAtTarget(state, data, sys, tgt) {
  const f = state.ship.flight;
  f.v = 0;
  f.target = null;
  f.wellRatio = 0;
  if (tgt.body === 'star') {
    f.mode = tgt.then === 'scoop' && f.scoop ? 'scooping' : 'idle';
    if (f.mode === 'scooping') {
      f.scoop.r = tgt.arrive / sys.star.radius; // we are at the corona's edge now
      emit(state, 'scoop_start', { star: sys.star.cls, room: 'bridge' });
    }
    return;
  }
  f.mode = 'orbit';
  f.at = tgt.body;
  const b = sys.byId[tgt.body];
  if (tgt.then === 'dock') { const stn = stationIn(state.space.galaxySeed, state.space.systemId, data.space); if (stn && stn.body === tgt.body) { state.space.visitedBodies[tgt.body] = true; startDocking(state, data, stn); return; } }
  state.space.visitedBodies[tgt.body] = true;
  emit(state, 'orbit_entered', { body: b.name, bodyId: b.id, bodyType: b.type, rings: b.rings, altitudeKm: Math.round((orbitArrive(sys, b.id) - b.radius) * KM_PER_LS) });
}

/** Leave orbit / idle and fly to a body (or the star). */
export function setCourse(state, data, bodyId, then = null) {
  const f = state.ship.flight;
  const sys = currentSystem(state, data);
  const from = shipPos(state, data);
  const fromAt = f.at;
  let pos = { x: from.x, y: from.y };
  if (fromAt && f.mode === 'orbit') {
    // start from the orbital standoff, on the sunward side
    const r = len(from.x, from.y) || 1;
    const off = orbitArrive(sys, fromAt);
    pos = { x: from.x - (from.x / r) * off, y: from.y - (from.y / r) * off };
  }
  const arrive = bodyId === 'star' ? sys.star.radius * data.space.scoop.startRadii : orbitArrive(sys, bodyId);
  f.mode = 'cruise';
  f.at = null;
  f.pos = pos;
  f.v = Math.max(f.v || 0, data.space.supercruise.minLsPerSec);
  f.target = { body: bodyId, arrive, then };
  emit(state, 'supercruise_engage', { to: bodyId === 'star' ? sys.star.label : sys.byId[bodyId].name, bodyId });
}

// ───────────────────────── fuel scooping ─────────────────────────
export function startScoop(state, data) {
  const f = state.ship.flight;
  const sys = currentSystem(state, data);
  const sc = data.space.scoop;
  f.scoop = { r: Math.max(sc.startRadii, starDistance(state, data) / sys.star.radius), rTarget: sc.diveRadii, gained: 0, state: 'active', nextCheckT: state.t, peakHeat: 0 };
  if (f.scoop.r > sc.zoneRadii + 0.5 || f.mode === 'orbit') setCourse(state, data, 'star', 'scoop');
  else {
    f.mode = 'scooping';
    emit(state, 'scoop_start', { star: sys.star.cls, room: 'bridge' });
  }
}

export function endScoop(state, data, reason = 'full') {
  const f = state.ship.flight;
  if (!f.scoop) return;
  f.scoop.state = 'retreat';
  f.scoop.rTarget = data.space.scoop.safeRadii;
  f.scoop.reason = reason;
}

function stepScoop(state, data, dt) {
  const f = state.ship.flight;
  const s = f.scoop;
  const sc = data.space.scoop;
  const sys = currentSystem(state, data);
  const R = sys.star.radius;
  s.r += clamp(s.rTarget - s.r, -0.03 * dt, 0.06 * dt);
  f.pos = { x: s.r * R, y: 0 };
  if (s.r < sc.zoneRadii && s.state === 'active') {
    const rate = sc.maxRateTps * sys.star.rate * Math.min(1, (sc.minRadii / s.r) ** 2) * factor(state, data, 'scoop_manifold', 'scoopRate');
    const fuel = state.ship.fuel;
    const add = Math.min(rate * dt, fuel.capacity - fuel.tons);
    fuel.tons += add;
    s.gained += add;
  }
  s.peakHeat = Math.max(s.peakHeat, state.ship.thermal.heat);
  // Ship computer cut-outs: a full tank, a cooking hull, or an empty helm.
  if (s.state === 'active') {
    const a = state.traveler.activity;
    const fuel = state.ship.fuel;
    if (fuel.tons >= 0.98 * fuel.capacity) endScoop(state, data, 'full');
    else if (state.ship.thermal.heat > 1.1) endScoop(state, data, 'auto_overheat');
    else if (!a || a.id !== 'scoop_fuel') endScoop(state, data, 'unattended');
  }
  if (s.state === 'retreat' && s.r >= sc.safeRadii - 0.05) {
    f.mode = 'idle';
    emit(state, 'scoop_end', { tons: round(s.gained, 2), peakHeat: round(s.peakHeat, 2), reason: s.reason, room: 'bridge' });
    s.state = 'done';
  }
}

// ───────────────────────── descent / ascent ─────────────────────────
export function startDescent(state, data) {
  const f = state.ship.flight;
  const sys = currentSystem(state, data);
  const b = sys.byId[f.at];
  const d = data.space.descent;
  const atmo = b.atmosphere === 'thin' || b.atmosphere === 'thick';
  const orbitAlt = Math.round((orbitArrive(sys, b.id) - b.radius) * KM_PER_LS);
  const g = Math.sqrt(Math.max(0.2, b.gravity));
  const r = (span) => range(state.rng, span[0], span[1]);
  const phases = [{ name: 'orbital', dur: r(d.orbitalSeconds), alt0: orbitAlt, alt1: atmo ? 100 : 30 }];
  if (atmo) {
    phases.push({ name: 'entry', dur: r(d.entrySeconds) * (b.atmosphere === 'thick' ? 1.2 : 0.8), alt0: 100, alt1: 20, heat: b.atmosphere === 'thick' ? 0.45 : 0.25 });
    phases.push({ name: 'glide', dur: r(d.glideSeconds) * g, alt0: 20, alt1: 1.5 });
  } else {
    phases.push({ name: 'powered', dur: r(d.poweredSeconds) * g, alt0: 30, alt1: 1.5 });
  }
  phases.push({ name: 'touchdown', dur: r(d.touchdownSeconds), alt0: 1.5, alt1: 0 });
  f.mode = 'descent';
  f.phases = { kind: 'descent', list: phases, i: 0, t: 0, body: b.id };
  f.altitudeKm = orbitAlt;
  emit(state, 'descent_phase', { phase: 'orbital', body: b.name, atmosphere: b.atmosphere });
}

export function startAscent(state, data) {
  const f = state.ship.flight;
  const sys = currentSystem(state, data);
  const b = sys.byId[f.at];
  const atmo = b.atmosphere === 'thin' || b.atmosphere === 'thick';
  const orbitAlt = Math.round((orbitArrive(sys, b.id) - b.radius) * KM_PER_LS);
  const total = range(state.rng, ...data.space.descent.ascentSeconds);
  f.mode = 'ascent';
  f.phases = {
    kind: 'ascent', i: 0, t: 0, body: b.id,
    list: [
      { name: 'liftoff', dur: 60, alt0: 0, alt1: 2 },
      { name: 'climb', dur: total * 0.55, alt0: 2, alt1: atmo ? 100 : 30, heat: atmo ? 0.15 : 0 },
      { name: 'orbit_insertion', dur: total * 0.45, alt0: atmo ? 100 : 30, alt1: orbitAlt },
    ],
  };
  emit(state, 'liftoff', { body: b.name });
}

function stepPhases(state, data, dt, kind) {
  const f = state.ship.flight;
  const P = f.phases;
  const ph = P.list[P.i];
  P.t += dt;
  const u = clamp(P.t / ph.dur);
  // geometric altitude interpolation reads naturally on approach
  const a0 = Math.max(ph.alt0, 0.01);
  const a1 = Math.max(ph.alt1, 0.01);
  f.altitudeKm = ph.alt1 === 0 && u >= 1 ? 0 : a0 * (a1 / a0) ** u;
  f.entryHeat = ph.heat ? ph.heat * Math.sin(Math.PI * u) : 0;
  f.buffeting = ph.name === 'entry' || ph.name === 'climb' ? Math.sin(Math.PI * u) : ph.name === 'touchdown' ? 0.3 * u : 0;
  if (P.t < ph.dur) return;
  P.i++;
  P.t = 0;
  const sys = currentSystem(state, data);
  const b = sys.byId[P.body];
  if (P.i < P.list.length) {
    emit(state, kind === 'descent' ? 'descent_phase' : 'ascent_phase', { phase: P.list[P.i].name, body: b.name });
    return;
  }
  f.entryHeat = 0;
  f.buffeting = 0;
  f.phases = null;
  if (kind === 'descent') {
    f.mode = 'landed';
    f.altitudeKm = 0;
    const first = !state.space.landedBodies[b.id];
    state.space.landedBodies[b.id] = true;
    state.space.stats.landings++;
    f.touchdownT = state.t; // for the linger before lifting off again
    emit(state, 'touchdown', { body: b.name, bodyId: b.id, bodyType: b.type, gravity: round(b.gravity, 2), tempK: b.tempK, first });
    if (f.portLanding) { const base = baseIn(state.space.galaxySeed, state.space.systemId, data.space); f.portLanding = null; if (base && base.body === b.id) landedAtBase(state, data, base); }
  } else {
    f.mode = 'orbit';
    emit(state, 'orbit_entered', { body: b.name, bodyId: b.id, bodyType: b.type, fromSurface: true });
  }
}

// ───────────────────────── hyperspace ─────────────────────────
export function startJump(state, data, route) {
  const f = state.ship.flight;
  if (f.at && f.mode === 'orbit') {
    const p = shipPos(state, data);
    f.pos = { x: p.x, y: p.y };
  }
  f.at = null;
  f.target = null;
  f.mode = 'charging';
  f.timer = data.space.drive.chargeSeconds;
  f.jump = { to: route.star, name: route.name, dist: route.dist, cost: route.cost };
  emit(state, 'hyperspace_charge', { to: route.name, ly: round(route.dist, 2), fuel: round(route.cost, 2), room: 'bridge' });
}

/** Emerge in a new system near its primary star. */
export function arriveSystem(state, data, starId, { ly = 0, via = 'jump' } = {}) {
  const sp = state.space;
  const f = state.ship.flight;
  if (sp.systemId) emit(state, 'system_record', { record: systemRecord(state, data) });
  sp.systemId = starId;
  const sys = currentSystem(state, data);
  sp.pos = sys.pos.slice();
  sp.systemName = sys.name;
  sp.starClass = sys.star.cls;
  sp.arrivedT = state.t;
  sp.surveyed = false;
  sp.scanned = {};
  sp.visitedBodies = {};
  sp.landedBodies = {};
  sp.agenda = [];
  sp.route = null;
  sp.stranded = false;
  sp.discoveries = [];
  sp.awed = {};
  sp.recent.push(starId);
  if (sp.recent.length > 200) sp.recent.shift();
  sp.stats.systems++;
  if (via === 'jump') { sp.stats.jumps++; sp.stats.ly += ly; }
  const R = sys.star.radius;
  const emergeR = Math.max(6 * R, 0.5);
  const ang = range(state.rng, 0, Math.PI * 2);
  f.mode = 'idle';
  f.at = null;
  f.target = null;
  f.jump = null;
  f.v = 0;
  f.pos = { x: emergeR * Math.cos(ang), y: emergeR * Math.sin(ang) };
  emit(state, 'hyperspace_exit', { system: sys.name, star: sys.star.cls, color: sys.star.color, via });
  onArrival(state, data, sys, { ly, via });
}

/** Persistent record of the system just left (goes to IndexedDB `systems`). */
export function systemRecord(state, data) {
  const sp = state.space;
  const sys = currentSystem(state, data);
  return {
    id: sys.id, name: sys.name, coords: sys.pos.map((v) => round(v, 1)), star: sys.star.cls, label: sys.star.label,
    bodies: sys.bodies.length, arrivedT: sp.arrivedT, departedT: state.t,
    surveyed: sp.surveyed, visited: Object.keys(sp.visitedBodies), landed: Object.keys(sp.landedBodies), discoveries: sp.discoveries,
  };
}

function round(x, n) { return Math.round(x * 10 ** n) / 10 ** n; }
export { LS_PER_REARTH };
