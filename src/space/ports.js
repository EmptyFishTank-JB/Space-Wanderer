// Inhabited space, stations and missions.
//
// Settled regions lie in patches across the galaxy (and one is always near the
// voyage's start), so a wandering traveler passes through inhabited space now
// and then. A settled system has an orbital station round one of its worlds;
// the traveler can dock there, go ashore to the concourse, eat and talk at the
// bar, trade samples and survey data for credits, restock, refuel, and take
// work from the mission board: cargo runs, passengers, xenobiology sample
// returns, survey data and, now and then, smuggling. Everything here is
// derived from the galaxy seed except what the voyage did (the state).
import { hrng, starById, neighbors, dist3, systemName } from './galaxy.js';
import { getSystem } from './system.js';
import { rand, range, int, chance, pick } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { emit } from '../sim/events.js';
import { heldFor, freeCells, handOver, handOverStrays, initPrisoners } from './prisoners.js';
import { boardPassengers, disembark } from './passengers.js';
import { makePassenger } from './people.js';
import { wantedPilot, redeemVouchers, rearm, initCombat } from './combat.js';

const FACTIONS = [
  { id: 'meridian', name: 'Meridian Compact' },
  { id: 'lantern', name: 'Free Lantern Worlds' },
  { id: 'hale', name: 'Hale Survey Directorate' },
  { id: 'cobalt', name: 'Cobalt Reach Cooperative' },
];
export const factionName = (id) => (FACTIONS.find((f) => f.id === id) || { name: id }).name;

const STATION_SUFFIX = ['Station', 'Port', 'Dock', 'Exchange', 'Ring', 'Hub', 'Terminal', 'Orbital'];
const FOUNDERS = ['Okafor', 'Lindqvist', 'Haldane', 'Moreau', 'Tanaka', 'Achebe', 'Varga', 'Ibarra', 'Kowalczyk', 'Nakamura', 'Ferreira', 'Osei', 'Brandt', 'Quill', 'Serrano', 'Ashby', 'Mbeki', 'Castellan', 'Rook', 'Vance'];

// ───────── where people live ─────────
const CORE_CELL = 700; // ly: one chance of a settled region per cell
const coreCache = new Map();
function coreIn(seed, cx, cy, cz) {
  const key = `${seed}|${cx},${cy},${cz}`;
  if (coreCache.has(key)) return coreCache.get(key);
  const st = hrng(seed, 'settled-core', cx, cy, cz);
  let core = null;
  if (rand(st) < 0.55) {
    core = {
      pos: [(cx + rand(st)) * CORE_CELL, (cy + rand(st)) * CORE_CELL, (cz + rand(st) - 0.5) * 0.15 * CORE_CELL],
      radius: range(st, 130, 260), faction: FACTIONS[int(st, 0, FACTIONS.length - 1)].id,
    };
  }
  if (coreCache.size > 400) coreCache.delete(coreCache.keys().next().value);
  coreCache.set(key, core);
  return core;
}
/** The settled regions near a point, plus the one near the voyage's start (around the galaxy origin). */
function coresNear(seed, p) {
  const out = [{ pos: [0, 0, 0], radius: 200, faction: FACTIONS[0].id }];
  const c = p.map((v) => Math.floor(v / CORE_CELL));
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const k = coreIn(seed, c[0] + i, c[1] + j, 0); if (k) out.push(k); }
  return out;
}

/** Is this star's system inhabited? Cheap: no system generation. Returns { faction, outpost } or null. */
export function inhabited(seed, star) {
  const st = hrng(seed, 'inhabited', star.id);
  const u = rand(st);
  for (const c of coresNear(seed, star.pos)) {
    const d = dist3(star.pos, c.pos);
    if (d > c.radius) continue;
    const p = 0.12 + 0.5 * Math.sqrt(1 - d / c.radius);
    if (u < p) return { faction: c.faction, outpost: d > 0.75 * c.radius };
  }
  // a few frontier outposts out in the dark
  if (u > 0.985) return { faction: FACTIONS[int(st, 0, FACTIONS.length - 1)].id, outpost: true };
  return null;
}

