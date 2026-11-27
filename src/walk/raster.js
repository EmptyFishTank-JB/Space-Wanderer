// A small software rasterizer for walking the ship, in the same spirit as the
// hull cameras' renderer (src/render/hull3d.js): triangles straight into the
// 320×180 framebuffer with a depth buffer, the same focal length and the same
// camera basis, so the sky and the hull drawn behind line up with it. This
// one also maps textures (perspective-correct, nearest texel, so the pixels
// stay pixels) with an alpha test, so a wall can have a door or a window cut
// out of it and show what lies beyond. No DOM: the frame is a typed array.
import { W, H } from '../render/gfx.js';
import { FOCAL } from '../render/celestial.js';

export const NEAR = 0.05;

/** Pack an [r, g, b] (0..255) and alpha into one little-endian RGBA word. */
export const pack = (c, a = 255) => ((a & 255) << 24) | ((Math.max(0, Math.min(255, c[2] | 0)) & 255) << 16) | ((Math.max(0, Math.min(255, c[1] | 0)) & 255) << 8) | (Math.max(0, Math.min(255, c[0] | 0)) & 255);

export class Raster {
  constructor(w = W, h = H) {
    this.w = w; this.h = h;
    this.buf = new ArrayBuffer(w * h * 4);
    this.color = new Uint32Array(this.buf);
    this.bytes = new Uint8ClampedArray(this.buf);
    this.depth = new Float32Array(w * h); // 1/z: 0 is infinitely far
    this.hit = null;
  }

  /** Start a frame from an eye { at: [x, y, z], yaw, pitch } (yaw + toward starboard, pitch + up). */
  begin(eye) {
    this.color.fill(0);
    this.depth.fill(0);
    this.hit = null;
    const cp = Math.cos(eye.pitch), f = [cp * Math.cos(eye.yaw), cp * Math.sin(eye.yaw), Math.sin(eye.pitch)];
    let r = [-f[1], f[0], 0];
    const rl = Math.hypot(r[0], r[1]) || 1; r = [r[0] / rl, r[1] / rl, 0];
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    this.eye = eye; this.f = f; this.r = r; this.u = u; this.at = eye.at;
    this.cx = this.w >> 1; this.cy = this.h >> 1;
  }

  /** A ship-frame point in view space: [right, up, forward]. */
  view(p) {
    const a = this.at, dx = p[0] - a[0], dy = p[1] - a[1], dz = p[2] - a[2], r = this.r, u = this.u, f = this.f;
    return [dx * r[0] + dy * r[1] + dz * r[2], dx * u[0] + dy * u[1] + dz * u[2], dx * f[0] + dy * f[1] + dz * f[2]];
  }

  /** Where a ship-frame point lands on screen, or null behind the eye. */
  project(p) {
    const v = this.view(p);
    if (v[2] < NEAR) return null;
    return { x: this.w / 2 + (FOCAL * v[0]) / v[2], y: this.h / 2 - (FOCAL * v[1]) / v[2], z: v[2] };
  }

  /**
   * A convex polygon (ship-frame points, each optionally with a texel
   * [u, v]) in one material: { tex: { w, h, data: Uint32Array, wrap }, shade }
   * or { color: packed }. `id` is reported if it ends up under the crosshair.
   */
  poly(pts, uvs, mat, id = null) {
    // into view space, then clip against the near plane, carrying the texels along
    let P = pts.map((p, i) => { const v = this.view(p); return [v[0], v[1], v[2], uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0]; });
    if (P.every((v) => v[2] < NEAR)) return;
    if (P.some((v) => v[2] < NEAR)) {
      const out = [];
      for (let i = 0; i < P.length; i++) {
        const A = P[i], B = P[(i + 1) % P.length];
        if (A[2] >= NEAR) out.push(A);
        if ((A[2] >= NEAR) !== (B[2] >= NEAR)) { const s = (NEAR - A[2]) / (B[2] - A[2]); out.push(A.map((v, k) => v + (B[k] - v) * s)); }
      }
      P = out;
      if (P.length < 3) return;
    }
    const hw = this.w / 2, hh = this.h / 2;
    const S = P.map(([x, y, z, u, v]) => { const iz = 1 / z; return [hw + FOCAL * x * iz, hh - FOCAL * y * iz, iz, u * iz, v * iz]; });
    // quick reject off screen
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of S) { if (s[0] < x0) x0 = s[0]; if (s[0] > x1) x1 = s[0]; if (s[1] < y0) y0 = s[1]; if (s[1] > y1) y1 = s[1]; }
    if (x1 < 0 || y1 < 0 || x0 >= this.w || y0 >= this.h) return;
    for (let i = 1; i < S.length - 1; i++) this.tri(S[0], S[i], S[i + 1], mat, id);
  }

  tri(a, b, c, mat, id) {
    let area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    if (area < 0) { const t = b; b = c; c = t; area = -area; }
    const w = this.w, h = this.h;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (minX > maxX || minY > maxY) return;
    // edge functions: e0 for edge b→c (weight of a), e1 for c→a (weight of b); each linear in x and y
    const e0dx = -(c[1] - b[1]), e1dx = -(a[1] - c[1]), e2dx = -(b[1] - a[1]);
    const ia = 1 / area;
    const color = this.color, depth = this.depth;
    const tex = mat.tex, flat = mat.color;
    const tw = tex ? tex.w : 0, th = tex ? tex.h : 0, td = tex ? tex.data : null, wrap = tex ? !!tex.wrap : false;
    const sh = Math.round((mat.shade ?? 1) * 256);
    const cx = this.cx, cy = this.cy;
    const EPS = -1e-4;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5, px0 = minX + 0.5;
      let e0 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px0 - b[0]);
      let e1 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px0 - c[0]);
      let e2 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px0 - a[0]);
      let k = y * w + minX;
      for (let x = minX; x <= maxX; x++, k++, e0 += e0dx, e1 += e1dx, e2 += e2dx) {
        if (e0 * ia < EPS || e1 * ia < EPS || e2 * ia < EPS) continue;
        const w0 = e0 * ia, w1 = e1 * ia, w2 = 1 - w0 - w1;
        const iz = w0 * a[2] + w1 * b[2] + w2 * c[2];
        if (iz <= depth[k]) continue;
        let px;
        let tu = 0, tv = 0;
        if (td) {
          tu = (w0 * a[3] + w1 * b[3] + w2 * c[3]) / iz;
          tv = (w0 * a[4] + w1 * b[4] + w2 * c[4]) / iz;
          let ix = tu | 0, iy = tv | 0;
          if (wrap) { ix %= tw; if (ix < 0) ix += tw; iy %= th; if (iy < 0) iy += th; }
          else { if (ix < 0) ix = 0; else if (ix >= tw) ix = tw - 1; if (iy < 0) iy = 0; else if (iy >= th) iy = th - 1; }
          const t = td[iy * tw + ix];
          if ((t >>> 24) < 128) continue; // a hole: a door, a window, an empty corner of a sprite
          px = sh >= 256 ? t | 0xff000000 : 0xff000000 | ((((t >>> 16) & 255) * sh >> 8) << 16) | ((((t >>> 8) & 255) * sh >> 8) << 8) | (((t & 255) * sh) >> 8);
        } else px = flat;
        depth[k] = iz;
        color[k] = px;
        if (x === cx && y === cy) this.hit = { id, u: tu, v: tv, z: 1 / iz };
      }
    }
  }
}
