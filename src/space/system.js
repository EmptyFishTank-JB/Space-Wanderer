// Star-system generation. Deterministic from (galaxySeed, star id); results
// are cached in memory, never stored in the snapshot.
//
// Units: orbits and radii in light-seconds (Ls), mass in solar / Earth
// masses, temperature in kelvin, periods in seconds.
import { rand, range, int, chance } from '../sim/rng.js';
import { hrng, starById, systemName, starVariant } from './galaxy.js';

export const LS_PER_AU = 499;
export const LS_PER_RSUN = 2.32;
export const LS_PER_REARTH = 0.02125;
export const KM_PER_LS = 299792;
const DAY = 86400;

const cache = new Map();
const exempt = new Set();

/** Keep a system exactly as it was generated before star variants existed (a saved voyage is sitting in it). */
export function exemptFromVariants(seed, id) {
  const key = `${seed}|${id}`;
  if (exempt.has(key)) return;
  exempt.add(key);
  cache.delete(key);
}

export function getSystem(seed, id, space) {
  const key = `${seed}|${id}`;
  let sys = cache.get(key);
  if (!sys) {
    sys = generateSystem(seed, id, space);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    cache.set(key, sys);
  }
  return sys;
}

function makeStar(st, cls, def) {
  const u = rand(st);
  const lerpR = ([a, b]) => a + (b - a) * u;
  const lum = def.lum[0] * (def.lum[1] / Math.max(def.lum[0], 1e-9)) ** u;
  const star = {
    cls, label: def.label, color: def.color, scoopable: def.scoopable, heat: def.heat, rate: def.rate,
    tempK: Math.round(lerpR(def.temp)), mass: lerpR(def.mass), radiusSun: lerpR(def.radius), lum,
  };
  star.radius = star.radiusSun * LS_PER_RSUN;
  star.rarity = { O: 1, B: 0.9, A: 0.6, F: 0.35, G: 0.25, K: 0.15, M: 0.05, L: 0.4, T: 0.55, D: 0.6, N: 0.95, BH: 1 }[cls];
  star.beauty = { O: 1, B: 0.9, A: 0.7, F: 0.55, G: 0.5, K: 0.45, M: 0.35, L: 0.45, T: 0.5, D: 0.6, N: 0.9, BH: 1 }[cls];
  return star;
}

function pickType(st, T, frost, aAU, star) {
  const r = rand(st);
  if (aAU > frost * 0.9 && star.mass > 0.15) {
    if (r < 0.5) return 'gas_giant';
    if (r < 0.65) return 'ice_giant';
    return 'icy';
  }
  if (T > 900) return r < 0.4 ? 'metal_rich' : r < 0.8 ? 'high_metal' : 'rocky';
  if (T > 450) return r < 0.4 ? 'high_metal' : r < 0.85 ? 'rocky' : 'metal_rich';
  if (T > 240) {
    const sunlike = ['F', 'G', 'K'].includes(star.cls);
    if (sunlike && r < 0.07) return 'earth_like';
    if (r < 0.19) return 'water_world';
    return r < 0.6 ? 'rocky' : 'high_metal';
  }
  if (T > 150) return r < 0.07 ? 'ammonia' : r < 0.12 ? 'water_world' : r < 0.7 ? 'rocky' : 'icy';
  return r < 0.65 ? 'icy' : 'rocky';
}

const ORE = { metal_rich: 1, high_metal: 0.7, rocky: 0.4, icy: 0.1, earth_like: 0.3, water_world: 0.1, ammonia: 0.2 };
const BEAUTY = { earth_like: 1, water_world: 0.75, ammonia: 0.55, gas_giant: 0.5, ice_giant: 0.45, icy: 0.3, rocky: 0.2, metal_rich: 0.25, high_metal: 0.22 };
const RARITY = { earth_like: 0.95, water_world: 0.7, ammonia: 0.65, metal_rich: 0.45, gas_giant: 0.15, ice_giant: 0.2, icy: 0.1, rocky: 0.08, high_metal: 0.12 };

function physical(st, type, T) {
  let mass;
  let radius;
  switch (type) {
    case 'gas_giant': mass = 10 ** range(st, 1.3, 3); radius = range(st, 3.5, 12); break;
    case 'ice_giant': mass = range(st, 10, 25); radius = range(st, 3.5, 4.6); break;
    case 'earth_like': case 'water_world': mass = range(st, 0.4, 2.5); radius = mass ** 0.28; break;
    case 'metal_rich': mass = 10 ** range(st, -2, 0.5); radius = 0.85 * mass ** 0.27; break;
    case 'icy': mass = 10 ** range(st, -2.5, 0.6); radius = 1.1 * mass ** 0.3; break;
    default: mass = 10 ** range(st, -2, 0.7); radius = mass ** 0.28;
  }
  const gravity = mass / (radius * radius);
  let atmosphere = 'none';
  if (type === 'gas_giant' || type === 'ice_giant') atmosphere = 'giant';
  else if (type === 'earth_like' || type === 'water_world' || type === 'ammonia') atmosphere = 'thick';
  else if (mass > 1.5 && T > 600) atmosphere = 'crushing';
  else if (mass > 1.2 && T > 180) atmosphere = chance(st, 0.6) ? 'thick' : 'thin';
  else if (mass > 0.05 && chance(st, 0.35)) atmosphere = 'thin';
  return { mass, radiusEarth: radius, gravity, atmosphere };
}

