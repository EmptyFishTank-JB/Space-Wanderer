// The sky as seen from the current system: the galaxy's real neighbouring
// stars (so constellations hold their shape and slowly shift as the ship
// travels), the nebulae near enough to see, and the direction of the
// galactic core for the band. Computed once per system and cached.
//
// Directions are in the galaxy frame: azimuth in the x-y plane, elevation
// toward +z (the galactic plane is z = 0). The in-system frame shares those
// axes, so a body's bearing and a star's azimuth line up on screen.
import { neighbors, nebulaeNear, starVariant } from '../space/galaxy.js';
import { hex, hash, strHash } from './gfx.js';

const STAR_RANGE_LY = 90;
const NEBULA_RANGE_LY = 1600;
const MAG_LIMIT = 6.2;
const cache = new Map();

const dirTo = (from, to) => {
  const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const r = Math.hypot(d[0], d[1], d[2]) || 1;
  return { az: Math.atan2(d[1], d[0]), el: Math.asin(Math.max(-1, Math.min(1, d[2] / r))), r };
};

/** Typical luminosity (L_sun) for a class or variant: the middle of its range on a log scale. */
function typicalLum(def) {
  if (!def || !def.lum) return 0;
  const [a, b] = def.lum;
  return a > 0 ? Math.sqrt(a * b) : b / 2;
}

export function skyFor(seed, sys, space) {
  const key = `${seed}|${sys.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const stars = [];
  for (const c of neighbors(seed, sys.pos, STAR_RANGE_LY, space)) {
    const def = space.starClasses[c.cls];
    const v = starVariant(seed, c.id, c.cls, space);
    const vd = v && space.variants[v];
    const lum = typicalLum(vd && vd.lum ? vd : def) * (0.5 + hash(strHash(c.id), 7));
    if (!(lum > 0)) continue;
    const m = 4.83 - 2.5 * Math.log10(lum) + 5 * Math.log10(Math.max(c.dist, 0.3) / 32.6);
    if (m > MAG_LIMIT) continue;
    const { az, el } = dirTo(sys.pos, c.pos);
    stars.push({ az, el, m, c: hex((vd && vd.color) || def.color), id: c.id, pulsar: v === 'PSR' });
  }
  stars.sort((a, b) => b.m - a.m); // faint first, bright on top
  const nebulae = [];
  for (const n of nebulaeNear(seed, sys.pos, NEBULA_RANGE_LY, space)) {
    const { az, el, r } = dirTo(sys.pos, n.pos);
    const inside = r < n.radius;
    if (!inside && n.radius / r < (n.kind === 'planetary' ? 0.002 : 0.015)) continue; // too small to see from here
    const ang = inside ? Math.PI : Math.asin(Math.min(1, n.radius / r));
    // farther nebulae are fainter; inside one, the glow is all around
    const bright = inside ? 1 : Math.min(1, 0.25 + (2.5 * n.radius) / Math.max(r, 1));
    nebulae.push({ id: n.id, kind: n.kind, az, el, ang, inside, depth: inside ? 1 - r / n.radius : 0, bright, color: n.color, shape: n.shape, dist: r });
  }
  nebulae.sort((a, b) => b.dist - a.dist);
  const coreAz = space.galaxy.missionHeading ? Math.atan2(space.galaxy.missionHeading[1], space.galaxy.missionHeading[0]) : 0;
  const sky = { stars, nebulae, coreAz };
  if (cache.size > 24) cache.delete(cache.keys().next().value);
  cache.set(key, sky);
  return sky;
}
