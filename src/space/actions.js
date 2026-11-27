// Flight and exploration actions for the traveler's utility AI. These start
// ship processes (see flight.js) from the helm, scanner or airlock; the ship
// carries them through even if the traveler is called away.
import { clamp, smooth, inWindow, HOUR } from '../sim/util.js';
import { range, chance } from '../sim/rng.js';
import { shipHour } from '../sim/clock.js';
import { emit } from '../sim/events.js';
import { factor } from '../sim/ship/wear.js';
import { currentSystem, setCourse, startScoop, endScoop, startDescent, startAscent, startJump } from './flight.js';
import { surveySystem, scanBody } from './discovery.js';
import { decideAgenda, plotRoute, agendaHead } from './navigator.js';
import { planEva, tickEva } from './eva.js';
import { planRover, tickRover, roverCanDrive } from './rover.js';
import { stationIn, startUndocking, tradeAtPort, chooseMissions, factionName, portHere } from './ports.js';
import { atTheBar, peopleAt, converse } from './people.js';
import { beginTorpor, endTorpor } from './torpor.js';

const at = (room, station) => ({ room, station });
const one = (score, loc, params = {}, extra = {}) => [{ score, locs: [loc], params, ...extra }];
const PARKED = new Set(['idle', 'orbit']);
const r2 = (x) => Math.round(x * 100) / 100;

/** Eagerness to move on: low right after arriving, grows over the hours. */
function wanderlust(s, d) {
  const h = (s.t - s.space.arrivedT) / HOUR;
  return smooth(h, 2, 7) * (0.75 + 0.4 * d.traveler.traits.curiosity) * (1 - 0.3 * s.traveler.mood.weariness);
}

function alert(s) {
  const n = s.traveler.needs;
  return n.fatigue < 0.85 && n.hunger < 0.85 && n.thirst < 0.85;
}

function majorAlarmFault(s, d) {
  return d.componentIds.some((id) => {
    const c = s.ship.components[id];
    return c.fault && c.known && c.fault.severity === 'major' && d.components[id].alarm;
  });
}

function visitHead(s) {
  const it = agendaHead(s);
  return it && it.kind === 'visit' ? it : null;
}