const portCache = new Map();
/** The station in a system, or null: { id, name, faction, body (host world id), kind, outpost }. */
export function stationIn(seed, starId, space) {
  const key = `${seed}|${starId}`;
  if (portCache.has(key)) return portCache.get(key);
  const star = starById(seed, starId, space);
  const who = star && inhabited(seed, star);
  let stn = null;
  if (who) {
    const sys = getSystem(seed, starId, space);
    const near = sys.bodies.filter((b) => b.kind === 'planet' && b.parent === 'star' && b.a < 4000);
    const host = near.find((b) => b.type === 'gas_giant') || near.sort((a, c) => c.radius - a.radius)[0] || null;
    if (host) {
      const st = hrng(seed, 'station', starId);
      const founder = pick(st, FOUNDERS);
      stn = {
        id: `stn:${starId}`, starId, body: host.id, faction: who.faction, outpost: who.outpost,
        kind: who.outpost ? 'outpost' : 'orbital', name: `${founder} ${pick(st, STATION_SUFFIX)}`, system: sys.name,
      };
    }
  }
  if (portCache.size > 200) portCache.delete(portCache.keys().next().value);
  portCache.set(key, stn);
  return stn;
}

const BASE_SUFFIX = ['Base', 'Settlement', 'Landing', 'Colony', 'Camp', 'Field'];
const baseCache = new Map();
/** A settlement on the ground, in a settled (not frontier) system: { id, name, faction, body, kind: 'base' } or null. */
export function baseIn(seed, starId, space) {
  const key = `${seed}|${starId}`;
  if (baseCache.has(key)) return baseCache.get(key);
  const star = starById(seed, starId, space);
  const who = star && inhabited(seed, star);
  let base = null;
  if (who && !who.outpost) {
    const st = hrng(seed, 'base', starId);
    if (rand(st) < 0.55) {
      const sys = getSystem(seed, starId, space);
      const site = sys.bodies.find((b) => b.landable && b.kind !== 'belt' && b.gravity > 0.1 && b.gravity < 1.6 && b.a < 4000);
      if (site) base = { id: `base:${starId}`, starId, body: site.id, faction: who.faction, kind: 'base', name: `${pick(st, FOUNDERS)} ${pick(st, BASE_SUFFIX)}`, system: sys.name, world: site.name };
    }
  }
  if (baseCache.size > 200) baseCache.delete(baseCache.keys().next().value);
  baseCache.set(key, base);
  return base;
}

/** The port to put in at here: the station, or the settlement on the ground (alternating when there are both). */
export function portIn(state, data) {
  const sp = state.space;
  const stn = stationIn(sp.galaxySeed, sp.systemId, data.space);
  const base = baseIn(sp.galaxySeed, sp.systemId, data.space);
  if (stn && base) return (sp.portsVisited[stn.id] || 0) > (sp.portsVisited[base.id] || 0) ? base : stn;
  return stn || base;
}

/** The port the ship is at (docked at a station, or landed at a base), or null. */
export function portHere(state, data) {
  const f = state.ship.flight, sp = state.space;
  if (!f.port) return null;
  const stn = stationIn(sp.galaxySeed, sp.systemId, data.space);
  if (stn && stn.id === f.port) return stn;
  const base = baseIn(sp.galaxySeed, sp.systemId, data.space);
  return base && base.id === f.port ? base : null;
}

// ───────── state ─────────
export function initPorts(state) {
  const sp = state.space;
  if (!sp) return;
  if (sp.credits === undefined) sp.credits = 1500;
  sp.rep = sp.rep || {};
  sp.missions = sp.missions || [];
  sp.offers = sp.offers || null;
  sp.dataUnsold = sp.dataUnsold || 0;
  sp.portsVisited = sp.portsVisited || {};
  sp.stats.ports = sp.stats.ports || 0;
  sp.stats.missionsDone = sp.stats.missionsDone || 0;
  sp.stats.missionsFailed = sp.stats.missionsFailed || 0;
  sp.stats.earned = sp.stats.earned || 0;
  if (state.traveler.history.lastPortT === undefined) state.traveler.history.lastPortT = state.t - 4 * 86400;
  initCombat(state);
  initPrisoners(state);
}

const missionCargo = (sp) => sp.missions.reduce((a, m) => a + (m.tons || 0), 0);
const passengers = (sp) => sp.missions.reduce((a, m) => a + (m.passengers || 0), 0);
export const shipPassengers = (state) => (state.space ? passengers(state.space) : 0);

