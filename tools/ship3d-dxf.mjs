#!/usr/bin/env node
// Export the proposed ship arrangement (data/ship3d.json) as a 3D DXF that
// AutoCAD (or any CAD tool) can open, edit and save back.
//   node tools/ship3d-dxf.mjs out.dxf
//
// Units are meters. Axes: X forward, Y to PORT, Z up (a right-handed frame,
// so the model is not mirrored in CAD; ship3d.json's y is starboard, so Y = -y).
// Origin: amidships on the main-deck floor.
//
// Layers (one per object, so an edited file maps straight back):
//   HULL_<part>_STATIONS  closed 3D polylines, one per hull station: reshape the hull by editing these
//   HULL_<part>_SKIN      3DFACE mesh lofted between stations (reference; regenerated from the stations)
//   ROOM_<id>             box of 3DFACEs per compartment
//   MOD_<id>              machinery: boxes or faceted cylinders
//   SHAFT_<id>, DUCT_<id> ladder wells, lifts, vents and crawl ducts
//   WIN_<id>              window panes, lying flush on the hull surface
//   CAM_<id>              exterior camera: a point plus a 3 m line along its view direction
//   TEXT                  labels
import { readFileSync, writeFileSync } from 'node:fs';
import { hullParts, station, profile, partY, withDecks, moduleExtent, segmentBox, windowQuads, windowBays, ladderParts } from '../src/ship3d/geometry.js';

const root = new URL('..', import.meta.url);
const ship = JSON.parse(readFileSync(new URL('data/ship3d.json', root), 'utf8'));
const out = process.argv[2] || 'ship3d.dxf';

const P = ([x, y, z]) => [x, -y, z]; // data → CAD
const lines = [];
const g = (code, v) => lines.push(String(code), typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : String(v));
const layers = new Map();
const layer = (name, color) => { if (!layers.has(name)) layers.set(name, color); return name; };
const COLOR = { hull: 8, skin: 9, hab: 4, life: 3, service: 252, passage: 254, power: 2, drive: 5, fuel: 150, thermal: 1, sensor: 251, science: 6, rover: 40, weapon: 10, utility: 42, shield: 160, security: 12, ladder: 30, lift: 50, vent: 33, duct: 33, window: 140, cam: 130, text: 7 };
const ents = [];

function face(ly, a, b, c, d = c) {
  ents.push(() => {
    g(0, '3DFACE'); g(8, ly);
    [a, b, c, d].forEach((p, i) => { const q = P(p); g(10 + i, q[0]); g(20 + i, q[1]); g(30 + i, q[2]); });
  });
}
function poly3d(ly, pts, closed = true) {
  ents.push(() => {
    g(0, 'POLYLINE'); g(8, ly); g(66, 1); g(70, closed ? 9 : 8);
    for (const p of pts) { const q = P(p); g(0, 'VERTEX'); g(8, ly); g(10, q[0]); g(20, q[1]); g(30, q[2]); g(70, 32); }
    g(0, 'SEQEND'); g(8, ly);
  });
}
function line3d(ly, a, b) { ents.push(() => { const p = P(a), q = P(b); g(0, 'LINE'); g(8, ly); g(10, p[0]); g(20, p[1]); g(30, p[2]); g(11, q[0]); g(21, q[1]); g(31, q[2]); }); }
function point(ly, a) { ents.push(() => { const p = P(a); g(0, 'POINT'); g(8, ly); g(10, p[0]); g(20, p[1]); g(30, p[2]); }); }
function label(a, h, s) { ents.push(() => { const p = P(a); g(0, 'TEXT'); g(8, 'TEXT'); g(10, p[0]); g(20, p[1]); g(30, p[2]); g(40, h); g(1, s); }); }
function box(ly, x, y, z) {
  const c = (i) => [i & 1 ? x[1] : x[0], i & 2 ? y[1] : y[0], i & 4 ? z[1] : z[0]];
  for (const [a, b, cc, d] of [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]]) face(ly, c(a), c(b), c(cc), c(d));
}
function cylX(ly, x0, x1, y, z, r, n = 16) {
  const ring = (x) => Array.from({ length: n }, (_, i) => [x, y + r * Math.cos((i / n) * 2 * Math.PI), z + r * Math.sin((i / n) * 2 * Math.PI)]);
  const A = ring(x0), B = ring(x1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; face(ly, A[i], A[j], B[j], B[i]); face(ly, [x0, y, z], A[i], A[j]); face(ly, [x1, y, z], B[i], B[j]); }
}
function cylZ(ly, x, y, z0, z1, r, n = 10) {
  const ring = (z) => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i / n) * 2 * Math.PI), y + r * Math.sin((i / n) * 2 * Math.PI), z]);
  const A = ring(z0), B = ring(z1);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; face(ly, A[i], A[j], B[j], B[i]); }
}

