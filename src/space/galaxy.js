// Procedural galaxy. Nothing here is stored: every star is regenerated on
// demand from (galaxySeed, cell) with its own hash-seeded RNG, independent of
// the simulation RNG. Space is a grid of 10-ly cells whose star counts follow
// a smooth density field. Low-density "rifts" in that field are the voids the
// traveler crosses in torpor.
import { seedRng, rand, hashString } from '../sim/rng.js';

export const hrng = (...parts) => seedRng(hashString(parts.join('|')));

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

function lattice(seed, tag, x, y, z) {
  return rand(hrng(seed, tag, x, y, z));
}

function valueNoise(seed, tag, p, scale) {
  const fx = p[0] / scale, fy = p[1] / scale, fz = p[2] / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
  const tx = smooth(fx - x0), ty = smooth(fy - y0), tz = smooth(fz - z0);
  const v = (dx, dy, dz) => lattice(seed, tag, x0 + dx, y0 + dy, z0 + dz);
  return lerp(
    lerp(lerp(v(0, 0, 0), v(1, 0, 0), tx), lerp(v(0, 1, 0), v(1, 1, 0), tx), ty),
    lerp(lerp(v(0, 0, 1), v(1, 0, 1), tx), lerp(v(0, 1, 1), v(1, 1, 1), tx), ty),
    tz,
  );
}

/** Stellar density field, 0..1. The neighborhood of the origin is kept populated. */
export function density(seed, p, g) {
  const L = g.densityLatticeLy;
  let d = 0.65 * valueNoise(seed, 'dA', p, L) + 0.35 * valueNoise(seed, 'dB', p, L / 3);
  const r = Math.hypot(p[0], p[1], p[2]);
  if (r < 150) d = Math.max(d, 0.55);
  return d;
}

function poisson(st, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rand(st); } while (p > L && k < 40);
  return k - 1;
}

function pickClass(st, classes) {
  let total = 0;
  for (const k in classes) total += classes[k].freq;
  let r = rand(st) * total;
  for (const k in classes) {
    r -= classes[k].freq;
    if (r <= 0) return k;
  }
  return 'M';
}

const cellCache = new Map();

/** Stars in one cell: [{id, pos:[x,y,z] ly, cls}] */
export function starsInCell(seed, cx, cy, cz, space) {
  const key = `${seed}|${cx}|${cy}|${cz}`;
  const hit = cellCache.get(key);
  if (hit) return hit;
  const g = space.galaxy;
  const C = g.cellLy;
  const center = [(cx + 0.5) * C, (cy + 0.5) * C, (cz + 0.5) * C];
  const d = density(seed, center, g);
  const lambda = d < g.riftThreshold ? g.starsPerCell * 0.01 : g.starsPerCell * (0.35 + 1.3 * (d - g.riftThreshold));
  const st = hrng(seed, 'cell', cx, cy, cz);
  const n = poisson(st, lambda);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `${cx}.${cy}.${cz}.${i}`,
      pos: [(cx + rand(st)) * C, (cy + rand(st)) * C, (cz + rand(st)) * C],
      cls: pickClass(st, space.starClasses),
    });
  }
  if (cellCache.size > 20000) cellCache.clear();
  cellCache.set(key, out);
  return out;
}

export function starById(seed, id, space) {
  const [cx, cy, cz, i] = id.split('.').map(Number);
  const s = starsInCell(seed, cx, cy, cz, space)[i];
  if (!s) throw new Error(`no star ${id}`);
  return s;
}

export const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** All stars within `range` ly of `pos`, nearest first. */
export function neighbors(seed, pos, range, space) {
  const C = space.galaxy.cellLy;
  const r = Math.ceil(range / C);
  const c = pos.map((v) => Math.floor(v / C));
  const out = [];
  for (let x = c[0] - r; x <= c[0] + r; x++) {
    for (let y = c[1] - r; y <= c[1] + r; y++) {
      for (let z = c[2] - r; z <= c[2] + r; z++) {
        for (const s of starsInCell(seed, x, y, z, space)) {
          const d = dist3(s.pos, pos);
          if (d <= range && d > 1e-6) out.push({ ...s, dist: d });
        }
      }
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/** Nearest star to an arbitrary point (expanding search). */
export function nearestStar(seed, pos, space, filter = () => true) {
  for (let range = 15; range <= 240; range *= 2) {
    const n = neighbors(seed, pos, range, space).filter(filter);
    if (n.length) return n[0];
  }
  return null;
}

const NAMES = ['Aster', 'Coll', 'Dray', 'Fenn', 'Halde', 'Ivra', 'Ker', 'Lumen', 'Moro', 'Nadir', 'Orr', 'Pell', 'Quill',
  'Rhee', 'Sable', 'Thal', 'Ulm', 'Vesk', 'Wren', 'Yarr', 'Brask', 'Cindra', 'Esk', 'Gauss', 'Hollin', 'Joss', 'Lysk', 'Merrow'];

export function systemName(seed, id) {
  const h = hashString(`${seed}|name|${id}`);
  return `${NAMES[h % NAMES.length]} ${1000 + ((h >>> 8) % 8999)}`;
}

/** March along `dir` from `pos` while the field stays below the rift threshold. Returns void length in ly. */
export function riftLength(seed, pos, dir, space) {
  const g = space.galaxy;
  let d = 0;
  for (let step = 20; step <= 4000; step += 20) {
    const p = [pos[0] + dir[0] * step, pos[1] + dir[1] * step, pos[2] + dir[2] * step];
    if (density(seed, p, g) >= g.riftThreshold + 0.06) return step;
    d = step;
  }
  return d;
}

/**
 * Rare kind of star this one is, or null: a Y dwarf, carbon star, red giant,
 * Wolf-Rayet star or pulsar. Rolled from the star's own hash, never from the
 * class pick, so adding kinds leaves every other star where and what it was.
 */
export function starVariant(seed, id, cls, space) {
  const vs = space.variants;
  if (!vs) return null;
  const r = rand(hrng(seed, 'variant', id));
  for (const [key, v] of Object.entries(vs)) if (key[0] !== '_' && v.from === cls && r < v.chance) return key;
  return null;
}

/** Nebulae within `range` ly: [{id, kind, pos, radius, color}] from a coarse lattice. */
export function nebulaeNear(seed, pos, range, space) {
  const nb = space.nebulae;
  if (!nb) return [];
  const C = nb.cellLy;
  const r = Math.ceil(range / C);
  const c = pos.map((v) => Math.floor(v / C));
  const kinds = Object.entries(nb.kinds);
  const total = kinds.reduce((a, [, k]) => a + k.weight, 0);
  const out = [];
  for (let x = c[0] - r; x <= c[0] + r; x++) for (let y = c[1] - r; y <= c[1] + r; y++) for (let z = c[2] - 1; z <= c[2] + 1; z++) {
    const st = hrng(seed, 'nebula', x, y, z);
    if (rand(st) > nb.chance) continue;
    let w = rand(st) * total;
    let kind = kinds[0];
    for (const k of kinds) { w -= k[1].weight; if (w <= 0) { kind = k; break; } }
    const rr = kind[1].radiusLy || nb.radiusLy;
    const p = [(x + rand(st)) * C, (y + rand(st)) * C, (z + 0.3 + 0.4 * rand(st)) * C * 0.25];
    const n = { id: `${x}.${y}.${z}`, kind: kind[0], pos: p, radius: rr[0] + (rr[1] - rr[0]) * rand(st), color: kind[1].color, shape: rand(st) };
    if (dist3(n.pos, pos) - n.radius <= range) out.push(n);
  }
  return out;
}