/** Does the traveler want to put in at a port in this system? */
export function wantsPort(state, data) {
  const sp = state.space, sh = state.ship, tr = state.traveler;
  const stn = portIn(state, data);
  if (!stn) return null;
  if (sp.missions.some((m) => (m.to && m.to.starId === sp.systemId && m.kind !== 'bounty') || ((m.kind === 'xeno' || m.kind === 'survey' || m.kind === 'bounty') && m.faction === stn.faction && missionReady(state, m)))) return 'deliver';
  if ((sp.prisoners || []).some((p) => p.state === 'held' && !(p.missionId && sp.missions.some((m) => m.id === p.missionId)))) return 'deliver'; // a prisoner nobody is paying for
  const inv = sh.inventory;
  if (inv.parts < 8 || inv.filters < 2 || sh.food.pantry < 40000) return 'supplies';
  if (sh.components.hull_plating.wear > 0.55) return 'repairs';
  const sinceDays = (state.t - (tr.history.lastPortT ?? -Infinity)) / 86400;
  const lonely = tr.needs.solitude * (0.6 + 0.8 * data.traveler.traits.sociability);
  if (lonely > 0.7 && sinceDays > 4) return 'company';
  if (sp.credits < 600 && sinceDays > 1) return 'work';
  if (sinceDays > 12 && !sp.portsVisited[stn.id]) return 'curious';
  return null;
}

// ───────── docking ─────────
export function startDocking(state, data, stn) {
  const f = state.ship.flight;
  const d = data.space.ports;
  f.mode = 'docking';
  f.port = stn.id;
  f.phases = { kind: 'docking', i: 0, t: 0, list: [{ name: 'request', dur: d.requestSeconds }, { name: 'approach', dur: range(state.rng, ...d.approachSeconds) }, { name: 'slot', dur: d.slotSeconds }, { name: 'pad', dur: d.padSeconds }] };
  emit(state, 'dock_phase', { phase: 'request', station: stn.name, system: stn.system, room: 'bridge' });
}

export function startUndocking(state, data) {
  const f = state.ship.flight;
  const d = data.space.ports;
  f.mode = 'undocking';
  f.phases = { kind: 'undocking', i: 0, t: 0, list: [{ name: 'lift', dur: d.padSeconds }, { name: 'slot', dur: d.slotSeconds }, { name: 'clear', dur: d.clearSeconds }] };
  emit(state, 'dock_phase', { phase: 'lift', station: portName(state, data), room: 'bridge' });
}

const portName = (state, data) => { const s = portHere(state, data) || stationIn(state.space.galaxySeed, state.space.systemId, data.space); return s ? s.name : 'the station'; };

/** Per-second flight update while docking or undocking. */
export function stepDocking(state, data, dt) {
  const f = state.ship.flight;
  const P = f.phases;
  if (!P) return;
  const ph = P.list[P.i];
  P.t += dt;
  if (P.t < ph.dur) return;
  P.i++;
  P.t = 0;
  const stn = stationIn(state.space.galaxySeed, state.space.systemId, data.space);
  if (P.i < P.list.length) { emit(state, 'dock_phase', { phase: P.list[P.i].name, station: stn ? stn.name : '', room: 'bridge' }); return; }
  f.phases = null;
  if (P.kind === 'docking') {
    f.mode = 'docked';
    const sp = state.space;
    const first = !sp.portsVisited[stn.id];
    sp.portsVisited[stn.id] = (sp.portsVisited[stn.id] || 0) + 1;
    sp.stats.ports++;
    state.traveler.history.lastPortT = state.t;
    emit(state, 'docked', { station: stn.name, system: stn.system, faction: factionName(stn.faction), kind: stn.kind, first, room: 'bridge' });
    arrivePort(state, data, stn);
  } else {
    f.mode = 'orbit';
    f.port = null;
    emit(state, 'undocked', { station: stn ? stn.name : '', room: 'bridge' });
  }
}

// ───────── services on arrival: deliveries, refuel, repairs, the board ─────────
function missionReady(state, m) {
  const sp = state.space;
  if (m.kind === 'xeno') return state.space.cargo.bio >= m.samples;
  if (m.kind === 'survey') return sp.stats.scans - m.scansAtStart >= m.bodies;
  if (m.kind === 'bounty') return m.alive && m.captured ? !!heldFor(state, m.id) : !!m.killed;
  return true;
}

