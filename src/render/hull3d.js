// The hull cameras see the real ship: a small software renderer that draws the
// 3D layout (data/ship3d.json) from each camera's own mount, so every view
// shows the same hull, housings, tines, windows, radiators, nozzles, turrets,
// pods, antennas and gear as the design, in the right place. Flat-shaded
// triangles into the 320×180 framebuffer with a depth buffer; the sky (or the
// ground) drawn behind it shows wherever there is no ship.
import { W, H, mix, mul, css } from './gfx.js';
import { FOCAL } from './celestial.js';
import { hullParts, station, profile, partY, moduleExtent, windowQuads, insideHull } from '../ship3d/geometry.js';

let MODEL = null;
/** Hand the renderer the 3D layout once it has loaded. */
export function setShipModel(ship3d) { MODEL = ship3d ? buildModel(ship3d) : null; }
export const shipModel = () => MODEL;

const ROLE_C = {
  hab: [79, 179, 191], life: [102, 181, 108], service: [140, 153, 163], passage: [93, 108, 116], power: [224, 160, 58], drive: [110, 114, 180],
  fuel: [91, 155, 224], thermal: [64, 66, 74], sensor: [150, 152, 158], science: [185, 138, 211], rover: [214, 172, 52], weapon: [178, 58, 72],
  utility: [168, 120, 62], shield: [102, 174, 240], security: [140, 80, 96],
};
const HULL = [104, 108, 116];
const GLASS = [64, 112, 132];
const LIT = [255, 210, 150];

