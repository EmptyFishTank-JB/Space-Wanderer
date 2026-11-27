// Walking the ship, drawn. Behind everything the sky (or the ground, or the
// hangar), drawn by the same routine as the hull cameras for the walker's
// own heading; over it the ship's hull from where the walker stands, facing
// faces only, so from inside it shows only through the glass; over that the
// rooms in view, rasterized with their own textures (see textures.js): the
// room the walker is in, and whatever shows through an open door, a hatch, a
// grille or a skylight. People are drawn by the feeds' figure routine as
// sprites standing where the sim has them. Then a small HUD in the feeds'
// pixel font.
import { W, H, PPM, CEIL, rect, text, textWidth, mix, mul, css } from '../render/gfx.js';
import { drawSpaceScene } from '../render/celestial.js';
import { drawSurfaceScene } from '../render/terrain.js';
import { renderShip } from '../render/hull3d.js';
import { travelerPose } from '../render/actor.js';
import { roomLight } from '../render/feed.js';
import { isShut } from '../render/shutters.js';
import { activityLabel } from '../ui/telemetry-model.js';
import { Raster, pack } from './raster.js';
import { TextureStore, personSprite, BAND, FPPM } from './textures.js';
import { roomPoint, DOOR_W, DOOR_H, PROP_DEPTH } from './world.js';

const ROLE_C = {
  hab: [79, 179, 191], life: [102, 181, 108], service: [140, 153, 163], passage: [93, 108, 116], power: [224, 160, 58], drive: [110, 114, 180],
  fuel: [91, 155, 224], thermal: [64, 66, 74], sensor: [150, 152, 158], science: [185, 138, 211], rover: [214, 172, 52], weapon: [178, 58, 72],
  utility: [168, 120, 62], shield: [102, 174, 240], security: [140, 80, 96],
};
const LIGHT = (() => { const l = [0.3, -0.4, 0.86]; const n = Math.hypot(...l); return l.map((v) => v / n); })();
const STEEL = [120, 124, 130], FRAME = [40, 42, 46], ARMOR = [62, 64, 70];
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const normalOf = (p) => { const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]; const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; return n.map((q) => q / l); };
const flatShade = (pts, c, k = 1) => pack(mul(c, k * (0.55 + 0.45 * Math.abs(normalOf(pts).reduce((a, v, i) => a + v * LIGHT[i], 0)))));

function boxFaces(x, y, z) {
  const P = (i, j, k) => [x[i], y[j], z[k]];
  return [[P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0)], [P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)], [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)],
    [P(0, 1, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1, 1)], [P(0, 0, 0), P(0, 1, 0), P(0, 1, 1), P(0, 0, 1)], [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)]];
}
function cylFaces(cx, cy, r, z, n = 14) {
  const ring = (zz) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2), zz]);
  const A = ring(z[0]), B = ring(z[1]);
  const out = [];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; out.push([A[i], A[j], B[j], B[i]]); }
  out.push(B.slice().reverse());
  return out;
}

/** The glass of a window, as the strip of hull it lies on: is this point on it? */
function onGlass(quads, p, tol = 0.34) {
  for (const q of quads) {
    const xa = q[0][0], xb = q[3][0];
    if (p[0] < Math.min(xa, xb) - 0.02 || p[0] > Math.max(xa, xb) + 0.02) continue;
    const t = Math.abs(xb - xa) < 1e-6 ? 0 : (p[0] - xa) / (xb - xa);
    const a = lerp3(q[0], q[3], t), b = lerp3(q[1], q[2], t);
    const dy = b[1] - a[1], dz = b[2] - a[2], L2 = dy * dy + dz * dz || 1;
    const s = Math.max(0, Math.min(1, ((p[1] - a[1]) * dy + (p[2] - a[2]) * dz) / L2));
    if (Math.hypot(p[1] - (a[1] + dy * s), p[2] - (a[2] + dz * s)) < tol) return true;
  }
  return false;
}

/** Interval [a, b] with the given intervals taken out. */
function subtract(a, b, cuts) {
  let segs = [[a, b]];
  for (const [c0, c1] of cuts) segs = segs.flatMap(([s0, s1]) => (c1 <= s0 || c0 >= s1 ? [[s0, s1]] : [[s0, Math.max(s0, c0)], [Math.min(s1, c1), s1]].filter(([u, v]) => v - u > 0.01)));
  return segs;
}

export class WalkView {
  constructor(world, data) {
    this.world = world;
    this.data = data;
    this.raster = new Raster();
    this.tex = new TextureStore(world, data);
    this.layer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    this.img = new ImageData(this.raster.bytes, W, H);
    this.geo = new Map(); // room -> static geometry
    this.ductGeo = new Map();
    this.shutters = new Map(); // window id -> 0 open .. 1 closed (animated)
    this.windowIds = [...new Set(Object.values(world.rooms).flatMap((r) => [...r.bays.map((b) => b.win), ...['x0', 'x1', 'y0', 'y1'].flatMap((s) => r.openings[s].filter((o) => o.win).map((o) => o.win.id))]))];
    this.look = null;
    this.mapOn = false;
    this.helpUntil = 0;
  }