/** Touchdown at a settlement's pad: the same welcome as a dock. */
export function landedAtBase(state, data, base) {
  const sp = state.space;
  const f = state.ship.flight;
  f.port = base.id;
  const first = !sp.portsVisited[base.id];
  sp.portsVisited[base.id] = (sp.portsVisited[base.id] || 0) + 1;
  sp.stats.ports++;
  state.traveler.history.lastPortT = state.t;
  emit(state, 'docked', { station: base.name, system: base.system, faction: factionName(base.faction), kind: 'base', world: base.world, first, room: 'bridge' });
  arrivePort(state, data, base);
}

function arrivePort(state, data, stn) {
  const sp = state.space, P = data.space.ports;
  const rep = (fac, dv) => { sp.rep[fac] = clamp((sp.rep[fac] || 0) + dv, -1, 1); };
  // deliveries
  for (const m of [...sp.missions]) {
    const here = m.kind === 'bounty' ? m.faction === stn.faction : m.to ? m.to.starId === sp.systemId : m.faction === stn.faction;
    if (!here || !missionReady(state, m)) continue;
    if (m.kind === 'smuggle' && chance(state.rng, m.risk)) {
      const fine = Math.round(m.reward * 0.6);
      sp.credits = Math.max(0, sp.credits - fine);
      rep(stn.faction, -0.25);
      sp.missions = sp.missions.filter((x) => x !== m);
      sp.stats.missionsFailed++;
      emit(state, 'mission_fail', { kind: m.kind, title: m.title, reason: 'caught', fine, station: stn.name, room: 'bridge' });
      continue;
    }
    if (m.kind === 'xeno') state.space.cargo.bio -= m.samples;
    if (m.passengers) disembark(state, m.id);
    if (m.kind === 'bounty' && m.captured) handOver(state, stn, m);
    if (m.kind === 'bounty' && m.alive && !m.captured) m.reward = Math.round((m.reward * 0.35) / 50) * 50; // wanted alive, brought in dead
    sp.credits += m.reward;
    sp.stats.earned += m.reward;
    sp.stats.missionsDone++;
    rep(m.faction, m.kind === 'smuggle' ? -0.05 : 0.08);
    sp.missions = sp.missions.filter((x) => x !== m);
    emit(state, 'mission_complete', { kind: m.kind, title: m.title, reward: m.reward, station: stn.name, passengers: m.passengers || 0, room: 'bridge' });
  }
  redeemVouchers(state); // bounties claimed on pirates met along the way
  handOverStrays(state, stn); // prisoners whose contract ran out
  // the dock's services: fuel, and the shipyard for a worn hull
  const fuel = state.ship.fuel;
  const want = Math.max(0, fuel.capacity - fuel.tons);
  const afford = Math.min(want, sp.credits / P.fuelPerTon);
  if (afford > 0.5) {
    fuel.tons += afford;
    sp.credits -= Math.round(afford * P.fuelPerTon);
    emit(state, 'port_service', { service: 'refuel', tons: Math.round(afford * 10) / 10, cost: Math.round(afford * P.fuelPerTon), room: 'bridge' });
  }
  const hull = state.ship.components.hull_plating;
  if (hull.wear > 0.35 && sp.credits > P.hullRepair) {
    sp.credits -= P.hullRepair;
    hull.wear = 0.08; hull.knownWear = hull.wear; hull.fault = null;
    emit(state, 'port_service', { service: 'hull_repair', cost: P.hullRepair, room: 'bridge' });
  }
  rearm(state, data); // the magazine topped up
  sp.offers = makeOffers(state, data, stn);
}