function bodyRecord(st, { id, name, kind, parent, type, aLs, periodS, T, star, tidal }) {
  const p = physical(st, type, T);
  const giant = type === 'gas_giant' || type === 'ice_giant';
  const landable = !giant && p.atmosphere !== 'crushing' && p.gravity < 2.6 && T < 750 && !(type === 'water_world');
  const volcanism = !giant && chance(st, (type === 'icy' ? 0.25 : 0.12) + (tidal ? 0.3 : 0));
  const rings = giant ? chance(st, type === 'gas_giant' ? 0.35 : 0.25) : chance(st, 0.02);
  const geo = volcanism ? int(st, 1, 5) : 0;
  let bioP = 0;
  if (type === 'earth_like') bioP = 0.35;
  else if (type === 'water_world') bioP = 0.08;
  else if (landable && p.atmosphere === 'thin' && T > 170 && T < 420) bioP = (star.scoopable && star.cls !== 'M' ? 0.006 : 0.002) + (volcanism ? 0.004 : 0);
  const bio = chance(st, bioP) ? int(st, 1, 4) : 0;
  let anomaly = null;
  if (chance(st, 0.004)) anomaly = chance(st, 0.12) ? 'unexplained_signal' : chance(st, 0.5) ? 'crystalline_spires' : 'patterned_vents';
  let beauty = (BEAUTY[type] ?? 0.2) + (rings ? 0.3 : 0) + (volcanism ? 0.08 : 0) + (p.atmosphere === 'thin' ? 0.05 : 0);
  let rarity = (RARITY[type] ?? 0.1) + (rings && !giant ? 0.5 : 0) + (bio ? 0.4 : 0) + (anomaly ? 1 : 0);
  return {
    id, name, kind, parent, type, a: aLs, period: periodS, phase0: rand(st) * Math.PI * 2,
    radius: p.radiusEarth * LS_PER_REARTH, radiusKm: Math.round(p.radiusEarth * 6371), mass: p.mass, gravity: p.gravity,
    tempK: Math.round(T), atmosphere: p.atmosphere, volcanism, rings, landable,
    signals: { geo, bio, anomaly }, ore: ORE[type] ?? 0, ice: type === 'icy' || (T < 200 && !giant),
    beauty: Math.min(1, beauty), rarity: Math.min(1, rarity), hue: rand(st),
  };
}

