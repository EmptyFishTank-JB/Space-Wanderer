// Deterministic PRNG (sfc32). The generator state is a plain array of four
// uint32 values stored inside the sim state, so a snapshot captures it and a
// restored simulation continues the exact same random sequence.

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seedRng(seed) {
  let s = (typeof seed === 'string' ? hashString(seed) : Number(seed)) >>> 0;
  const splitmix = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  const st = [splitmix(), splitmix(), splitmix(), splitmix()];
  for (let i = 0; i < 16; i++) rand(st);
  return st;
}

/** Uniform float in [0, 1). Mutates the state array. */
export function rand(st) {
  const a = st[0], b = st[1], c = st[2], d = st[3];
  const t = (((a + b) >>> 0) + d) >>> 0;
  st[3] = (d + 1) >>> 0;
  st[0] = (b ^ (b >>> 9)) >>> 0;
  st[1] = (c + (c << 3)) >>> 0;
  const cr = ((c << 21) | (c >>> 11)) >>> 0;
  st[2] = (cr + t) >>> 0;
  return t / 4294967296;
}

export const range = (st, lo, hi) => lo + (hi - lo) * rand(st);
export const chance = (st, p) => rand(st) < p;
export const int = (st, lo, hi) => lo + Math.floor(rand(st) * (hi - lo + 1));
export const pick = (st, arr) => arr[Math.floor(rand(st) * arr.length)];

/** Pick from [{w, ...}] by weight. Returns the item. */
export function weighted(st, items, key = 'w') {
  let total = 0;
  for (const it of items) total += Math.max(0, it[key]);
  if (total <= 0) return items[0];
  let r = rand(st) * total;
  for (const it of items) {
    r -= Math.max(0, it[key]);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