/** Today's mission board at a station. */
export function makeOffers(state, data, stn) {
  const sp = state.space, P = data.space.ports;
  const day = Math.floor(state.t / 86400);
  const st = hrng(sp.galaxySeed, 'board', stn.id, day);
  const here = starById(sp.galaxySeed, sp.systemId, data.space);
  const dests = neighbors(sp.galaxySeed, here.pos, P.missionRangeLy, data.space)
    .filter((c) => c.id !== sp.systemId && c.dist > 12 && inhabited(sp.galaxySeed, c)).slice(0, 40);
  const offers = [];
  const n = int(st, 3, 6);
  const kinds = ['cargo', 'cargo', 'passenger', 'xeno', 'survey', 'smuggle', 'bounty'];
  for (let i = 0; i < n; i++) {
    const kind = pick(st, kinds);
    const o = { id: `${stn.id}:${day}:${i}`, kind, faction: stn.faction, from: { starId: sp.systemId, station: stn.name } };
    if (kind === 'bounty') {
      if (!dests.length) continue;
      const to = pick(st, dests);
      o.to = { starId: to.id, system: systemName(sp.galaxySeed, to.id) };
      o.ly = Math.round(to.dist);
      o.target = wantedPilot(sp.galaxySeed, o.id);
      o.reward = o.target.bounty;
      o.deadlineT = state.t + range(st, 8, 16) * 86400;
      o.title = `Bounty: ${o.target.name}, a ${o.target.cls}, last seen at ${o.to.system}`;
      if (rand(hrng(sp.galaxySeed, 'alive', o.id)) < 0.4) {
        o.alive = true;
        o.reward = Math.round((o.reward * 1.6) / 50) * 50;
        o.title = `Wanted alive: ${o.target.name}, a ${o.target.cls}, last seen at ${o.to.system}`;
      }
    } else if (kind === 'cargo' || kind === 'passenger' || kind === 'smuggle') {
      if (!dests.length) continue;
      const to = pick(st, dests);
      o.to = { starId: to.id, system: systemName(sp.galaxySeed, to.id) };
      o.ly = Math.round(to.dist);
      const legs = Math.max(1, Math.ceil(to.dist / (0.7 * data.space.drive.baseRangeLy)));
      o.deadlineT = state.t + (4 + legs * 2.6) * 86400 * range(st, 1, 1.5); // room for a wanderer to stop and look on the way
      if (kind === 'cargo') { o.tons = int(st, 4, 24); o.reward = Math.round(400 + 50 * to.dist + 20 * o.tons); o.title = `${o.tons} t of ${pick(st, ['machine parts', 'medical supplies', 'seed stock', 'water purifiers', 'reactor seals', 'textiles', 'archive cores'])} to ${o.to.system}`; }
      if (kind === 'passenger') { o.passengers = int(st, 1, 3); o.reward = Math.round(700 + 60 * to.dist * o.passengers); o.title = `${o.passengers === 1 ? 'A passenger' : `${o.passengers} passengers`} to ${o.to.system}`; }
      if (kind === 'smuggle') { o.tons = int(st, 2, 6); o.risk = range(st, 0.12, 0.3); o.reward = Math.round(2.6 * (400 + 50 * to.dist + 20 * o.tons)); o.title = `${o.tons} t, no questions asked, to ${o.to.system}`; }
    } else if (kind === 'xeno') {
      o.samples = 1;
      o.deadlineT = state.t + range(st, 14, 28) * 86400;
      o.reward = Math.round(range(st, 1500, 2600));
      o.title = `A living sample from any world, for ${factionName(stn.faction)} biologists`;
    } else {
      o.bodies = int(st, 3, 6);
      o.deadlineT = state.t + range(st, 18, 35) * 86400;
      o.reward = 220 * o.bodies;
      o.title = `Survey scans of ${o.bodies} new worlds, for any ${factionName(stn.faction)} station`;
    }
    offers.push(o);
  }
  return { station: stn.id, day, list: offers };
}

/** At the mission board: which offers the traveler takes. Returns the accepted missions. */
export function chooseMissions(state, data) {
  const sp = state.space;
  if (!sp.offers) return [];
  const tr = data.traveler.traits;
  const P = data.space.ports;
  const taken = [];
  const room = () => ({ tons: P.holdForCargoT - missionCargo(sp), seats: P.cabins - passengers(sp) });
  const scored = sp.offers.list.map((o) => {
    let s = o.reward / 2500 + (sp.credits < 2000 ? 0.4 : 0) - Math.min(0.4, sp.credits / 40000);
    if (o.kind === 'xeno' || o.kind === 'survey') s += 0.5 * tr.curiosity;
    if (o.kind === 'passenger') s += 0.3 * tr.sociability;
    if (o.kind === 'smuggle') s -= 0.6 * tr.discipline;
    if (o.kind === 'bounty') s += 0.25 * tr.resilience - 0.35 + (state.ship.components.hull_plating.wear > 0.4 ? -0.4 : 0) + (o.alive ? 0.1 * tr.discipline : 0);
    return { o, s: s + range(state.rng, -0.15, 0.15) };
  }).sort((a, b) => b.s - a.s);
  for (const { o, s } of scored) {
    if (sp.missions.length >= P.maxMissions || s < 0.7) break;
    const r = room();
    if ((o.tons || 0) > r.tons || (o.passengers || 0) > r.seats) continue;
    if (o.alive && freeCells(state) < 1) continue; // nowhere to keep them
    // a wanderer, not a hauler: with money in hand, only the work that's interesting for its own sake, and not always
    if (sp.credits > 6000 && !['xeno', 'survey'].includes(o.kind) && !chance(state.rng, 0.25)) continue;
    if (o.kind === 'smuggle' && !chance(state.rng, 0.25)) continue;
    const m = { ...o, acceptedT: state.t, scansAtStart: sp.stats.scans };
    sp.missions.push(m);
    if (m.passengers) boardPassengers(state, data, m, Array.from({ length: m.passengers }, (_, i) => makePassenger(sp.galaxySeed, m.id, i, sp.offers ? stationIn(sp.galaxySeed, sp.systemId, data.space).name : '', m.to.system)));
    taken.push(m);
    emit(state, 'mission_accept', { kind: m.kind, title: m.title, reward: m.reward, days: Math.round((m.deadlineT - state.t) / 86400), room: 'port' });
  }
  sp.offers.list = sp.offers.list.filter((o) => !taken.some((m) => m.id === o.id));
  return taken;
}