export function generateSystem(seed, id, space) {
  const entry = starById(seed, id, space);
  const def = space.starClasses[entry.cls];
  const st = hrng(seed, 'system', id);
  const star = makeStar(st, entry.cls, def);
  const name = systemName(seed, id);
  const bodies = [];
  const remnant = ['D', 'N', 'BH', 'L', 'T'].includes(entry.cls);
  const count = remnant ? int(st, 0, 3) : entry.cls === 'M' ? int(st, 0, 7) : int(st, 2, 10);
  const lumRoot = Math.sqrt(Math.max(star.lum, 0.0005));
  const frost = 2.7 * lumRoot;
  let aAU = range(st, 0.05, 0.3) * Math.max(0.15, lumRoot);
  aAU = Math.max(aAU, (star.radius * 4) / LS_PER_AU);
  const letters = 'bcdefghijklmnop';
  for (let i = 0, n = 0; i < count; i++) {
    if (i > 0) aAU *= range(st, 1.4, 2.1);
    const aLs = aAU * LS_PER_AU;
    const periodS = 365.25 * DAY * Math.sqrt(aAU ** 3 / Math.max(star.mass, 0.02));
    const T = star.lum > 0 ? (278 * star.lum ** 0.25) / Math.sqrt(aAU) : 40;
    if (chance(st, 0.1)) {
      bodies.push({ id: `belt${i}`, name: `${name} belt ${bodies.filter((b) => b.kind === 'belt').length + 1}`, kind: 'belt', parent: 'star', type: 'belt', a: aLs, period: periodS, phase0: 0, radius: 0, beauty: 0.3, rarity: 0.1, landable: false, signals: { geo: 0, bio: 0, anomaly: null }, ore: 0.8, ice: T < 200 });
      continue;
    }
    const type = pickType(st, T, frost, aAU, star);
    const pid = `p${i}`;
    const planet = bodyRecord(st, { id: pid, name: `${name} ${letters[n++] || 'z'}`, kind: 'planet', parent: 'star', type, aLs, periodS, T, star });
    bodies.push(planet);
    const giant = type === 'gas_giant' || type === 'ice_giant';
    const moons = giant ? int(st, 0, type === 'gas_giant' ? 7 : 4) : planet.mass > 0.6 ? int(st, 0, 2) : 0;
    let mA = planet.radius * range(st, 3, 8);
    for (let j = 0; j < moons; j++) {
      mA *= range(st, 1.3, 2.2);
      const mPeriod = 2 * Math.PI * Math.sqrt((mA * KM_PER_LS * 1000) ** 3 / (6.674e-11 * planet.mass * 5.97e24));
      const mT = T * range(st, 0.9, 1.0);
      const mType = mT < 200 ? (chance(st, 0.7) ? 'icy' : 'rocky') : chance(st, 0.2) ? 'metal_rich' : 'rocky';
      const moon = bodyRecord(st, { id: `${pid}m${j}`, name: `${planet.name} ${j + 1}`, kind: 'moon', parent: pid, type: mType, aLs: mA, periodS: mPeriod, T: mT, star, tidal: giant && j < 2 });
      // moons are small: rescale
      moon.radius = Math.min(moon.radius, planet.radius * 0.45);
      moon.radiusKm = Math.round((moon.radius / LS_PER_REARTH) * 6371);
      moon.mass = Math.min(moon.mass, 0.2);
      moon.gravity = moon.mass / (moon.radius / LS_PER_REARTH) ** 2;
      moon.landable = moon.atmosphere !== 'crushing' && moon.gravity < 2.6 && moon.tempK < 750;
      if (giant) moon.beauty = Math.min(1, moon.beauty + 0.25); // the giant hanging in its sky
      bodies.push(moon);
    }
  }
  const variant = exempt.has(`${seed}|${id}`) ? null : starVariant(seed, id, entry.cls, space);
  let kept = bodies;
  if (variant) {
    applyVariant(star, variant, space.variants[variant], hrng(seed, 'variant-star', id));
    // a swollen star swallows its inner worlds (and their moons)
    const gone = new Set(bodies.filter((b) => b.parent === 'star' && b.a < star.radius * 6).map((b) => b.id));
    kept = bodies.filter((b) => !gone.has(b.id) && !gone.has(b.parent));
  }
  addCompanion(star, entry.cls, space.binary, hrng(seed, 'binary', id));
  star.type = variant || entry.cls;
  return { id, name, pos: entry.pos, star, bodies: kept, byId: Object.fromEntries(kept.map((b) => [b.id, b])) };
}

function applyVariant(star, key, v, st) {
  const u = rand(st);
  const lerpR = (r) => r[0] + (r[1] - r[0]) * u;
  star.variant = key;
  star.label = v.label;
  if (v.color) star.color = v.color;
  if (v.heat !== undefined) star.heat = v.heat;
  if (v.temp) star.tempK = Math.round(lerpR(v.temp));
  if (v.mass) star.mass = lerpR(v.mass);
  if (v.radius) { star.radiusSun = lerpR(v.radius); star.radius = star.radiusSun * LS_PER_RSUN; }
  if (v.lum) star.lum = v.lum[0] * (v.lum[1] / v.lum[0]) ** u;
  star.rarity = v.rarity ?? star.rarity;
  star.beauty = v.beauty ?? star.beauty;
  if (v.pulsar) star.spinS = 0.08 + 1.6 * rand(st) ** 2; // seconds per turn
}

/** A wide companion star for some systems: drawn in the sky, no effect on the planets' orbits. */
function addCompanion(star, cls, b, st) {
  if (!b || !b.primaries.includes(cls) || rand(st) >= b.chance) return;
  let w = rand(st);
  let ccls = 'M';
  for (const [k, p] of Object.entries(b.companions)) { w -= p; if (w <= 0) { ccls = k; break; } }
  const sepAU = b.sepAU[0] * (b.sepAU[1] / b.sepAU[0]) ** rand(st);
  star.companion = { cls: ccls, sepAU, angle: rand(st) * Math.PI * 2 };
}

/** Body centre in the system plane (Ls) at mission time `mt` (s). */
export function bodyPos(sys, bodyId, mt) {
  if (bodyId === 'star') return { x: 0, y: 0 };
  const b = sys.byId[bodyId];
  const ang = b.phase0 + (2 * Math.PI * mt) / b.period;
  const local = { x: b.a * Math.cos(ang), y: b.a * Math.sin(ang) };
  if (b.parent === 'star') return local;
  const p = bodyPos(sys, b.parent, mt);
  return { x: p.x + local.x, y: p.y + local.y };
}

export function bodyRadius(sys, bodyId) {
  return bodyId === 'star' ? sys.star.radius : sys.byId[bodyId].radius;
}

/** Short summary stored on the traveler's record of a system. */
export function systemSummary(sys) {
  const types = {};
  for (const b of sys.bodies) types[b.type] = (types[b.type] || 0) + 1;
  return { id: sys.id, name: sys.name, star: sys.star.cls, label: sys.star.label, bodies: sys.bodies.length, types };
}