// hull: editable station rings + a lofted skin
for (const p of hullParts(ship)) {
  const ls = layer(`HULL_${p.id}_STATIONS`, COLOR.hull), lk = layer(`HULL_${p.id}_SKIN`, COLOR.skin);
  const xs = p.stations.map((s) => s.x).sort((a, b) => b - a);
  const rings = xs.map((x) => { const st = station(p.stations, x); return profile(p.profile, st).map(([y, z]) => [x, y + partY(p, st), z]); });
  rings.forEach((R) => poly3d(ls, R));
  for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < rings[k].length; i++) { const j = (i + 1) % rings[k].length; face(lk, rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]); }
}
for (const r of withDecks(ship)) {
  box(layer(`ROOM_${r.id}`, COLOR[r.role] ?? 7), r.x, r.y, r.zRange);
  label([(r.x[0] + r.x[1]) / 2, (r.y[0] + r.y[1]) / 2, r.zRange[1] + 0.1], 0.5, r.name || r.id);
}
layer('TEXT', COLOR.text);
for (const m of ship.modules) {
  const ly = layer(`MOD_${m.id}`, COLOR[m.role] ?? 7);
  if (m.shape === 'cyl-x') cylX(ly, m.x[0], m.x[1], m.y, m.z, m.r);
  else if (m.shape === 'cyl-z') cylZ(ly, m.x, m.y, m.z[0], m.z[1], m.r);
  else { const e = moduleExtent(m); box(ly, e.x, e.y, e.z); }
}
// window bays: each room opens out to its angled window; the pony wall is drawn as a low box
for (const bay of windowBays(ship)) {
  const ly = layer(`BAY_${bay.window}`, COLOR[(withDecks(ship).find((r) => r.id === bay.room) || {}).role] ?? 7);
  for (let i = 0; i < bay.slices.length - 1; i++) {
    const A = bay.slices[i], B = bay.slices[i + 1];
    if (A.poly.length !== B.poly.length) continue;
    for (let k = 0; k < A.poly.length; k++) { const k2 = (k + 1) % A.poly.length; face(ly, [A.x, ...A.poly[k]], [A.x, ...A.poly[k2]], [B.x, ...B.poly[k2]], [B.x, ...B.poly[k]]); }
  }
  if (bay.rail) box(layer(`PONY_${bay.window}`, COLOR.service), bay.x, [bay.rail.y - 0.06, bay.rail.y + 0.06], bay.rail.z);
}
for (const s of ship.shafts || []) box(layer(`SHAFT_${s.id}`, COLOR[s.kind] ?? COLOR.ladder), s.x, s.y, s.z);
for (const s of (ship.shafts || []).filter((q) => q.kind === 'ladder' || q.kind === 'vent')) {
  const lp = ladderParts(ship, s);
  const ly = layer(`LADDER_${s.id}`, COLOR.ladder);
  for (const b of [...lp.rails, ...lp.rungs]) box(ly, b.x, b.y, b.z);
  const lf = layer(`HATCH_${s.id}`, COLOR.text);
  for (const b of lp.frames) box(lf, b.x, b.y, b.z);
}
for (const d of ship.ducts || []) for (const seg of d.segments) { const b = segmentBox(seg, d.size); box(layer(`DUCT_${d.id}`, COLOR.duct), b.x, b.y, b.z); }
for (const w of ship.windows || []) for (const q of windowQuads(ship, w, 1)) face(layer(`WIN_${w.id}`, COLOR.window), ...q);
for (const c of ship.cameras.exterior) {
  const ly = layer(`CAM_${c.id.replace(/[^A-Za-z0-9_]/g, '_')}`, COLOR.cam);
  const l = Math.hypot(...c.look);
  point(ly, c.at);
  line3d(ly, c.at, c.at.map((v, i) => v + (3 * c.look[i]) / l));
}

// write: header, layer table, entities
g(0, 'SECTION'); g(2, 'HEADER'); g(9, '$ACADVER'); g(1, 'AC1009'); g(9, '$INSUNITS'); g(70, 6); g(0, 'ENDSEC');
g(0, 'SECTION'); g(2, 'TABLES'); g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.size);
for (const [name, color] of layers) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, color); g(6, 'CONTINUOUS'); }
g(0, 'ENDTAB'); g(0, 'ENDSEC');
g(0, 'SECTION'); g(2, 'ENTITIES');
for (const e of ents) e();
g(0, 'ENDSEC'); g(0, 'EOF');
writeFileSync(out, lines.join('\r\n') + '\r\n');
console.log(`${out}: ${layers.size} layers, ${ents.length} entities`);