/** Sell what the voyage gathered, and restock. */
export function tradeAtPort(state, data) {
  const sp = state.space, sh = state.ship, P = data.space.ports;
  const cargo = sp.cargo;
  const keepBio = sp.missions.filter((m) => m.kind === 'xeno').reduce((a, m) => a + m.samples, 0);
  const sold = { ore: Math.round(cargo.ore * 10) / 10, ice: Math.round(cargo.ice * 0.5 * 10) / 10, bio: Math.max(0, cargo.bio - keepBio), data: sp.dataUnsold };
  const income = Math.round(sold.ore * P.price.oreKg + sold.ice * P.price.iceKg + sold.bio * P.price.bioSample + sold.data * P.price.scanData);
  cargo.ore -= sold.ore; cargo.ice -= sold.ice; cargo.bio -= sold.bio; sp.dataUnsold = 0;
  sp.credits += income;
  sp.stats.earned += income;
  // restock: spares and filters, and the pantry
  let spent = 0;
  const inv = sh.inventory;
  for (const [k, target, price] of [['parts', 22, P.price.part], ['filters', 6, P.price.filter], ['cartridges', 5, P.price.cartridge], ['seals', 16, P.price.seal]]) {
    const n = Math.max(0, Math.min(target - inv[k], Math.floor((sp.credits - spent) / price)));
    inv[k] += n; spent += n * price;
  }
  const kcal = Math.max(0, Math.min(150000 - sh.food.pantry, ((sp.credits - spent) / P.price.kcal1000) * 1000));
  sh.food.pantry += kcal; spent += Math.round((kcal / 1000) * P.price.kcal1000);
  sp.credits -= spent;
  emit(state, 'trade', { income, spent, sold, room: 'port' });
}

/** Missions that ran out of time. Per slow tick. */
export function expireMissions(state) {
  const sp = state.space;
  if (!sp || !sp.missions || !sp.missions.length) return;
  for (const m of [...sp.missions]) {
    if (state.t < m.deadlineT) continue;
    sp.missions = sp.missions.filter((x) => x !== m);
    if (m.passengers) disembark(state, m.id);
    // a prisoner whose contract lapses stays in the brig until the next port's security takes them
    sp.rep[m.faction] = clamp((sp.rep[m.faction] || 0) - 0.1, -1, 1);
    sp.stats.missionsFailed++;
    emit(state, 'mission_fail', { kind: m.kind, title: m.title, reason: 'late', room: 'bridge' });
  }
}

/** Where the active missions want to go next: a star position to steer for, or null. */
export function missionTarget(state, data) {
  const sp = state.space;
  const m = sp.missions.filter((x) => x.to && !(x.kind === 'bounty' && (x.killed || x.captured) && !x.from)).sort((a, b) => a.deadlineT - b.deadlineT)[0];
  if (!m) return null;
  // a bounty brought down or taken alive goes back to where the contract was signed
  const done = m.kind === 'bounty' && (m.killed || m.captured);
  const st = starById(sp.galaxySeed, done ? m.from.starId : m.to.starId, data.space);
  return st ? { id: st.id, pos: st.pos } : null;
}
