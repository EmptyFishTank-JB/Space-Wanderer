// Route plotting and in-system agendas — the traveler's autonomous decisions.
import { range, chance } from '../sim/rng.js';
import { clamp, HOUR } from '../sim/util.js';
import { factor } from '../sim/ship/wear.js';
import { neighbors, density, riftLength, nearestStar, systemName, dist3 } from './galaxy.js';

const STAR_RARITY = { O: 1, B: 0.9, A: 0.6, F: 0.35, G: 0.25, K: 0.15, M: 0.05, L: 0.4, T: 0.55, D: 0.6, N: 0.95, BH: 1 };

export function jumpRange(state, data) {
  const d = data.space.drive;
  const fuel = state.ship.fuel;
  return d.baseRangeLy * (1 + 0.15 * (1 - fuel.tons / fuel.capacity)) * factor(state, data, 'drive_coil', 'jumpRange');
}

export function fuelCost(dist, rangeLy, drive) {
  return drive.maxFuelPerJump * (dist / rangeLy) ** drive.fuelExponent;
}

export function heading(data) {
  const h = data.space.galaxy.missionHeading;
  const n = Math.hypot(...h);
  return h.map((v) => v / n);
}

/**
 * Choose the next leg. Returns
 *   {kind:'jump', star, name, cls, dist, cost}
 *   {kind:'void', ly, years, star, name}   (a rift ahead: cross it in torpor)
 *   {kind:'stranded'}                      (no reachable star: wait for the collector trickle)
 */
export function plotRoute(state, data) {
  const sp = state.space;
  const space = data.space;
  const drive = space.drive;
  const H = heading(data);
  const range0 = jumpRange(state, data);
  if (range0 <= 0.5) return { kind: 'stranded', reason: 'drive' };
  const fuel = state.ship.fuel.tons - 0.4;
  const curiosity = data.traveler.traits.curiosity;
  const recent = new Set(sp.recent);
  let best = null;
  for (const c of neighbors(sp.galaxySeed, sp.pos, range0, space)) {
    if (recent.has(c.id)) continue;
    const cost = fuelCost(c.dist, range0, drive);
    if (cost > fuel) continue;
    const def = space.starClasses[c.cls];
    const after = fuel - cost;
    if (!def.scoopable && after < 1.6 * drive.maxFuelPerJump) continue; // never strand ourselves
    const progress = ((c.pos[0] - sp.pos[0]) * H[0] + (c.pos[1] - sp.pos[1]) * H[1] + (c.pos[2] - sp.pos[2]) * H[2]) / range0;
    const score = progress + curiosity * STAR_RARITY[c.cls] * 0.5 + (def.scoopable && state.ship.fuel.tons < 0.5 * state.ship.fuel.capacity ? 0.3 : 0)
      - (cost / drive.maxFuelPerJump) * 0.15 + range(state.rng, -0.1, 0.1);
    if (!best || score > best.score) best = { score, progress, c, cost };
  }
  // A rift ahead? Look a little down the heading.
  const ahead = [sp.pos[0] + H[0] * 60, sp.pos[1] + H[1] * 60, sp.pos[2] + H[2] * 60];
  const rift = density(sp.galaxySeed, ahead, space.galaxy) < space.galaxy.riftThreshold;
  if (rift && (!best || best.progress < 0.35)) {
    const ly = riftLength(sp.galaxySeed, sp.pos, H, space) + 40;
    const land = [sp.pos[0] + H[0] * ly, sp.pos[1] + H[1] * ly, sp.pos[2] + H[2] * ly];
    const star = nearestStar(sp.galaxySeed, land, space, (s) => space.starClasses[s.cls].scoopable);
    if (star) {
      const realLy = dist3(sp.pos, star.pos);
      return { kind: 'void', ly: realLy, years: realLy / drive.voidLyPerYear, star: star.id, name: systemName(sp.galaxySeed, star.id) };
    }
  }
  if (!best) return { kind: 'stranded', reason: 'fuel' };
  return { kind: 'jump', star: best.c.id, name: systemName(sp.galaxySeed, best.c.id), cls: best.c.cls, dist: best.c.dist, cost: best.cost };
}