// ───────── the mesh ─────────
function buildModel(ship) {
  const tris = []; // { a, b, c (ship-frame points), part, kind, color, n }
  const parts = {}; // part id -> { name, kind, ref }
  const add = (part, kind, color, a, b, c) => tris.push({ a, b, c, part, kind, color });
  const quad = (part, kind, color, a, b, c, d) => { add(part, kind, color, a, b, c); add(part, kind, color, a, c, d); };

  // hull parts: lofted rings, the same way the 3D viewer builds them
  for (const p of hullParts(ship)) {
    const id = `hull:${p.id}`;
    parts[id] = { name: p.name || 'Hull', kind: 'hull', ref: p };
    const xsP = [...p.stations.map((s) => s.x), ...(p.glass ? p.glass.x : [])];
    const xMax = Math.max(...xsP), xMin = Math.min(...xsP);
    for (let x = Math.floor(xMax / 2) * 2; x > xMin; x -= 2) if (x < xMax - 0.3) xsP.push(x);
    const xs = [...new Set(xsP)].sort((a, b) => b - a);
    const rings = xs.map((x) => { const st = station(p.stations, x); return { x, st, pts: profile(p.profile, st).map(([y, z]) => [x, y + partY(p, st), z]) }; });
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], B = rings[k + 1], n = A.pts.length;
      const glazed = p.glass && A.x > p.glass.x[0] + 0.01 && A.x <= p.glass.x[1] + 0.01;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const g = glazed && (A.pts[i][2] + A.pts[j][2]) / 2 > A.st.zk + p.glass.above;
        // plating panels: alternate rings and edges a shade apart, so a flat surface still reads in perspective
        const panel = mul(HULL, 1 + 0.05 * (((k >> 1) + i) % 2 ? 1 : -1));
        quad(id, g ? 'glass' : 'hull', g ? GLASS : panel, A.pts[i], A.pts[j], B.pts[j], B.pts[i]);
      }
    }
    for (const R of [rings[0], rings[rings.length - 1]]) {
      const c = R.pts.reduce((a, q) => [a[0] + q[0] / R.pts.length, a[1] + q[1] / R.pts.length, a[2] + q[2] / R.pts.length], [0, 0, 0]);
      for (let i = 0; i < R.pts.length; i++) add(id, 'hull', HULL, c, R.pts[i], R.pts[(i + 1) % R.pts.length]);
    }
  }
  // windows, a few centimeters proud of the skin
  for (const w of ship.windows || []) {
    const id = `win:${w.id}`;
    parts[id] = { name: w.name, kind: 'window', ref: w };
    for (const q of windowQuads(ship, w, 1)) {
      if (w.cap) { const o = (p) => [p[0] + 0.05, p[1], p[2]]; quad(id, 'window', GLASS, o(q[0]), o(q[1]), o(q[2]), o(q[3])); }
      else quad(id, 'window', GLASS, ...q);
    }
  }
  // the machinery that shows outside the skin
  const box = (id, color, x, y, z, kind = 'module') => {
    const P = (i, j, k) => [x[i], y[j], z[k]];
    quad(id, kind, color, P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)); quad(id, kind, color, P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1));
    quad(id, kind, color, P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)); quad(id, kind, color, P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1));
    quad(id, kind, color, P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1)); quad(id, kind, color, P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1));
  };
  const cyl = (id, color, axis, c, r, span, n = 12, kind = 'module') => {
    // axis 'x' or 'z'; c the center of the other two coordinates
    const ring = (t) => Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return axis === 'x' ? [t, c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] : [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), t]; });
    const A = ring(span[0]), B = ring(span[1]);
    const ca = axis === 'x' ? [span[0], c[0], c[1]] : [c[0], c[1], span[0]], cb = axis === 'x' ? [span[1], c[0], c[1]] : [c[0], c[1], span[1]];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; quad(id, kind, color, A[i], A[j], B[j], B[i]); add(id, kind, color, ca, A[j], A[i]); add(id, kind, color, cb, B[i], B[j]); }
  };
  const corners = (e) => { const out = []; for (const x of e.x) for (const y of e.y) for (const z of e.z) out.push([x, y, z]); return out; };
  for (const m of ship.modules || []) {
    if (m.inRoom || m.shape === 'ring' || m.shape === 'shell') continue;
    const e = moduleExtent(m);
    if (!corners(e).some((p) => !insideHull(ship, ...p))) continue; // wholly inside the hull: never seen
    const id = `mod:${m.id}`;
    parts[id] = { name: m.name, kind: 'module', ref: m };
    const kind = /^(nozzle_|engine_)/.test(m.id) ? 'nozzle' : m.role === 'thermal' ? 'radiator' : /^gear_/.test(m.id) ? 'gear' : 'module';
    const color = kind === 'nozzle' ? [92, 96, 150] : ROLE_C[m.role] || ROLE_C.service;
    if (m.shape === 'box' || m.shape === 'rcs') box(id, m.shape === 'rcs' ? [150, 152, 170] : color, m.x, m.y, m.z, kind);
    else if (m.shape === 'cyl-x') cyl(id, color, 'x', [m.y, m.z], m.r, m.x, 12, kind);
    else if (m.shape === 'cyl-z') cyl(id, color, 'z', [m.x, m.y], m.r, m.z, 10, kind);
    else if (m.shape === 'turret') {
      const up = m.mount === 'top' ? 1 : -1, base = up > 0 ? m.z[0] : m.z[1], h = m.z[1] - m.z[0];
      cyl(id, ROLE_C.service, 'z', [m.x, m.y], m.r, [base, base + up * h * 0.4].sort((a, b) => a - b), 10);
      const zz = up > 0 ? [base + h * 0.4, base + h] : [base - h, base - h * 0.4];
      box(id, color, [m.x - m.r * 0.7, m.x + m.r * 0.8], [m.y - m.r * 0.6, m.y + m.r * 0.6], zz);
      for (const dy of [-0.28, 0.28]) box(id, [40, 42, 48], [m.x + m.r * 0.8, m.x + m.r * 3], [m.y + dy * m.r - 0.06 * m.r, m.y + dy * m.r + 0.06 * m.r], [base + up * h * 0.66, base + up * h * 0.74].sort((a, b) => a - b));
    } else if (m.shape === 'rod') {
      // a thin square tube from root to tip
      const [a, b] = [m.from, m.to], d = b.map((v, i) => v - a[i]), L = Math.hypot(...d) || 1, u = d.map((v) => v / L);
      const s1 = Math.abs(u[2]) < 0.9 ? [-u[1], u[0], 0] : [0, -u[2], u[1]], l1 = Math.hypot(...s1); const v1 = s1.map((v) => (v / l1) * m.r);
      const v2 = [u[1] * v1[2] - u[2] * v1[1], u[2] * v1[0] - u[0] * v1[2], u[0] * v1[1] - u[1] * v1[0]];
      const P = (p, s, t) => p.map((x, i) => x + s * v1[i] + t * v2[i]);
      const sq = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      for (let i = 0; i < 4; i++) { const [s, t] = sq[i], [s2, t2] = sq[(i + 1) % 4]; quad(id, kind, color, P(a, s, t), P(a, s2, t2), P(b, s2, t2), P(b, s, t)); }
    } else if (m.shape === 'dish') {
      const n = 12, c = [m.x, m.y, m.z + m.r * 0.9];
      const L = Math.hypot(...m.look), f = m.look.map((v) => v / L);
      const s1 = Math.abs(f[2]) < 0.9 ? [-f[1], f[0], 0] : [0, -f[2], f[1]], l1 = Math.hypot(...s1), e1 = s1.map((v) => v / l1);
      const e2 = [f[1] * e1[2] - f[2] * e1[1], f[2] * e1[0] - f[0] * e1[2], f[0] * e1[1] - f[1] * e1[0]];
      const rim = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2; return c.map((v, k) => v + f[k] * m.r * 0.5 + m.r * (Math.cos(a) * e1[k] + Math.sin(a) * e2[k])); });
      for (let i = 0; i < n; i++) add(id, kind, [170, 174, 180], c, rim[i], rim[(i + 1) % n]);
      cyl(id, ROLE_C.service, 'z', [m.x, m.y], 0.15, [m.z, c[2]], 6);
    } else if (m.shape === 'prism' || m.shape === 'frame') {
      const out = m.outline;
      const inner = m.shape === 'frame' ? (() => { const cy = (m.y[0] + m.y[1]) / 2, cz = (m.z[0] + m.z[1]) / 2, hy = (m.y[1] - m.y[0]) / 2, hz = (m.z[1] - m.z[0]) / 2; return out.map(([y, z]) => [cy + (y - cy) * (1 - m.width / hy), cz + (z - cz) * (1 - m.width / hz)]); })() : null;
      const P = (x, [y, z]) => [x, y, z];
      for (let i = 0; i < out.length; i++) {
        const j = (i + 1) % out.length;
        quad(id, kind, color, P(m.x[0], out[i]), P(m.x[0], out[j]), P(m.x[1], out[j]), P(m.x[1], out[i]));
        if (inner) {
          quad(id, kind, color, P(m.x[0], inner[i]), P(m.x[0], inner[j]), P(m.x[1], inner[j]), P(m.x[1], inner[i]));
          for (const x of m.x) quad(id, kind, color, P(x, out[i]), P(x, out[j]), P(x, inner[j]), P(x, inner[i]));
        }
      }
      if (!inner) { const c = out.reduce((a, q) => [a[0] + q[0] / out.length, a[1] + q[1] / out.length], [0, 0]); for (const x of m.x) for (let i = 0; i < out.length; i++) add(id, kind, color, P(x, c), P(x, out[i]), P(x, out[(i + 1) % out.length])); }
    }
  }
  // the rover bay platform (drawn lowered when the rover is out on the ground)
  const lift = (ship.shafts || []).find((s) => s.id === 'rover_lift');
  const roverM = (ship.modules || []).find((m) => m.id === 'rover');
  const extra = { lift, rover: roverM && { size: [roverM.x[1] - roverM.x[0], roverM.y[1] - roverM.y[0], roverM.z[1] - roverM.z[0]] }, beacon: (() => { const m = (ship.modules || []).find((q) => q.id === 'mast'); return m ? [m.x, m.y, m.z[1] + 0.2] : null; })() };
  for (const t of tris) {
    const u = t.b.map((v, i) => v - t.a[i]), v = t.c.map((x, i) => x - t.a[i]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1;
    t.n = n.map((q) => q / l);
  }
  const cams = Object.fromEntries(((ship.cameras && ship.cameras.exterior) || []).map((c) => [c.id, c]));
  return { tris, parts, cams, extra };
}