export const FLIGHT_ACTIONS = {
  survey_system: {
    category: 'flight', exertion: 0.5, posture: 'sitting', minCommit: 900,
    gen(s, d) {
      const f = s.ship.flight;
      if (s.space.surveyed || !PARKED.has(f.mode) || !alert(s)) return [];
      return one(0.5 * (0.6 + 0.5 * d.traveler.traits.curiosity), at('bridge', 'scanner'));
    },
    duration: (s, d) => range(s.rng, 900, 2400) / Math.max(0.4, factor(s, d, 'bridge_sensors', 'sensorQuality')),
    complete(s, d) {
      const sys = currentSystem(s, d);
      surveySystem(s, d, sys);
      s.space.agenda = decideAgenda(s, d, sys);
      emit(s, 'agenda', { system: sys.name, items: s.space.agenda.map((i) => (i.kind === 'visit' ? `${i.land ? 'land' : 'visit'}:${sys.byId[i.body].name}` : i.kind === 'port' ? `port:${i.why}` : i.kind)) });
    },
  },

  plot_route: {
    category: 'flight', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      const sp = s.space;
      if (!sp.surveyed || sp.agenda.length || sp.route || sp.void || !alert(s)) return [];
      if (sp.routeRetryT && s.t < sp.routeRetryT) return [];
      return one(0.42 * wanderlust(s, d), at('bridge', 'nav'));
    },
    duration: (s) => range(s.rng, 600, 1200),
    complete(s, d) {
      const sp = s.space;
      s.traveler.history.lastNavT = s.t;
      const r = plotRoute(s, d);
      if (r.kind === 'jump') {
        sp.route = r;
        sp.stranded = false;
        emit(s, 'route_plotted', { to: r.name, star: r.cls, ly: r2(r.dist), fuel: r2(r.cost), room: 'bridge' });
      } else if (r.kind === 'void') {
        sp.void = r;
        emit(s, 'void_ahead', { ly: Math.round(r.ly), years: Math.round(r.years * 10) / 10, to: r.name, room: 'bridge' });
      } else {
        sp.stranded = true;
        sp.routeRetryT = s.t + 6 * HOUR;
        emit(s, 'stranded', { reason: r.reason, fuel: r2(s.ship.fuel.tons), room: 'bridge' });
      }
    },
  },

  jump: {
    category: 'flight', exertion: 0.6, posture: 'sitting', minCommit: 300,
    gen(s, d) {
      const sp = s.space;
      const f = s.ship.flight;
      if (!sp.route || !PARKED.has(f.mode) || !alert(s) || s.traveler.needs.fatigue > 0.8) return [];
      if (s.ship.fuel.tons < sp.route.cost || factor(s, d, 'drive_coil', 'jumpRange') === 0) return [];
      if (s.ship.thermal.heat > 0.7 || majorAlarmFault(s, d)) return [];
      return one(0.46 * Math.max(0.6, wanderlust(s, d)), at('bridge', 'helm'));
    },
    start(s, d, a) { a.params.from = s.space.systemId; a.params.preflightT = s.t + range(s.rng, 90, 200); a.params.started = false; },
    duration: () => -1,
    tick(s, d, a) {
      if (a.params.started || s.t < a.params.preflightT) return;
      const route = s.space.route;
      if (!route || s.ship.fuel.tons < route.cost) { a.params.aborted = true; return; }
      a.params.started = true;
      s.space.route = null;
      startJump(s, d, route);
    },
    done(s, d, a) {
      if (a.params.aborted) return true;
      return a.params.started && s.space.systemId !== a.params.from && s.ship.flight.mode === 'idle';
    },
  },

  scoop_fuel: {
    category: 'flight', exertion: 0.7, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      const f = s.ship.flight;
      if (!PARKED.has(f.mode) || !alert(s) || !s.space.surveyed) return [];
      const sys = currentSystem(s, d);
      if (!sys.star.scoopable || factor(s, d, 'scoop_manifold', 'scoopRate') === 0) return [];
      const fuel = s.ship.fuel;
      const frac = fuel.tons / fuel.capacity;
      const head = agendaHead(s);
      if (!(head && head.kind === 'scoop') && frac > 0.3) return [];
      if (frac > 0.97 || s.ship.thermal.heat > 0.55) return [];
      return one(0.48 + 0.4 * smooth(1 - frac, 0.5, 0.9), at('bridge', 'helm'));
    },
    start(s, d) { startScoop(s, d); },
    duration: () => -1,
    tick(s, d, a) {
      const f = s.ship.flight;
      const sc = f.scoop;
      if (!sc || f.mode !== 'scooping' || sc.state !== 'active') return;
      const tr = s.traveler;
      const heat = s.ship.thermal.heat;
      const fuel = s.ship.fuel;
      if (fuel.tons >= 0.98 * fuel.capacity) { endScoop(s, d, 'full'); return; }
      if (a.elapsed > 50 * 60) { endScoop(s, d, 'time'); return; }
      if (heat > 1.08) {
        endScoop(s, d, 'overheat');
        tr.needs.stress = clamp(tr.needs.stress + 0.1);
        emit(s, 'scoop_abort', { heat: r2(heat), room: 'bridge' });
        return;
      }
      if (s.t < sc.nextCheckT) return;
      // reaction lag grows with fatigue: tired pilots overshoot
      sc.nextCheckT = s.t + 20 + 60 * tr.needs.fatigue;
      const ceiling = 0.8 + 0.05 * d.traveler.traits.curiosity - 0.08 * Math.max(0, tr.needs.stress - 0.4);
      if (heat > ceiling) {
        sc.rTarget += 0.2;
        if (heat > 0.9) emit(s, 'heat_warning', { heat: r2(heat), room: 'bridge' });
      } else if (heat < ceiling - 0.1) {
        sc.rTarget = Math.max(d.space.scoop.minRadii, sc.rTarget - 0.1);
      }
      if (chance(s.rng, 0.01 + 0.08 * Math.max(0, tr.needs.fatigue - 0.5))) {
        sc.rTarget = Math.max(d.space.scoop.minRadii, sc.rTarget - 0.55);
        // ...and a lapse of attention before the next correction: longer when tired
        sc.nextCheckT = s.t + 90 + 300 * tr.needs.fatigue;
        emit(s, 'scoop_misjudge', { radii: r2(sc.rTarget), room: 'bridge' });
      }
    },
    done(s) {
      const f = s.ship.flight;
      return !f.scoop || f.scoop.state === 'done' || !['cruise', 'scooping'].includes(f.mode);
    },
    complete(s) {
      const head = agendaHead(s);
      if (head && head.kind === 'scoop') head.done = true;
    },
    interrupt(s) {
      const head = agendaHead(s);
      if (head && head.kind === 'scoop') head.done = true;
    },
  },

  // under attack: get to the helm and fight (or run)
  fight: {
    category: 'critical', exertion: 0.9, posture: 'sitting', minCommit: 30, uninterruptible: true,
    gen(s) { return s.space && s.space.combat ? one(0.99, at('bridge', 'helm')) : []; },
    duration: () => -1,
    done: (s) => !s.space.combat,
  },

  // put in at the port: fly to its world, then dock at the station or land at the settlement's pad
  dock: {
    category: 'flight', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      const f = s.ship.flight;
      const it = agendaHead(s);
      if (!it || it.kind !== 'port' || !PARKED.has(f.mode) || !alert(s) || majorAlarmFault(s, d)) return [];
      return one(0.5, at('bridge', 'helm'), { body: it.body, base: !!it.base, port: it.station });
    },
    start(s, d, a) {
      const f = s.ship.flight;
      if (a.params.base) {
        if (f.at === a.params.body && f.mode === 'orbit') { f.portLanding = a.params.port; startDescent(s, d); }
        else setCourse(s, d, a.params.body);
        return;
      }
      const stn = stationIn(s.space.galaxySeed, s.space.systemId, d.space);
      if (!stn) { a.params.aborted = true; return; }
      setCourse(s, d, stn.body, 'dock');
    },
    tick(s, d, a) {
      // a settlement: once in orbit round its world, come down to its pad
      const f = s.ship.flight;
      if (a.params.base && f.mode === 'orbit' && f.at === a.params.body && !f.portLanding) { f.portLanding = a.params.port; startDescent(s, d); }
    },
    duration: () => -1,
    done: (s, d, a) => a.params.aborted || s.ship.flight.mode === 'docked' || (s.ship.flight.mode === 'landed' && !!s.ship.flight.port)
      || !['cruise', 'docking', 'orbit', 'descent'].includes(s.ship.flight.mode) || (s.ship.flight.mode === 'orbit' && a.elapsed > 900 && !a.params.base),
  },

  // ashore on the station: the concourse, the bar, the market and the mission board
  go_ashore: {
    category: 'social', exertion: 0.6, posture: 'standing', minCommit: 1800, uninterruptible: true,
    gen(s, d) {
      const f = s.ship.flight;
      const it = agendaHead(s);
      if (!(f.mode === 'docked' || (f.mode === 'landed' && f.port)) || !it || it.kind !== 'port' || it.done.ashore) return [];
      const n = s.traveler.needs;
      if (n.fatigue > 0.8) return [];
      return one(0.55 + 0.3 * n.solitude + 0.2 * d.traveler.traits.sociability, at('airlock', 'inner_door'));
    },
    start(s, d, a) {
      const P = d.space.ports;
      const total = range(s.rng, P.ashoreMinutes[0], P.ashoreMinutes[1]) * 60;
      const stops = [['gate', 0.06], ['market', 0.16], ['bar', 0.42], ['board', 0.14], ['viewdeck', 0.14], ['gate', 0.08]];
      a.params.plan = { stops: stops.map(([at2, w]) => ({ at: at2, dur: w * total })), i: 0, t: 0, x: d.rooms.port.stations.gate };
      const stn = portHere(s, d);
      a.params.station = stn ? stn.name : 'the station';
      s.traveler.pos = { room: 'port', x: a.params.plan.x };
      emit(s, 'room_enter', { room: 'port', from: 'airlock', hatch: 'boarding_tube' });
    },
    duration: () => -1,
    fastTick(s, d, a, dt) {
      const p = a.params.plan;
      const stop = p.stops[p.i];
      if (!stop) return;
      const goal = d.rooms.port.stations[stop.at];
      // walk between the venues at an easy pace, then linger
      const v = 1.1;
      if (Math.abs(goal - p.x) > 0.2) p.x += Math.sign(goal - p.x) * Math.min(v * dt, Math.abs(goal - p.x));
      else p.t += dt;
      s.traveler.pos = { room: 'port', x: p.x };
      const tr = s.traveler;
      if (stop.at === 'bar') {
        // company costs nothing; a meal and a drink cost a little
        tr.needs.solitude = clamp(tr.needs.solitude - dt / 2400);
        tr.needs.stress = clamp(tr.needs.stress - dt / 7200);
        if (!p.paid && s.space.credits >= d.space.ports.price.barMeal) { s.space.credits -= d.space.ports.price.barMeal; p.paid = true; }
        if (p.paid) { tr.needs.hunger = clamp(tr.needs.hunger - dt / 1800); tr.needs.thirst = clamp(tr.needs.thirst - dt / 1200); }
      }
      else tr.needs.solitude = clamp(tr.needs.solitude - dt / 9000);
      if (p.t < stop.dur) return;
      // what happens at each stop
      if (stop.at === 'market') tradeAtPort(s, d);
      const stn = portHere(s, d);
      if (stop.at === 'bar' && stn) {
        // the bartender, and whoever is in tonight; the sociable talk to more of them
        const here = atTheBar(s.space.galaxySeed, stn, Math.floor(s.t / 86400));
        const talk = here.slice(0, 1 + Math.round(d.traveler.traits.sociability * 2));
        for (const p of talk) converse(s, p, stn.name);
        emit(s, 'port_visit', { station: a.params.station, venue: 'bar', met: talk.length, names: talk.map((p) => p.name), room: 'port' });
      }
      if (stop.at === 'board') {
        if (stn) { const clerk = peopleAt(s.space.galaxySeed, stn).find((p) => p.role === 'clerk'); if (clerk) converse(s, clerk, stn.name); }
        chooseMissions(s, d);
      }
      p.i++; p.t = 0;
    },
    done: (s, d, a) => a.params.plan.i >= a.params.plan.stops.length,
    complete(s, d, a) {
      s.traveler.pos = { room: 'airlock', x: d.rooms.airlock.stations.inner_door };
      emit(s, 'room_enter', { room: 'airlock', from: 'port', hatch: 'boarding_tube' });
      const it = agendaHead(s);
      if (it && it.kind === 'port') it.done.ashore = true;
    },
  },

  undock: {
    category: 'flight', exertion: 0.5, posture: 'sitting', minCommit: 300,
    gen(s, d) {
      const f = s.ship.flight;
      if (!(f.mode === 'docked' || (f.mode === 'landed' && f.port)) || !alert(s)) return [];
      const it = agendaHead(s);
      if (it && it.kind === 'port' && !it.done.ashore) return [];
      return one(0.46, at('bridge', 'helm'));
    },
    start(s, d) {
      const f = s.ship.flight;
      if (f.mode === 'landed') { f.port = null; startAscent(s, d); emit(s, 'undocked', { station: '', room: 'bridge' }); }
      else startUndocking(s, d);
    },
    duration: () => -1,
    done: (s) => !['undocking', 'docked', 'ascent', 'landed'].includes(s.ship.flight.mode),
  },

  set_course: {
    category: 'flight', exertion: 0.5, posture: 'sitting', minCommit: 120,
    gen(s, d) {
      const f = s.ship.flight;
      const it = visitHead(s);
      if (!it || !PARKED.has(f.mode) || f.at === it.body || !alert(s)) return [];
      return one(0.45, at('bridge', 'helm'), { body: it.body });
    },
    duration: (s) => range(s.rng, 120, 300),
    complete(s, d, a) {
      const f = s.ship.flight;
      if (PARKED.has(f.mode) && f.at !== a.params.body) setCourse(s, d, a.params.body);
    },
  },

  scan_body: {
    category: 'flight', exertion: 0.5, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      const f = s.ship.flight;
      const it = visitHead(s);
      if (!it || f.at !== it.body || !['orbit', 'landed'].includes(f.mode) || s.space.scanned[it.body]) return [];
      return one(0.46 * (0.8 + 0.3 * d.traveler.traits.curiosity), at('bridge', 'scanner'), { body: it.body });
    },
    duration: (s, d) => range(s.rng, 900, 2100) / Math.max(0.4, factor(s, d, 'bridge_sensors', 'sensorQuality')),
    complete(s, d, a) {
      const sys = currentSystem(s, d);
      scanBody(s, d, sys, sys.byId[a.params.body]);
    },
  },

  land: {
    category: 'flight', exertion: 0.8, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      const f = s.ship.flight;
      const it = visitHead(s);
      if (!it || !it.land || it.done.landed || f.mode !== 'orbit' || f.at !== it.body || !s.space.scanned[it.body]) return [];
      if (s.traveler.needs.fatigue > 0.7 || !inWindow(shipHour(s), 6.5, 17.5) || majorAlarmFault(s, d)) return [];
      return one(0.45 + 0.1 * d.traveler.traits.curiosity, at('bridge', 'helm'), { body: it.body });
    },
    start(s, d) { startDescent(s, d); },
    duration: () => -1,
    done: (s) => s.ship.flight.mode !== 'descent',
  },

  eva: {
    category: 'eva', exertion: 1.5, posture: 'suited', minCommit: 3600, uninterruptible: true,
    gen(s, d) {
      const f = s.ship.flight;
      const it = visitHead(s);
      if (f.mode !== 'landed' || !it || it.body !== f.at || it.done.evas >= it.eva) return [];
      const n = s.traveler.needs;
      if (n.fatigue > 0.65 || n.hunger > 0.65 || n.thirst > 0.6 || !inWindow(shipHour(s), 7, 19)) return [];
      if (s.ship.components.airlock_seals.fault && s.ship.components.airlock_seals.fault.severity === 'major') return [];
      if (majorAlarmFault(s, d)) return [];
      const b = currentSystem(s, d).byId[f.at];
      return one(0.5 + (b.signals.bio || b.signals.anomaly ? 0.15 : 0), at('airlock', 'suit_rack'), { body: f.at });
    },
    start(s, d, a) {
      const sys = currentSystem(s, d);
      a.params.plan = planEva(s, d, sys, sys.byId[a.params.body]);
      emit(s, 'eva_phase', { phase: 'suit_up', body: sys.byId[a.params.body].name });
    },
    duration: () => -1,
    fastTick(s, d, a, dt) {
      const plan = a.params.plan;
      if (plan.i < plan.phases.length) tickEva(s, d, a, currentSystem(s, d), dt);
    },
    done: (s, d, a) => a.params.plan.i >= a.params.plan.phases.length,
    complete(s, d, a) {
      const plan = a.params.plan;
      s.ship.ops.airlockCycling = false;
      s.traveler.pos = { room: 'airlock', x: d.rooms.airlock.stations.suit_rack };
      s.space.stats.evas++;
      const it = visitHead(s);
      if (it && it.body === plan.body) it.done.evas++;
      s.traveler.needs.hygiene = clamp(s.traveler.needs.hygiene + 0.25);
      s.ship.clutter.airlock = clamp(s.ship.clutter.airlock + 0.15);
      const sys = currentSystem(s, d);
      emit(s, 'eva_end', { body: sys.byId[plan.body].name, walkedM: plan.maxX * 2, features: plan.features.filter((f) => f.visited).map((f) => f.kind), samples: plan.samples, room: 'airlock' });
    },
  },

  // a long drive out in the rover to sites a walk can't reach, after the first walk round the ship
  rover_outing: {
    category: 'eva', exertion: 1.2, posture: 'suited', minCommit: 3600, uninterruptible: true,
    gen(s, d) {
      const f = s.ship.flight;
      const it = visitHead(s);
      if (f.mode !== 'landed' || !it || it.body !== f.at || !it.rover || (it.done.rovers || 0) >= it.rover || it.done.evas < 1) return [];
      const n = s.traveler.needs;
      if (n.fatigue > 0.55 || n.hunger > 0.55 || n.thirst > 0.5 || !inWindow(shipHour(s), 7, 15)) return [];
      if (!s.ship.rover || s.ship.rover.charge < 0.7) return [];
      if (s.ship.components.airlock_seals.fault && s.ship.components.airlock_seals.fault.severity === 'major') return [];
      if (majorAlarmFault(s, d)) return [];
      const b = currentSystem(s, d).byId[f.at];
      if (!roverCanDrive(d, b)) return [];
      return one(0.52 + 0.12 * d.traveler.traits.curiosity + (b.signals.bio || b.signals.anomaly ? 0.1 : 0), at('airlock', 'suit_rack'), { body: f.at });
    },
    start(s, d, a) {
      const sys = currentSystem(s, d);
      a.params.plan = planRover(s, d, sys, sys.byId[a.params.body]);
      emit(s, 'rover_phase', { phase: 'suit_up', body: sys.byId[a.params.body].name });
    },
    duration: () => -1,
    fastTick(s, d, a, dt) {
      const plan = a.params.plan;
      if (plan.i < plan.phases.length) tickRover(s, d, a, currentSystem(s, d), dt);
    },
    done: (s, d, a) => a.params.plan.i >= a.params.plan.phases.length,
    complete(s, d, a) {
      const plan = a.params.plan;
      s.ship.ops.airlockCycling = false;
      s.ship.rover.out = false;
      s.traveler.pos = { room: 'airlock', x: d.rooms.airlock.stations.suit_rack };
      const km = Math.round(plan.driven / 100) / 10;
      s.ship.rover.odometerKm = Math.round((s.ship.rover.odometerKm + km) * 10) / 10;
      s.space.stats.rovers = (s.space.stats.rovers || 0) + 1;
      s.space.stats.roverKm = Math.round(((s.space.stats.roverKm || 0) + km) * 10) / 10;
      const it = visitHead(s);
      if (it && it.body === plan.body) it.done.rovers = (it.done.rovers || 0) + 1;
      s.traveler.needs.hygiene = clamp(s.traveler.needs.hygiene + 0.3);
      s.ship.clutter.airlock = clamp(s.ship.clutter.airlock + 0.2);
      const sys = currentSystem(s, d);
      emit(s, 'rover_end', { body: sys.byId[plan.body].name, km, features: plan.features.filter((f) => f.visited).map((f) => f.kind), samples: plan.samples, room: 'airlock' });
    },
  },

  takeoff: {
    category: 'flight', exertion: 0.8, posture: 'sitting', minCommit: 600,
    gen(s, d) {
      const f = s.ship.flight;
      if (f.mode !== 'landed' || !alert(s)) return [];
      const it = visitHead(s);
      const evaBlocked = s.ship.components.airlock_seals.fault && s.ship.components.airlock_seals.fault.severity === 'major';
      const roverLeft = it && it.body === f.at && it.rover && (it.done.rovers || 0) < it.rover && s.ship.rover && s.ship.rover.charge >= 0.7 && !evaBlocked;
      const doneHere = !it || it.body !== f.at || ((it.done.evas >= it.eva || evaBlocked) && !roverLeft);
      if (!doneHere) return [];
      // after the work is done, a while just being there: longer on a beautiful world (0.4 to 1.6 h after touchdown)
      const b = currentSystem(s, d).byId[f.at];
      if (f.touchdownT !== undefined && s.t - f.touchdownT < (0.4 + 1.2 * (b ? b.beauty : 0)) * 3600) return [];
      return one(0.42, at('bridge', 'helm'));
    },
    start(s, d) { startAscent(s, d); },
    duration: () => -1,
    done: (s) => s.ship.flight.mode !== 'ascent',
  },

  refine_samples: {
    category: 'chore', exertion: 1.1, posture: 'standing', minCommit: 900,
    gen(s, d) {
      const ore = s.space.cargo.ore;
      if (ore < 2 || s.ship.power.mode !== 'normal' || factor(s, d, 'fabricator', 'speed') === 0) return [];
      return one(0.26 + 0.25 * smooth(15 - s.ship.inventory.feedstock, 0, 12), at('workshop', 'fabricator'));
    },
    duration: (s) => range(s.rng, 1800, 3600),
    complete(s) {
      const cargo = s.space.cargo;
      const kg = Math.min(cargo.ore, 12);
      cargo.ore -= kg;
      s.ship.inventory.feedstock += kg * 0.6;
      s.ship.clutter.workshop = clamp(s.ship.clutter.workshop + 0.08);
      emit(s, 'refine', { oreKg: r2(kg), feedstockKg: r2(kg * 0.6), room: 'workshop' });
    },
  },

  melt_ice: {
    category: 'chore', exertion: 1, posture: 'standing', minCommit: 600,
    gen(s) {
      const ice = s.space.cargo.ice;
      if (ice < 3) return [];
      return one(0.24 + 0.3 * smooth(120 - s.ship.water.potable, 0, 80), at('lifesupport', 'recycler'));
    },
    duration: (s) => range(s.rng, 900, 1800),
    complete(s) {
      const kg = s.space.cargo.ice;
      s.space.cargo.ice = 0;
      s.ship.water.gray += kg; // the recycler purifies it
      emit(s, 'melt_ice', { litres: r2(kg), room: 'lifesupport' });
    },
  },

  prepare_torpor: {
    category: 'chore', exertion: 1.2, posture: 'crouching', minCommit: 1800,
    gen(s) {
      if (!s.space.void || s.ship.hydroDormant || !alert(s)) return [];
      return one(0.44, at('hydro', 'mid'));
    },
    duration: (s) => range(s.rng, 3600, 5400),
    complete(s) {
      s.ship.hydroDormant = true;
      s.traveler.history.lastTendT = s.t;
      emit(s, 'bay_dormant', { room: 'hydro' });
    },
  },

  enter_torpor: {
    category: 'sleep', exertion: 0, posture: 'torpor', minCommit: 10 * HOUR, uninterruptible: true,
    gen(s, d) {
      const sp = s.space;
      if (!sp.void || !s.ship.hydroDormant || !PARKED.has(s.ship.flight.mode)) return [];
      if (!inWindow(shipHour(s), 19.5, 23.8) || majorAlarmFault(s, d) || s.traveler.needs.fatigue < 0.25) return [];
      return one(0.75, at('quarters', 'torpor_pod'));
    },
    start(s, d, a) { beginTorpor(s, d, a); },
    duration: (s, d) => range(s.rng, ...d.space.drive.voidRealHours) * HOUR,
    complete(s, d, a) { endTorpor(s, d, a); },
  },
};
