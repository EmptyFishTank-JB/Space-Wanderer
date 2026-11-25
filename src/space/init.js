// Space-side initial state (also used to upgrade Phase 1 snapshots).
import { hashString } from '../sim/rng.js';
import { nearestStar } from './galaxy.js';
import { getSystem } from './system.js';

export function initSpace(state, data) {
  const space = data.space;
  const galaxySeed = hashString(`galaxy|${state.seed}`);
  const start =
    nearestStar(galaxySeed, [0, 0, 0], space, (s) => s.cls === 'G' || s.cls === 'K') ||
    nearestStar(galaxySeed, [0, 0, 0], space, (s) => space.starClasses[s.cls].scoopable);
  const sys = getSystem(galaxySeed, start.id, space);
  state.space = {
    galaxySeed,
    pos: sys.pos.slice(),
    systemId: start.id,
    systemName: sys.name,
    starClass: sys.star.cls,
    arrivedT: state.t - 2 * 3600,
    surveyed: false,
    detected: [],
    scanned: {},
    visitedBodies: {},
    landedBodies: {},
    agenda: [],
    route: null,
    void: null,
    stranded: false,
    routeRetryT: 0,
    recent: [start.id],
    discoveries: [],
    classesSeen: { [sys.star.cls]: 1 },
    typesSeen: {},
    evaFirst: {},
    lifeConfirmed: {},
    awed: {},
    cargo: { ore: 0, ice: 0, bio: 0 },
    stats: { systems: 1, jumps: 0, ly: 0, landings: 0, evas: 0, scans: 0, torpors: 0, torporYears: 0, discoveries: {} },
  };
  const R = sys.star.radius;
  state.ship.flight = {
    mode: 'idle', pos: { x: Math.max(8 * R, 0.5), y: 0 }, v: 0, at: null, target: null, timer: 0,
    jump: null, scoop: null, phases: null, altitudeKm: 0, solarKW: 0.6, externalHeat: 0, entryHeat: 0,
    buffeting: 0, wellRatio: 0, starRadii: 8, targetDist: 0, lastDamageT: 0,
  };
  state.ship.hydroDormant = false;
  state.ship.ops.airlockCycling = false;
  state.traveler.keepsakes = state.traveler.keepsakes || [];
}