// ───────── the raster ─────────
const zbuf = new Float32Array(W * H);
const idbuf = new Int32Array(W * H);
let img = null, layer = null;
const NEAR = 0.3;
const LIGHT = (() => { const l = [0.35, -0.45, 0.82]; const n = Math.hypot(...l); return l.map((v) => v / n); })();

/** Yaw (+ starboard) and pitch (+ up) a camera looks along, for the sky behind the ship. */
export function camAngles(cam) {
  const [x, y, z] = cam.look;
  return { yaw: Math.atan2(y, x), pitch: Math.atan2(z, Math.hypot(x, y)) };
}

/**
 * Draw the ship from camera `cam` (a ship3d camera: { at, look }) over what is
 * already on ctx. o: { heat, wear, drive, shut, lit, gearDown, roverOut, roverX,
 * beacon, landed }. Returns the visible parts' screen boxes for selection.
 */
export function renderShip(ctx, cam, o = {}) {
  const M = MODEL;
  if (!M) return [];
  if (!img) { img = new ImageData(W, H); layer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H }); }
  const px = img.data;
  px.fill(0);
  zbuf.fill(Infinity);
  idbuf.fill(-1);
  // camera basis: forward along look, right to starboard, up
  const fl = Math.hypot(...cam.look), f = cam.look.map((v) => v / fl);
  let r = [-f[1], f[0], 0]; // cross(up, f) with up = +z
  const rl = Math.hypot(...r) || 1; r = r.map((v) => v / rl);
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const at = cam.at;
  const view = (p) => { const d = [p[0] - at[0], p[1] - at[1], p[2] - at[2]]; return [d[0] * r[0] + d[1] * r[1] + d[2] * r[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * f[0] + d[1] * f[1] + d[2] * f[2]]; };
  const partIdx = new Map();
  const partList = [];
  const idxOf = (id) => { let i = partIdx.get(id); if (i === undefined) { i = partList.length; partIdx.set(id, i); partList.push({ id, n: 0, x0: W, y0: H, x1: -1, y1: -1 }); } return i; };
  const wear = o.wear || 0;
  const hullC = mul(HULL, 1 - 0.25 * wear);
  const glow = Math.max(0, Math.min(1, ((o.heat || 0) - 0.4) * 1.8));

  const shade = (t) => {
    const lam = Math.abs(t.n[0] * LIGHT[0] + t.n[1] * LIGHT[1] + t.n[2] * LIGHT[2]);
    const k = 0.38 + 0.62 * lam;
    if (t.kind === 'window' || t.kind === 'glass') return o.shut ? mul(hullC, k * 0.9) : o.lit && t.kind === 'window' ? mix(LIT, mul(GLASS, k), 0.35) : mul(GLASS, 0.7 + 0.5 * k);
    if (t.kind === 'radiator') return glow > 0 ? mix(mul(t.color, k), [255, 150, 60], glow * 0.85) : mul(t.color, k);
    if (t.kind === 'nozzle') return o.drive > 0 ? mix(mul(t.color, k), [170, 200, 255], Math.min(1, o.drive)) : mul(t.color, k);
    if (t.kind === 'hull') return mul(t.color, k * (1 - 0.25 * wear));
    return mul(t.color, k);
  };

  const draw = (A, B, C, color, pi) => {
    // near-plane clip, then fan-triangulate
    let poly = [A, B, C];
    const clip = [];
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i], Q = poly[(i + 1) % poly.length];
      if (P[2] >= NEAR) clip.push(P);
      if ((P[2] >= NEAR) !== (Q[2] >= NEAR)) { const s = (NEAR - P[2]) / (Q[2] - P[2]); clip.push([P[0] + (Q[0] - P[0]) * s, P[1] + (Q[1] - P[1]) * s, NEAR]); }
    }
    if (clip.length < 3) return;
    const S = clip.map(([x, y, z]) => [W / 2 + (FOCAL * x) / z, H / 2 - (FOCAL * y) / z, z]);
    for (let i = 1; i < S.length - 1; i++) raster(S[0], S[i], S[i + 1], color, pi);
  };
  const raster = (a, b, c, color, pi) => {
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (minX > maxX || minY > maxY) return;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) return;
    const iz = [1 / a[2], 1 / b[2], 1 / c[2]];
    const R = Math.round(color[0]), G = Math.round(color[1]), Bc = Math.round(color[2]);
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const pxx = x + 0.5;
        const w0 = ((b[0] - pxx) * (c[1] - py) - (b[1] - py) * (c[0] - pxx)) / area;
        const w1 = ((c[0] - pxx) * (a[1] - py) - (c[1] - py) * (a[0] - pxx)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const z = 1 / (w0 * iz[0] + w1 * iz[1] + w2 * iz[2]);
        const k = y * W + x;
        if (z >= zbuf[k]) continue;
        zbuf[k] = z;
        idbuf[k] = pi;
        const q = k * 4;
        px[q] = R; px[q + 1] = G; px[q + 2] = Bc; px[q + 3] = 255;
      }
    }
  };

  // skip the part the camera is mounted on, if it would only fill the lens
  const mountedOn = (t) => t.kind !== 'hull' && t.kind !== 'window' && t.kind !== 'glass' && [t.a, t.b, t.c].every((p) => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) < 1.2);
  for (const t of M.tris) {
    if (t.kind === 'gear' && !o.gearDown) continue;
    if (mountedOn(t)) continue;
    const A = view(t.a), B = view(t.b), C = view(t.c);
    if (A[2] < NEAR && B[2] < NEAR && C[2] < NEAR) continue;
    draw(A, B, C, shade(t), idxOf(t.part));
  }
  // the rover bay platform down on the ground, and the rover out on the surface
  const ex = M.extra;
  const solid = (id, color, x, y, z) => {
    const P = (i, j, k) => [x[i], y[j], z[k]];
    const faces = [[P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)], [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)], [P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1)], [P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1)], [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)]];
    const shades = [0.55, 1, 0.8, 0.7, 0.65, 0.9];
    faces.forEach((q, i) => { const [a, b, c, d] = q.map(view); const col = mul(color, shades[i]); const pi = idxOf(id); draw(a, b, c, col, pi); draw(a, c, d, col, pi); });
  };
  if (o.landed && ex.lift && o.roverOut) {
    solid('lift:platform', [118, 120, 128], ex.lift.x, ex.lift.y, [ex.lift.z[0], ex.lift.z[0] + 0.3]);
    for (const jx of [ex.lift.x[0] + 0.4, ex.lift.x[1] - 0.6]) for (const jy of [ex.lift.y[0] + 0.4, ex.lift.y[1] - 0.6]) solid('lift:platform', [150, 152, 158], [jx, jx + 0.2], [jy, jy + 0.2], [ex.lift.z[0] + 0.3, ex.lift.z[1]]);
  }
  if (o.landed && o.roverOut && ex.rover && o.roverX > 3) {
    // the rover drives out forward and to port from under the ship
    const d = o.roverX, a = 0.55;
    const cx = -15.5 + d * Math.cos(a), cy = -10.3 - d * Math.sin(a), z0 = -9.8;
    const [lx, ly, lz] = ex.rover.size;
    solid('rover', ROLE_C.rover, [cx - lx / 2, cx + lx / 2], [cy - ly / 2, cy + ly / 2], [z0 + 0.6, z0 + lz]);
    for (const wx of [-lx / 2 + 0.8, 0, lx / 2 - 0.8]) for (const wy of [-ly / 2, ly / 2 - 0.4]) solid('rover', [28, 28, 32], [cx + wx - 0.55, cx + wx + 0.55], [cy + wy, cy + wy + 0.4], [z0, z0 + 1.1]);
  }
  // nav beacon on the mast head
  if (o.beacon && ex.beacon) {
    const p = view(ex.beacon);
    if (p[2] > NEAR) { const sx = Math.round(W / 2 + (FOCAL * p[0]) / p[2]), sy = Math.round(H / 2 - (FOCAL * p[1]) / p[2]); if (sx >= 0 && sx < W && sy >= 0 && sy < H && p[2] < zbuf[sy * W + sx] + 0.5) { const q = (sy * W + sx) * 4; px[q] = 255; px[q + 1] = 70; px[q + 2] = 50; px[q + 3] = 255; } }
  }
  // compose over the sky
  const lc = layer.getContext('2d');
  lc.putImageData(img, 0, 0);
  ctx.drawImage(layer, 0, 0);
  // where each part landed on screen, for selection
  for (let k = 0; k < W * H; k++) {
    const i = idbuf[k];
    if (i < 0) continue;
    const p = partList[i], x = k % W, y = (k / W) | 0;
    p.n++;
    if (x < p.x0) p.x0 = x; if (x > p.x1) p.x1 = x; if (y < p.y0) p.y0 = y; if (y > p.y1) p.y1 = y;
  }
  return partList.filter((p) => p.x1 >= p.x0 && p.n > 6).map((p) => ({ id: p.id, x: p.x0, y: p.y0, w: p.x1 - p.x0 + 1, h: p.y1 - p.y0 + 1, part: M.parts[p.id] || { name: p.id === 'rover' ? 'Surface rover' : 'Rover bay platform', kind: 'module' } }));
}

export { css };