/** What to do in this system, decided after the survey. */
export function decideAgenda(state, data, sys) {
  const tr = state.traveler;
  const traits = data.traveler.traits;
  const sp = state.space;
  const fuel = state.ship.fuel;
  const items = [];
  const ambition = clamp(traits.curiosity * (1 - 0.45 * tr.mood.weariness) * (1 - 0.6 * Math.max(0, tr.needs.fatigue - 0.4)) + range(state.rng, -0.2, 0.15));
  if (sys.star.scoopable && fuel.tons < 0.8 * fuel.capacity) items.push({ kind: 'scoop' });

  const hullOk = !(state.ship.components.hull_plating.fault && state.ship.components.hull_plating.fault.severity === 'major');
  const scored = (sp.detected || [])
    .map((id) => sys.byId[id])
    .filter((b) => b.kind !== 'belt')
    .filter((b) => {
      // too deep in the star's heat to loiter at
      const a = b.parent === 'star' ? b.a : sys.byId[b.parent].a;
      const rr = sys.star.radius / Math.max(a, 1e-6);
      return data.space.scoop.heatScale * sys.star.heat * rr * rr < 0.2;
    })
    .map((b) => {
      let interest = 0.45 * b.beauty + 0.45 * b.rarity + (b.signals.bio ? 0.5 : 0) + (b.signals.geo ? 0.12 : 0) + (b.signals.anomaly ? 1 : 0) + (b.landable ? 0.15 * traits.curiosity : 0);
      const a = b.parent === 'star' ? b.a : sys.byId[b.parent].a;
      if (a > 100000) interest -= 0.3; else if (a > 20000) interest -= 0.12;
      return { b, interest };
    })
    .sort((x, y) => y.interest - x.interest);
  const maxVisits = ambition > 0.7 ? 3 : ambition > 0.45 ? 2 : ambition > 0.25 ? 1 : 0;
  const bar = 0.75 - 0.35 * ambition;
  for (const { b, interest } of scored) {
    if (items.filter((i) => i.kind === 'visit').length >= maxVisits) break;
    if (interest < bar) continue;
    const land = b.landable && hullOk && (b.signals.bio > 0 || b.signals.geo > 0 || !!b.signals.anomaly || b.rarity > 0.4 || chance(state.rng, 0.35 * traits.curiosity));
    items.push({
      kind: 'visit', body: b.id, land, eva: land ? (b.signals.bio > 0 || b.signals.anomaly ? 2 : 1) : 0,
      lingerH: b.beauty > 0.7 ? range(state.rng, 1, 5) : 0,
      done: { scanned: false, landed: false, evas: 0, lingerUntil: null, leftSurface: false },
    });
  }
  // Sightseeing: even with no survey reason, a striking world gets a look-only orbit (no landing),
  // so the traveler parks somewhere beautiful instead of only ever working. Picked without the RNG.
  const sight = scored.find(({ b }) => b.beauty > 0.6 && !items.some((i) => i.body === b.id));
  if (sight && ambition > 0.2 && items.filter((i) => i.kind === 'visit').length < 3) {
    const b = sight.b;
    items.push({
      kind: 'visit', body: b.id, land: false, eva: 0, sightsee: true,
      lingerH: 0.75 + 2.5 * b.beauty * (0.6 + 0.4 * traits.curiosity),
      done: { scanned: false, landed: false, evas: 0, lingerUntil: null, leftSurface: false },
    });
  }
  return items;
}

/** Called every slow tick: retire finished agenda items. */
export function advanceAgenda(state, data) {
  const sp = state.space;
  const f = state.ship.flight;
  const item = sp.agenda[0];
  if (!item) return;
  if (item.kind === 'scoop') {
    const fuel = state.ship.fuel;
    if (item.done || fuel.tons >= 0.97 * fuel.capacity) sp.agenda.shift();
    return;
  }
  if (item.kind === 'visit') {
    const d = item.done;
    const here = f.at === item.body && (f.mode === 'orbit' || f.mode === 'landed');
    if (!here) return;
    d.scanned = d.scanned || !!sp.scanned[item.body];
    if (f.mode === 'landed') d.landed = true;
    if (d.landed && f.mode === 'orbit') d.leftSurface = true;
    const hull = state.ship.components.hull_plating.fault;
    if (item.land && !d.landed && hull && hull.severity === 'major') item.land = false; // not with a breached hull
    if (!d.scanned) return;
    if (item.land && !d.leftSurface) return;
    if (item.lingerH > 0) {
      if (d.lingerUntil === null) d.lingerUntil = state.t + item.lingerH * HOUR;
      if (state.t < d.lingerUntil) return;
    }
    sp.agenda.shift();
  }
}

export function agendaHead(state) {
  return state.space.agenda[0] || null;
}