  // ───────── static geometry, built once per room ─────────
  roomGeo(r) {
    let g = this.geo.get(r.id);
    if (g) return g;
    g = { bays: [], solids: [], ladders: [], lifts: [], winPlates: [] };
    const th = this.tex.theme(r);
    // bays and skylight wells: the hull's own section, the glass left open (or plated when the shutters close)
    for (const b of r.bays) {
      const wallY = b.kind === 'bay' ? (b.side > 0 ? r.y[1] : r.y[0]) : null, zc = r.z[1];
      const P = (x, [y, z]) => [x, y, z];
      const onOpening = (p, q) => (b.kind === 'bay' ? Math.abs(p[1] - wallY) < 0.03 && Math.abs(q[1] - wallY) < 0.03 : Math.abs(p[2] - zc) < 0.03 && Math.abs(q[2] - zc) < 0.03);
      const zs = b.glass.flat().map((q) => q[2]);
      const gz = [Math.min(...zs), Math.max(...zs)];
      const S0 = b.slices;
      for (let i = 0; i < S0.length - 1; i++) {
        const A = S0[i], B = S0[i + 1];
        if (A.poly.length !== B.poly.length) continue;
        for (let k = 0; k < A.poly.length; k++) {
          const k2 = (k + 1) % A.poly.length;
          const a = P(A.x, A.poly[k]), bb = P(A.x, A.poly[k2]), c = P(B.x, B.poly[k2]), d = P(B.x, B.poly[k]);
          if (onOpening(a, bb)) continue;
          const n = Math.max(1, Math.ceil(Math.hypot(bb[1] - a[1], bb[2] - a[2]) / 0.3));
          for (let j = 0; j < n; j++) {
            const p0 = lerp3(a, bb, j / n), p1 = lerp3(a, bb, (j + 1) / n), p2 = lerp3(d, c, (j + 1) / n), p3 = lerp3(d, c, j / n);
            const ctr = lerp3(lerp3(p0, p2, 0.5), lerp3(p1, p3, 0.5), 0.5);
            const glass = onGlass(b.glass, ctr);
            const pts = [p0, p1, p2, p3];
            g.bays.push({ pts, glass, win: b.win, zf: glass ? (gz[1] - ctr[2]) / Math.max(0.1, gz[1] - gz[0]) : 0, color: flatShade(pts, mul(th.trim, 1.15)), name: b.name, info: b.info });
          }
        }
      }
      for (const Q of [S0[0], S0[S0.length - 1]]) {
        const pts = Q.poly.map((p) => P(Q.x, p));
        g.bays.push({ pts, glass: false, color: flatShade(pts, mul(th.trim, 1.05)), name: b.name, info: b.info });
      }
    }
    // the plate for a window set in a wall, or a canopy, when its shutters close
    for (const side of ['x0', 'x1', 'y0', 'y1']) {
      const w = r.walls.find((q) => q.side === side);
      for (const o of r.openings[side]) {
        if (o.kind !== 'window' && o.kind !== 'canopy') continue;
        const at = (s, z) => [w.a[0] + w.dir[0] * s + w.n[0] * 0.03, w.a[1] + w.dir[1] * s + w.n[1] * 0.03, r.z[0] + z];
        g.winPlates.push({ id: o.win.id, at, o, name: o.win.name, info: o.win.info });
      }
    }
    // pony walls and rails, machinery
    for (const s of r.solids) {
      if (s.kind === 'pony' || s.kind === 'rail') { for (const f of boxFaces(s.x, s.y, s.z)) g.solids.push({ pts: f, color: flatShade(f, s.color === 'trim' ? mul(th.trim, 1.1) : s.color), name: s.kind === 'pony' ? 'Pony wall and rail' : 'Rail', info: 'Keeps people off the glass of the window bay.' }); continue; }
      const m = s.module, col = ROLE_C[m.role] || ROLE_C.service;
      const faces = [];
      if (m.shape === 'cyl-z') faces.push(...cylFaces(m.x, m.y, m.r, s.z));
      else if (m.shape === 'ring') {
        const zc = (s.z[0] + s.z[1]) / 2;
        faces.push(...cylFaces(m.x, m.y, m.r * 0.26, s.z, 10));
        for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2, R = m.r * 0.78; faces.push(...boxFaces([m.x + R * Math.cos(a) - 0.25, m.x + R * Math.cos(a) + 0.25], [m.y + R * Math.sin(a) - 0.25, m.y + R * Math.sin(a) + 0.25], [zc - m.r * 0.18, zc + m.r * 0.18])); }
      } else if (m.shape === 'skiff' || m.shape === 'rover') {
        const mid = (q) => (q[0] + q[1]) / 2;
        faces.push(...boxFaces([m.x[0] + 0.4, m.x[1] - 0.3], [m.y[0] + 0.3, m.y[1] - 0.3], [m.z[0] + 0.7, m.z[1] - 0.4]));
        faces.push(...boxFaces([m.x[1] - 2.2, m.x[1] - 0.5], [mid(m.y) - 0.7, mid(m.y) + 0.7], [m.z[1] - 0.45, m.z[1]]));
        for (const wx of [m.x[0] + 0.9, mid(m.x), m.x[1] - 0.9]) for (const wy of [m.y[0], m.y[1] - 0.45]) faces.push(...boxFaces([wx - 0.55, wx + 0.55], [wy, wy + 0.45], [m.z[0], m.z[0] + 1.1]));
      } else faces.push(...boxFaces(s.x, s.y, s.z));
      for (const f of faces) g.solids.push({ pts: f, color: flatShade(f, col), name: s.name, info: s.info });
    }
    // ladders in the room's wells, and the lift car's walls
    for (const sh of r.shafts) {
      const clip = (b) => ({ ...b, z: [Math.max(b.z[0], r.z[0] - 1.5), Math.min(b.z[1], r.z[1] + 1.5)] });
      for (const b of [...sh.parts.rails, ...sh.parts.rungs]) if (b.z[1] > r.z[0] - 1.5 && b.z[0] < r.z[1] + 1.5) for (const f of boxFaces(b.x, b.y, clip(b).z)) g.ladders.push({ pts: f, color: flatShade(f, STEEL), name: sh.name, info: sh.info });
      for (const b of sh.parts.frames) if (b.z[1] > r.z[0] - 0.2 && b.z[0] < r.z[1] + 0.2) for (const f of boxFaces(b.x, b.y, b.z)) g.ladders.push({ pts: f, color: flatShade(f, [200, 160, 60], 0.8), name: sh.name, info: sh.info });
      if (sh.kind === 'lift' && sh.x[0] < r.x[1] && sh.x[1] > r.x[0] && sh.y[0] < r.y[1] && sh.y[1] > r.y[0]) g.lifts.push(sh); // a car standing in the room
    }
    // a ladder well's own walls, in the voids between the decks it joins
    g.wells = [];
    for (const sh of r.shafts) {
      if (sh.kind !== 'ladder' || !sh.stops) continue;
      const stops = sh.stops.map((id) => this.world.rooms[id]);
      const voids = subtract(sh.z[0], sh.z[1], stops.map((q) => q.z));
      for (const [za, zb] of voids) for (const [p, q] of [[[sh.x[0], sh.y[0]], [sh.x[1], sh.y[0]]], [[sh.x[1], sh.y[0]], [sh.x[1], sh.y[1]]], [[sh.x[1], sh.y[1]], [sh.x[0], sh.y[1]]], [[sh.x[0], sh.y[1]], [sh.x[0], sh.y[0]]]]) {
        g.wells.push({ pts: [[p[0], p[1], za], [q[0], q[1], za], [q[0], q[1], zb], [p[0], p[1], zb]], uv: [[0, (zb - za) * 32], [29, (zb - za) * 32], [29, 0], [0, 0]], name: sh.name, info: sh.info });
      }
    }
    this.geo.set(r.id, g);
    return g;
  }

  ductGeoOf(d) {
    let g = this.ductGeo.get(d.id);
    if (g) return g;
    g = { polys: [], grilles: [], rungs: [] };
    const zf = d.floor, zt = d.top;
    for (const sg of d.segs) {
      const ax = sg.alongX ? 0 : 1;
      const lo = sg.box[ax === 0 ? 'x' : 'y'][0], hi = sg.box[ax === 0 ? 'x' : 'y'][1], cr = sg.box[ax === 0 ? 'y' : 'x'];
      const P = (a, c, z) => (ax === 0 ? [a, c, z] : [c, a, z]);
      const overl = (b) => b.x[0] < sg.box.x[1] - 0.01 && b.x[1] > sg.box.x[0] + 0.01 && b.y[0] < sg.box.y[1] - 0.01 && b.y[1] > sg.box.y[0] + 0.01;
      const along = (b) => [Math.max(lo, b[ax === 0 ? 'x' : 'y'][0]), Math.min(hi, b[ax === 0 ? 'x' : 'y'][1])];
      const others = d.segs.filter((q) => q !== sg && overl(q.box)).map((q) => q.box);
      const vents = d.vents.filter((v) => overl(v));
      const grFloor = d.grilles.filter((q) => q.where === 'ceiling' && overl(q)), grTop = d.grilles.filter((q) => q.where === 'floor' && overl(q));
      // the floor and roof of the run, with holes where a grille or a vent shaft is
      for (const [z, grs] of [[zf, grFloor], [zt, grTop]]) {
        const cuts = [...grs.map(along), ...vents.map(along)];
        for (const [a0, a1] of subtract(lo, hi, cuts)) g.polys.push({ pts: [P(a0, cr[0], z), P(a1, cr[0], z), P(a1, cr[1], z), P(a0, cr[1], z)], uv: [[a0 * 32, 0], [a1 * 32, 0], [a1 * 32, 29], [a0 * 32, 29]], shade: z === zf ? 0.62 : 0.45 });
        for (const q of grs) { const [a0, a1] = along(q); g.grilles.push({ pts: [P(a0, cr[0], z), P(a1, cr[0], z), P(a1, cr[1], z), P(a0, cr[1], z)], uv: [[a0 * 16, 0], [a1 * 16, 0], [a1 * 16, 14], [a0 * 16, 14]], room: q.room }); }
      }
      // the sides, open where another run joins
      for (const [ci, c] of [[0, cr[0]], [1, cr[1]]]) {
        const cuts = others.filter((b) => (ci === 0 ? b[ax === 0 ? 'y' : 'x'][0] < c - 0.05 : b[ax === 0 ? 'y' : 'x'][1] > c + 0.05)).map(along);
        for (const [a0, a1] of subtract(lo, hi, cuts)) g.polys.push({ pts: [P(a0, c, zf), P(a1, c, zf), P(a1, c, zt), P(a0, c, zt)], uv: [[a0 * 32, 29], [a1 * 32, 29], [a1 * 32, 0], [a0 * 32, 0]], shade: 0.52 });
      }
      // the ends, unless something carries on
      for (const a of [lo, hi]) {
        const open = [...others, ...vents].some((b) => { const r2 = b[ax === 0 ? 'x' : 'y']; return r2[0] <= a + 0.05 && r2[1] >= a - 0.05; });
        if (!open) g.polys.push({ pts: [P(a, cr[0], zf), P(a, cr[1], zf), P(a, cr[1], zt), P(a, cr[0], zt)], uv: [[0, 29], [29, 29], [29, 0], [0, 0]], shade: 0.4 });
      }
    }
    // the vent shafts' walls between the duct levels, and their rungs
    for (const v of d.vents) {
      const levels = v.levels.map((id) => this.world.ducts.find((q) => q.id === id));
      const spans = subtract(v.z[0], v.z[1], levels.map((q) => [q.floor, q.top]));
      for (const [z0, z1] of spans) for (const [p, q] of [[[v.x[0], v.y[0]], [v.x[1], v.y[0]]], [[v.x[1], v.y[0]], [v.x[1], v.y[1]]], [[v.x[1], v.y[1]], [v.x[0], v.y[1]]], [[v.x[0], v.y[1]], [v.x[0], v.y[0]]]]) {
        g.polys.push({ pts: [[p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]], uv: [[0, (z1 - z0) * 32], [29, (z1 - z0) * 32], [29, 0], [0, 0]], shade: 0.42 });
      }
      for (const b of [...v.parts.rails, ...v.parts.rungs]) for (const f of boxFaces(b.x, b.y, b.z)) g.rungs.push({ pts: f, color: flatShade(f, STEEL, 0.8), name: v.name, info: v.info });
    }
    this.ductGeo.set(d.id, g);
    return g;
  }

  // ───────── per frame ─────────
  /** How lit a room is right now (0..1), and any tint. */
  light(state, r, t) {
    if (r.sim) return roomLight(state, r.id, t);
    const p = state.ship.power;
    return { L: p.lightLevel ?? 1, tint: p.mode === 'limp' ? { c: [200, 30, 20], a: 0.28 } : null };
  }

  /** Doors open while someone is going through them, or because the walker opened them; hatch lids while someone climbs. */
  animate(state, walker, dt) {
    const tr = state.traveler, mv = tr.move, seg = mv && mv.segs[mv.i];
    const cycling = new Set();
    if (seg && seg.kind === 'hatch') cycling.add(seg.hatch);
    for (const p of (state.space && state.space.passengers) || []) { const s = p.path && p.path[p.seg]; if (s && s.kind === 'hatch') cycling.add(s.hatch); }
    for (const d of this.world.doors) {
      const want = d.wantOpen || (d.simHatch && cycling.has(d.simHatch)) ? 1 : 0;
      d.open += Math.sign(want - d.open) * Math.min(Math.abs(want - d.open), dt * 2.4);
    }
    for (const s of this.world.shafts) {
      const climbing = walker.move && walker.move.shaft === s;
      s.lidOpen = climbing || (s.hatches || []).some((h) => cycling.has(h));
    }
    for (const id of this.windowIds) {
      const want = isShut(state, id) ? 1 : 0, cur = this.shutters.get(id) ?? want;
      this.shutters.set(id, cur + Math.sign(want - cur) * Math.min(Math.abs(want - cur), dt * 0.7));
    }
  }

  /** The rooms to draw: where the walker is, and whatever shows through open doors, hatches and grilles. */
  visible(walker) {
    const W2 = this.world, set = new Set();
    const add = (id, depth) => {
      if (set.has(id) && depth > 0) return;
      set.add(id);
      if (depth >= 3) return;
      const r = W2.rooms[id];
      for (const d of r.doors) if (d.open > 0.02) add(d.a === id ? d.b : d.a, depth + 1);
      for (const s of r.shafts) if (s.lidOpen && s.stops) for (const o of s.stops) if (o !== id) set.add(o);
    };
    if (walker.mode === 'room' && walker.room) add(walker.room.id, 0);
    const m = walker.move;
    if (m && m.arrive.mode === 'room') add(m.arrive.room, 1);
    if (m && m.grille) add(m.grille.room, 1);
    const ducts = new Set();
    if (walker.mode === 'duct') ducts.add(walker.duct.id);
    if (m && m.arrive.mode === 'duct') ducts.add(m.arrive.duct);
    for (const id of ducts) {
      const d = W2.ducts.find((q) => q.id === id);
      for (const g of d.grilles) if (Math.hypot((g.x[0] + g.x[1]) / 2 - walker.x, (g.y[0] + g.y[1]) / 2 - walker.y) < 9) set.add(g.room);
    }
    return { rooms: [...set].map((id) => W2.rooms[id]), ducts: [...ducts].map((id) => W2.ducts.find((q) => q.id === id)) };
  }

  /** Where someone the sim has at (room, x) stands in 3D, walking toward the door they're about to go through. */
  placePerson(state, room, x, move, depth = 0.95) {
    const W2 = this.world, r = W2.rooms[room];
    const seg = move && move.segs[move.i];
    if (seg && seg.kind === 'hatch') {
      const u = Math.max(0, Math.min(1, move.segT / seg.seconds));
      const shaft = W2.shafts.find((s) => (s.hatches || []).includes(seg.hatch));
      if (shaft) {
        const a = W2.rooms[seg.from], b = W2.rooms[seg.to];
        return { at: [(shaft.x[0] + shaft.x[1]) / 2, (shaft.y[0] + shaft.y[1]) / 2, lerp(a.z[0], b.z[0], u)], room: u < 0.5 ? seg.from : seg.to, climbing: true };
      }
      const ds = W2.doors.filter((d) => d.simHatch === seg.hatch);
      if (ds.length === 1) { const d = ds[0], s = d.a === seg.from ? 1 : -1; const k = (u - 0.5) * 1.4 * -s; return { at: [d.at[0] + d.n[0] * k, d.at[1] + d.n[1] * k, d.z], room: u < 0.5 ? seg.from : seg.to }; }
      if (ds.length === 2) {
        // a passage: out of one door, along, in at the other
        const [d0, d1] = ds[0].a === seg.from || ds[0].b === seg.from ? ds : [ds[1], ds[0]];
        return { at: [lerp(d0.at[0], d1.at[0], u), lerp(d0.at[1], d1.at[1], u), d0.z], room: d0.a === seg.from ? d0.b : d0.a };
      }
      const gh = this.data.nav.hatches[seg.hatch];
      void gh;
      return null; // a crawl through the plumbing duct: out of sight
    }
    if (!r) return null;
    let at = roomPoint(r, x, depth);
    // walking to a door that isn't in the back wall: the last stretch turns toward it
    const next = move && move.segs[move.i + 1];
    if (seg && seg.kind === 'walk' && next && next.kind === 'hatch') {
      const d = W2.doors.find((q) => q.simHatch === next.hatch && (q.a === room || q.b === room));
      const left = Math.abs(seg.x1 - x);
      if (d && left < 1.6) { const k = 1 - left / 1.6; at = [lerp(at[0], d.at[0], k), lerp(at[1], d.at[1], k), at[2]]; }
    }
    return { at, room };
  }

  render(ctx, m, walker) {
    const { state, data, view, t, tracker, dt } = m;
    const R = this.raster;
    this.animate(state, walker, dt || 0);
    const eye = walker.eye;
    R.begin({ at: eye, yaw: walker.yaw, pitch: walker.pitch });
    const vis = this.visible(walker);
    this.targets = [];
    const tg = (o) => { this.targets.push(o); return this.targets.length - 1; };
    const facing = (pts, n) => n[0] * (eye[0] - pts[0][0]) + n[1] * (eye[1] - pts[0][1]) + n[2] * (eye[2] - pts[0][2]) > 0;
    let outside = false;

    for (const r of vis.rooms) {
      const g = this.roomGeo(r), L = this.light(state, r, t), lit = 0.12 + 0.88 * L.L;
      const roomT = tg({ kind: 'room', name: r.name, sub: this.world.decks[r.deck].name, info: r.info });
      const [x0, x1] = r.x, [y0, y1] = r.y, [z0, z1] = r.z;
      // floor and ceiling
      if (eye[2] > z0) { const tx = this.tex.floor(r); R.poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [[0, 0], [tx.w, 0], [tx.w, tx.h], [0, tx.h]], { tex: tx, shade: lit * 0.82 }, roomT); }
      if (eye[2] < z1) { const tx = this.tex.ceiling(r); R.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[0, 0], [tx.w, 0], [tx.w, tx.h], [0, tx.h]], { tex: tx, shade: lit * 0.66 }, roomT); }
      // hatch lids over the wells, shut unless someone is climbing
      for (const [list, z, dz] of [[r.openings.floor, z0, 0.01], [r.openings.ceil, z1, -0.01]]) for (const o of list) {
        if (o.kind === 'shaft' && !o.shaft.lidOpen) R.poly([[o.x[0], o.y[0], z + dz], [o.x[1], o.y[0], z + dz], [o.x[1], o.y[1], z + dz], [o.x[0], o.y[1], z + dz]], [[0, 0], [16, 0], [16, 16], [0, 16]], { tex: this.tex.shared.lid, shade: lit * 0.8 }, tg({ kind: 'hatch', name: `Hatch: ${o.shaft.name}`, sub: r.name, info: o.shaft.info }));
        if (o.kind === 'well' || o.kind === 'shaft') outside = outside || o.kind === 'well';
      }
      // walls
      for (const w of r.walls) {
        const n = [w.n[0], w.n[1], 0];
        const pts = [[w.a[0], w.a[1], z0], [w.b[0], w.b[1], z0], [w.b[0], w.b[1], z1], [w.a[0], w.a[1], z1]];
        if (!facing(pts, n)) continue;
        if (r.openings[w.side].some((o) => o.kind !== 'door')) outside = true;
        const sideShade = w.side === r.back ? 1 : Math.abs(w.n[0]) > 0.5 ? 0.9 : 0.84;
        if (w.side === r.back) {
          const b = this.tex.back(r, m);
          const bt = tg({ kind: 'back', room: r, picks: b.picks, name: r.name, sub: this.world.decks[r.deck].name, info: r.info, k: b.lenPx / w.len });
          R.poly(pts, [[0, BAND], [b.shell.w, BAND], [b.shell.w, 0], [0, 0]], { tex: b.shell, shade: lit }, bt);
          const o = PROP_DEPTH;
          const pp = pts.map((p) => [p[0] + w.n[0] * o, p[1] + w.n[1] * o, p[2]]);
          R.poly(pp, [[0, BAND], [b.props.w, BAND], [b.props.w, 0], [0, 0]], { tex: b.props, shade: lit * 0.97 }, bt);
        } else {
          const tx = this.tex.wall(r, w.side);
          R.poly(pts, [[0, BAND], [tx.w, BAND], [tx.w, 0], [0, 0]], { tex: tx, shade: lit * sideShade }, roomT);
        }
      }
      // window bays and skylight wells; the glass open, or plated as the shutters come down
      for (const p of g.bays) {
        if (p.glass) {
          const sh = this.shutters.get(p.win) ?? 0;
          if (sh <= 0.001 || p.zf > sh) { outside = true; continue; }
          R.poly(p.pts, null, { color: flatShade(p.pts, ARMOR, lit) }, tg({ kind: 'shutter', win: p.win, name: `${p.name}: shutters`, sub: r.name, info: 'Armored shutters over the glass.' }));
          continue;
        }
        R.poly(p.pts, null, { color: p.color }, roomT);
      }
      for (const wp of g.winPlates) {
        const sh = this.shutters.get(wp.id) ?? 0;
        if (sh < 0.999) outside = true;
        if (sh <= 0.001) continue;
        const o = wp.o, zt = o.z1, zb = o.z1 - (o.z1 - o.z0) * sh;
        R.poly([wp.at(o.s0, zb), wp.at(o.s1, zb), wp.at(o.s1, zt), wp.at(o.s0, zt)], [[0, (zt - zb) * 32], [(o.s1 - o.s0) * 32, (zt - zb) * 32], [(o.s1 - o.s0) * 32, 0], [0, 0]], { tex: this.tex.shared.armor, shade: lit }, tg({ kind: 'shutter', win: wp.id, name: `${wp.name}: shutters`, sub: r.name, info: 'Armored shutters over the glass.' }));
      }
      for (const p of [...g.solids, ...g.ladders]) R.poly(p.pts, null, { color: p.color }, tg({ kind: 'thing', name: p.name, sub: r.name, info: p.info }));
      for (const p of g.wells) if (walker.move || p.pts.some((q) => Math.abs(q[2] - eye[2]) < 6)) R.poly(p.pts, p.uv, { tex: this.tex.shared.duct, shade: 0.4 * lit + 0.1 }, tg({ kind: 'thing', name: p.name, sub: 'Ladder well', info: p.info }));
      // the freight lift's car, its doors on every face
      for (const s of g.lifts) {
        const lt = tg({ kind: 'lift', name: s.name, sub: r.name, info: s.info });
        for (const [p, q] of [[[s.x[0], s.y[0]], [s.x[1], s.y[0]]], [[s.x[1], s.y[0]], [s.x[1], s.y[1]]], [[s.x[1], s.y[1]], [s.x[0], s.y[1]]], [[s.x[0], s.y[1]], [s.x[0], s.y[0]]]]) {
          R.poly([[q[0], q[1], z0], [p[0], p[1], z0], [p[0], p[1], z1], [q[0], q[1], z1]], [[0, BAND], [32, BAND], [32, 0], [0, 0]], { tex: this.tex.shared.lift, shade: lit * 0.9 }, lt);
        }
      }
    }
    // doors: frames and panels, once each
    const drawn = new Set();
    for (const r of vis.rooms) for (const d of r.doors) {
      if (drawn.has(d)) continue;
      drawn.add(d);
      const L = this.light(state, r, t), lit = 0.12 + 0.88 * L.L;
      const P = (u, v, z) => [d.at[0] + d.along[0] * u + d.n[0] * v, d.at[1] + d.along[1] * u + d.n[1] * v, d.z + z];
      const dep = d.gap / 2 + 0.07, hw = DOOR_W / 2;
      const other = d.a === r.id ? d.b : d.a;
      const dt2 = tg({ kind: 'door', door: d, name: `Door to ${this.world.rooms[other].name}`, sub: r.name, info: d.open > 0.5 ? 'Open.' : 'Shut.' });
      const box = (u0, u1, zz0, zz1) => { for (const f of boxFaces([0, 1], [0, 1], [0, 1])) { const pts = f.map(([a, b, c]) => P(a ? u1 : u0, b ? dep : -dep, c ? zz1 : zz0)); R.poly(pts, null, { color: flatShade(pts, [36, 38, 42], lit) }, dt2); } };
      box(-hw - 0.09, -hw, 0, DOOR_H); box(hw, hw + 0.09, 0, DOOR_H); box(-hw - 0.09, hw + 0.09, DOOR_H, DOOR_H + 0.09);
      if (d.open < 0.995) {
        const zb = d.open * DOOR_H, row = d.open * 66;
        R.poly([P(-hw, 0, zb), P(hw, 0, zb), P(hw, 0, DOOR_H), P(-hw, 0, DOOR_H)], [[0, 66], [30, 66], [30, row], [0, row]], { tex: this.tex.shared.door, shade: lit }, dt2);
      }
    }
    // the ductwork, when the walker is in it
    for (const d of vis.ducts) {
      const g = this.ductGeoOf(d);
      const dtg = tg({ kind: 'duct', name: d.name, sub: 'Ductwork', info: d.info });
      for (const p of g.polys) R.poly(p.pts, p.uv, { tex: this.tex.shared.duct, shade: p.shade }, dtg);
      for (const p of g.grilles) R.poly(p.pts, p.uv, { tex: this.tex.shared.grille, shade: 0.7 }, tg({ kind: 'grille', name: `Grille into the ${this.world.rooms[p.room].name}`, sub: d.name, info: 'E or Q to climb through.' }));
      for (const p of g.rungs) R.poly(p.pts, null, { color: p.color }, tg({ kind: 'thing', name: p.name, sub: 'Vent shaft', info: p.info }));
    }
    // people, where the sim has them
    this.drawPeople(state, data, t, tracker, m.pos, vis, walker, tg);

    // ── compose: what's outside, the hull, then the interior over both ──
    if (walker.mode === 'duct' || (walker.move && walker.move.kind === 'vent')) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    else {
      const look = [Math.cos(walker.pitch) * Math.cos(walker.yaw), Math.cos(walker.pitch) * Math.sin(walker.yaw), Math.sin(walker.pitch)];
      if (view.scene === 'surface') drawSurfaceScene(ctx, { body: view.body, sys: view.sys, t, altitudeKm: view.altitudeKm, yaw: walker.yaw, pitch: walker.pitch, entryHeat: view.entryHeat, base: view.base });
      else drawSpaceScene(ctx, view, t, { yaw: walker.yaw, pitch: walker.pitch });
      if (outside) {
        const f = state.ship.flight;
        renderShip(ctx, { at: eye, look }, {
          cull: true, walk: true, heat: state.ship.thermal.heat, wear: state.ship.components.hull_plating.wear, landed: f.mode === 'landed', gearDown: ['landed', 'descent', 'ascent'].includes(f.mode),
          drive: view.scene === 'hyperspace' ? 1 : Math.max(view.charging || 0, view.speed > 0.0005 ? 0.8 : 0), lit: (state.ship.power.lightLevel ?? 1) > 0.2,
          shutFor: (part) => isShut(state, part.startsWith('win:') ? part.slice(4) : part.replace(/^hull:/, 'glass:')),
          roverOut: !!(state.ship.rover && state.ship.rover.out), roverX: 0,
        });
      }
    }
    const lc = this.layer.getContext('2d');
    lc.putImageData(this.img, 0, 0);
    ctx.drawImage(this.layer, 0, 0);
    // the room's tint, and caution strobes when the ship runs hot, as in the feeds
    const here = walker.room && walker.mode === 'room' ? this.light(state, walker.room, t) : null;
    if (here && here.tint) { ctx.fillStyle = css(here.tint.c, here.tint.a); ctx.fillRect(0, 0, W, H); }
    const heat = state.ship.thermal.heat;
    if (heat > 0.78 && Math.sin(t * (heat > 0.95 ? 9 : 5)) > 0.35) { ctx.fillStyle = heat > 0.95 ? 'rgba(255,40,30,0.16)' : 'rgba(255,160,30,0.11)'; ctx.fillRect(0, 0, W, H); }
    this.look = this.lookAt();
    this.hud(ctx, m, walker);
  }

  drawPeople(state, data, t, tracker, pos, vis, walker, tg) {
    const R = this.raster, inView = new Set(vis.rooms.map((r) => r.id));
    const camR = [-Math.sin(walker.yaw), Math.cos(walker.yaw)];
    const sprite = (at, k, info, privacy = false, axis = null) => {
      // a standing card, always turned to the eye; the figure flips to keep its heading along the room.
      // Someone lying down lies along the room instead, on the bunk against the back wall.
      const lying = k.pose === 'lie' && axis;
      let flip = false;
      if (axis && !lying) flip = axis[0] * camR[0] + axis[1] * camR[1] < 0;
      const tex = personSprite({ ...k, facing: flip ? -(k.facing || 1) : k.facing || 1 }, t, privacy);
      const w = 1.0, h = 2.5, dir = lying ? axis : camR;
      const a = [at[0] - dir[0] * w, at[1] - dir[1] * w, at[2]], b = [at[0] + dir[0] * w, at[1] + dir[1] * w, at[2]];
      R.poly([a, b, [b[0], b[1], at[2] + h], [a[0], a[1], at[2] + h]], [[0, 80], [64, 80], [64, 0], [0, 0]], { tex, shade: 0.95 }, tg(info));
    };
    // the traveler
    const tr = state.traveler;
    if (pos && this.world.rooms[pos.room] && (inView.has(pos.room) || tr.move)) {
      const p = this.placePerson(state, pos.room, pos.x, tr.move);
      if (p && inView.has(p.room)) {
        const k = travelerPose(state, data, tracker, pos, t);
        if (k) {
          const r = this.world.rooms[p.room];
          const lying = k.pose === 'lie';
          const at = lying ? roomPoint(r, pos.x, 0.55, (FLOOR_PX - k.y) / PPM) : p.at;
          sprite(at, k, { kind: 'person', name: 'The traveler', sub: r.name, info: activityLabel(tr.activity) }, !!k.privacy, r.axis);
        }
      }
    }
    // passengers, and anyone being walked to the brig
    for (const q of (state.space && state.space.passengers) || []) {
      if (!inView.has(q.pos.room)) continue;
      const r = this.world.rooms[q.pos.room];
      const asleep = q.doing === 'asleep' && data.rooms[q.pos.room] && Math.abs(q.pos.x - data.rooms[q.pos.room].stations.bunk) < 0.3;
      const k = { pose: asleep ? 'lie' : q.moving ? 'walk' : 'stand', facing: 1, phase: q.pos.x * 3, fatigue: 0, yawn: 0, alpha: 1, outfit: q.look, skin: q.look.skin, hair: q.look.hair };
      sprite(roomPoint(r, q.pos.x, asleep ? 0.55 : 1.25, asleep ? 0.62 : 0), k, { kind: 'person', name: q.name, sub: `Passenger · going to ${q.going}`, info: q.doing }, false, r.axis);
    }
    for (const q of (state.space && state.space.prisoners) || []) {
      if (!q.pos || q.state === 'held' || !inView.has(q.pos.room)) continue;
      const r = this.world.rooms[q.pos.room];
      const k = { pose: q.moving ? 'walk' : 'stand', facing: q.dir || -1, phase: q.pos.x * 3, fatigue: 0, yawn: 0, alpha: 1, outfit: q.look, skin: q.look.skin, hair: q.look.hair, suited: q.state === 'at_lock' };
      sprite(roomPoint(r, q.pos.x, 1.1), k, { kind: 'person', name: q.name, sub: `Prisoner · pilot of a ${q.cls}`, info: q.doing }, false, r.axis);
    }
  }

  /** What's under the crosshair: a thing on a wall the feeds can name, a door, a window, a person, the room itself. */
  lookAt() {
    const h = this.raster.hit;
    if (!h || h.id === null) return null;
    const tgt = this.targets[h.id];
    if (!tgt) return null;
    const out = { ...tgt, dist: h.z };
    if (tgt.kind === 'back' && tgt.picks.length) {
      const x = h.u, y = h.v + CEIL;
      let best = null;
      for (const p of tgt.picks) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h && (!best || p.w * p.h < best.w * best.h)) best = p;
      if (best) { const i = best.info(); return { ...out, kind: 'station', name: i.name, sub: i.sub, lines: i.lines }; }
    }
    return out;
  }

  // ───────── the HUD, in the feeds' pixel font ─────────
  hud(ctx, m, walker) {
    const { state, t } = m;
    const box = (x, y, w, h) => rect(ctx, [0, 0, 0], x, y, w, h, 0.55);
    // where you are
    const where = walker.mode === 'duct' ? walker.duct.name : walker.room ? walker.room.name : '';
    const deck = walker.mode === 'duct' ? 'Ductwork' : walker.room ? this.world.decks[walker.room.deck].name : '';
    const tag = `${where.toUpperCase()}`;
    box(2, 2, Math.max(textWidth(tag), textWidth(deck.toUpperCase())) + 6, 17);
    text(ctx, tag, 5, 4, [190, 225, 205]);
    text(ctx, deck.toUpperCase(), 5, 11, [120, 160, 140]);
    // heading
    const deg = Math.round(((walker.yaw * 180) / Math.PI + 360) % 360);
    const name = ['FORE', 'STBD', 'AFT', 'PORT'][Math.round(deg / 90) % 4];
    const hd = `${name} ${String(deg).padStart(3, '0')}`;
    box(W / 2 - textWidth(hd) / 2 - 3, 2, textWidth(hd) + 6, 9);
    text(ctx, hd, W / 2 - textWidth(hd) / 2, 4, [190, 225, 205]);
    // the crosshair
    const c = [210, 235, 220];
    rect(ctx, c, W / 2 - 4, H / 2, 3, 1, 0.8); rect(ctx, c, W / 2 + 2, H / 2, 3, 1, 0.8); rect(ctx, c, W / 2, H / 2 - 4, 1, 3, 0.8); rect(ctx, c, W / 2, H / 2 + 2, 1, 3, 0.8);
    // what you're looking at
    const lk = this.look;
    if (lk && lk.kind !== 'room' && lk.kind !== 'duct' && lk.dist < 9) {
      const lines = [lk.name, lk.sub, ...(lk.lines || []).slice(0, 2).map(([a, b]) => (a ? `${a}: ${b}` : b)), ...(!lk.lines && lk.info && lk.kind !== 'back' ? [lk.info] : [])].filter(Boolean).map((s) => String(s).slice(0, 52));
      const w = Math.max(...lines.map(textWidth)) + 6;
      box(2, H - 4 - lines.length * 7 - 3, w, lines.length * 7 + 4);
      lines.forEach((s, i) => text(ctx, s, 5, H - 4 - lines.length * 7 + i * 7, i ? [150, 180, 165] : [220, 235, 225]));
    }
    // what you can do here
    if (this.prompts && this.prompts.length) {
      const ps = this.prompts.slice(0, 3);
      const w = Math.max(...ps.map(textWidth)) + 6;
      box(W - w - 2, H - 4 - ps.length * 7 - 3, w, ps.length * 7 + 4);
      ps.forEach((s, i) => text(ctx, s, W - w + 1, H - 4 - ps.length * 7 + i * 7, [240, 214, 150]));
    }
    // where the traveler is
    const tr = state.traveler, trRoom = this.world.rooms[tr.pos.room];
    const tl = trRoom ? `TRAVELER: ${trRoom.name.toUpperCase()}` : `TRAVELER: ${tr.pos.room === 'surface' ? 'OUTSIDE' : tr.pos.room === 'port' ? 'ASHORE' : 'AWAY'}`;
    const ta = activityLabel(tr.activity).toUpperCase().slice(0, 34);
    const tw = Math.max(textWidth(tl), textWidth(ta)) + 6;
    if (!this.mapOn) { box(W - tw - 2, 2, tw, 17); text(ctx, tl, W - tw + 1, 4, [240, 214, 150]); text(ctx, ta, W - tw + 1, 11, [170, 160, 130]); }
    if (this.mapOn) this.map(ctx, state, walker);
    if (t < this.helpUntil) {
      const help = ['WASD/ARROWS WALK  MOUSE LOOK  SHIFT RUN  C CROUCH', 'E OPEN, CLIMB, SHUTTERS  Q DOWN  G FIND TRAVELER', 'P DECK PLAN  T TELEMETRY  F FULLSCREEN  ESC EXIT'];
      const w = Math.max(...help.map(textWidth)) + 8;
      box(W / 2 - w / 2, 22, w, help.length * 8 + 4);
      help.forEach((s, i) => text(ctx, s, W / 2 - textWidth(s) / 2, 25 + i * 8, [200, 220, 210]));
    }
  }

  /** A passing message, above the prompts. */
  toastDraw(ctx, s) {
    const str = s.toUpperCase().slice(0, 70);
    rect(ctx, [0, 0, 0], W / 2 - textWidth(str) / 2 - 3, H - 46, textWidth(str) + 6, 9, 0.6);
    text(ctx, str, W / 2 - textWidth(str) / 2, H - 44, [240, 214, 150]);
  }

  /** The deck plan: every space on this deck, the doors, you and the traveler. */
  map(ctx, state, walker) {
    const deck = walker.mode === 'room' && walker.room ? walker.room.deck : walker.duct && walker.duct.floor > 3 ? (walker.duct.floor > 8 ? 'living' : 'main') : 'main';
    const rooms = Object.values(this.world.rooms).filter((r) => r.deck === deck);
    const xs = rooms.flatMap((r) => r.x), ys = rooms.flatMap((r) => r.y);
    const bx = [Math.min(...xs), Math.max(...xs)], by = [Math.min(...ys), Math.max(...ys)];
    const mw = 170, mh = 74, s = Math.min((mw - 8) / (bx[1] - bx[0]), (mh - 14) / (by[1] - by[0]));
    const X0 = W - mw - 2, Y0 = 2;
    rect(ctx, [0, 0, 0], X0, Y0, mw, mh, 0.7);
    // seen from above: fore to the right, starboard down
    const P = (x, y) => [X0 + mw / 2 + (x - (bx[0] + bx[1]) / 2) * s, Y0 + (mh - 8) / 2 + (y - (by[0] + by[1]) / 2) * s];
    for (const r of rooms) {
      const [ax, ay] = P(r.x[0], r.y[0]), [bx2, by2] = P(r.x[1], r.y[1]);
      const here = walker.room === r;
      rect(ctx, here ? [70, 110, 90] : r.sim ? [44, 58, 54] : [36, 40, 44], ax, ay, Math.max(1, bx2 - ax), Math.max(1, by2 - ay));
    }
    for (const d of this.world.doors) if (this.world.rooms[d.a].deck === deck) { const [x, y] = P(d.at[0], d.at[1]); rect(ctx, d.open > 0.5 ? [120, 220, 150] : [200, 160, 60], x, y, 1, 1); }
    const tr = state.traveler, tr3 = this.world.rooms[tr.pos.room];
    if (tr3 && tr3.deck === deck) { const p = roomPoint(tr3, tr.pos.x, 0.95); const [x, y] = P(p[0], p[1]); rect(ctx, [255, 200, 90], x - 1, y - 1, 3, 3); }
    const [wx, wy] = P(walker.x, walker.y);
    rect(ctx, [255, 255, 255], wx - 1, wy - 1, 3, 3);
    const [hx, hy] = P(walker.x + Math.cos(walker.yaw) * 2.5, walker.y + Math.sin(walker.yaw) * 2.5);
    ctx.fillStyle = css([255, 255, 255], 0.8); ctx.fillRect(Math.round(lerp(wx, hx, 0.6)), Math.round(lerp(wy, hy, 0.6)), 1, 1); ctx.fillRect(Math.round(hx), Math.round(hy), 1, 1);
    text(ctx, `${this.world.decks[deck].name.toUpperCase()}   FORE >`, X0 + 3, Y0 + mh - 7, [150, 190, 170]);
  }
}

const FLOOR_PX = 150;
export { mix, FPPM };
