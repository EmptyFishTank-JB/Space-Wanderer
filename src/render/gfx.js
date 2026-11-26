// Low-level pixel drawing for the 320×180 framebuffer. Everything snaps to
// whole pixels; colors are [r, g, b] arrays (0..255).

export const W = 320;
export const H = 180;
export const PPM = 32; // pixels per meter inside the ship
export const FLOOR = 150; // floor line (screen y)
export const CEIL = 40; // ceiling line

export const hex = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const css = (c, a = 1) => (a >= 1 ? `rgb(${cl(c[0])},${cl(c[1])},${cl(c[2])})` : `rgba(${cl(c[0])},${cl(c[1])},${cl(c[2])},${a})`);
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export function rect(ctx, c, x, y, w, h, a = 1) {
  ctx.fillStyle = css(c, a);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}
export function px(ctx, c, x, y, a = 1) {
  ctx.fillStyle = css(c, a);
  ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
}
export function hline(ctx, c, x0, x1, y, a = 1) { rect(ctx, c, Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, a); }
export function vline(ctx, c, x, y0, y1, a = 1) { rect(ctx, c, x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, a); }

export function line(ctx, c, x0, y0, x1, y1, a = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  ctx.fillStyle = css(c, a);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 2000; i++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Filled pixel disc. */
export function disc(ctx, c, cx, cy, r, a = 1) {
  ctx.fillStyle = css(c, a);
  const R = Math.max(0.5, r);
  for (let y = -Math.ceil(R); y <= Math.ceil(R); y++) {
    const w = Math.floor(Math.sqrt(Math.max(0, R * R - y * y)));
    if (R * R - y * y < 0) continue;
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), 2 * w + 1, 1);
  }
}

/** Soft additive glow (uses a radial gradient; call with ctx.globalCompositeOperation = 'lighter' for light). */
export function glow(ctx, c, cx, cy, r, a = 1) {
  if (r <= 0) return;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, css(c, a));
  g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
}

// Deterministic hash noise (renderer-side; never touches the sim RNG).
export function hash(x, y = 0, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function strHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

const lerp = (a, b, t) => a + (b - a) * t;
const sm = (t) => t * t * (3 - 2 * t);
/** 3D value noise in [0,1). */
export function noise3(x, y, z, s = 0) {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const tx = sm(x - x0), ty = sm(y - y0), tz = sm(z - z0);
  const h = (i, j, k) => hash(x0 + i + (z0 + k) * 7919, y0 + j, s);
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), tx), lerp(h(0, 1, 0), h(1, 1, 0), tx), ty),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), tx), lerp(h(0, 1, 1), h(1, 1, 1), tx), ty),
    tz,
  );
}
export function fbm3(x, y, z, s = 0, oct = 3) {
  let a = 0.5, f = 1, v = 0, n = 0;
  for (let i = 0; i < oct; i++) { v += a * noise3(x * f, y * f, z * f, s + i * 31); n += a; a *= 0.5; f *= 2.03; }
  return v / n;
}
export function noise1(x, s = 0) {
  const x0 = Math.floor(x);
  return lerp(hash(x0, 0, s), hash(x0 + 1, 0, s), sm(x - x0));
}

// 3×5 pixel font for diegetic signage, monitors and terminals.
const GLYPHS = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', ':': '000010000010000', '.': '000000000000010', '/': '001001010100100',
  '%': '101001010100101', '+': '000010111010000', ' ': '000000000000000', '>': '100010001010100', '_': '000000000000111',
};
export function text(ctx, str, x, y, c, a = 1) {
  ctx.fillStyle = css(c, a);
  let cx = Math.round(x);
  for (const ch of String(str).toUpperCase()) {
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(cx + (i % 3), Math.round(y) + Math.floor(i / 3), 1, 1);
    cx += 4;
  }
  return cx;
}
export const textWidth = (str) => String(str).length * 4 - 1;
