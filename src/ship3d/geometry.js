// Pure geometry for the 3D ship arrangement (data/ship3d.json): hull
// cross-sections, containment, room-local coordinates, and the consistency
// check against the sim's room graph (data/ship.json). No DOM.

const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolated hull station {b, zk, zt} at x, or null outside the part. */
export function station(stations, x) {
  const s = [...stations].sort((a, b) => b.x - a.x); // fore → aft
  if (x > s[0].x || x < s[s.length - 1].x) return null;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], c = s[i + 1];
    if (x <= a.x && x >= c.x) {
      const t = a.x === c.x ? 0 : (a.x - x) / (a.x - c.x);
      const st = { b: lerp(a.b, c.b, t), zk: lerp(a.z[0], c.z[0], t), zt: lerp(a.z[1], c.z[1], t) };
      if (a.y != null && c.y != null) st.yc = lerp(a.y, c.y, t); // a part whose centerline sweeps sideways
      return st;
    }
  }
  return null;
}

/**
 * Cross-section outline (y, z) at a station, counter-clockwise, centered on
 * the part's own axis. 'hex' is a flattened hexagon (sharp flanks, flat deck
 * and keel); 'box' is a chamfered box for superstructure.
 */
export function profile(kind, st) {
  const { b, zk, zt } = st;
  const h = zt - zk;
  if (kind === 'krait') {
    // flat, wide top deck with a short chine; the belly hangs below it, narrower
    const c = Math.min(0.8, h * 0.4);
    return [[b, zt], [b, zt - c], [0.62 * b, zk + 0.42 * h], [0.52 * b, zk], [-0.52 * b, zk], [-0.62 * b, zk + 0.42 * h], [-b, zt - c], [-b, zt]];
  }
  if (kind === 'box' || kind === 'head') {
    const ch = Math.min(0.8, h * 0.3);
    return [[0.75 * b, zt], [b, zt - ch], [b, zk], [-b, zk], [-b, zt - ch], [-0.75 * b, zt]];
  }
  return [[0.62 * b, zt], [b, zt - 0.45 * h], [0.92 * b, zk + 0.18 * h], [0.55 * b, zk], [-0.55 * b, zk], [-0.92 * b, zk + 0.18 * h], [-b, zt - 0.45 * h], [-0.62 * b, zt]];
}

/** Lateral center of a part at a station (parts may sweep inward, like the bow prongs). */
export const partY = (part, st) => (st && st.yc != null ? st.yc : part.y || 0);

/** Hull parts, each { id, profile, y, stations }. Accepts the rev A layout (hull.main / hull.head). */
export function hullParts(ship) {
  if (ship.hull.parts) return ship.hull.parts.map((p) => ({ y: 0, ...p }));
  return [
    { id: 'main', profile: 'hex', y: 0, stations: ship.hull.main },
    { id: 'head', profile: 'box', y: 0, stations: ship.hull.head, glass: ship.hull.canopy && { x: ship.hull.canopy.x, above: 1.2 } },
  ];
}

function inPoly(pts, y, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, zi] = pts[i], [yj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && y < ((yj - yi) * (z - zi)) / (zj - zi) + yi) inside = !inside;
  }
  return inside;
}

/** Is the point inside any hull part? */
export function insideHull(ship, x, y, z) {
  for (const part of hullParts(ship)) {
    const st = station(part.stations, x);
    if (st && inPoly(profile(part.profile, st), y - partY(part, st), z)) return true;
  }
  return false;
}

/** Room-local coordinate u of a 3D point (the sim's position along the room). */
export function roomU(room, p) {
  const [x, y] = p;
  switch (room.axis) {
    case '+x': return x - room.origin;
    case '-x': return room.origin - x;
    case '+y': return y - room.origin;
    case '-y': return room.origin - y;
    default: throw new Error(`bad axis ${room.axis}`);
  }
}

export const roomLength = (r) => (r.axis.endsWith('x') ? r.x[1] - r.x[0] : r.y[1] - r.y[0]);

/** Distance from a point to a box {x, y, zRange|z} (0 inside). */
export function boxDistance(r, p) {
  const z = r.zRange || r.z;
  const d = [
    Math.max(r.x[0] - p[0], 0, p[0] - r.x[1]),
    Math.max(r.y[0] - p[1], 0, p[1] - r.y[1]),
    Math.max(z[0] - p[2], 0, p[2] - z[1]),
  ];
  return Math.hypot(...d);
}

export function withDecks(ship) {
  const decks = Object.fromEntries(ship.decks.map((d) => [d.id, d]));
  return ship.rooms.map((r) => ({ ...r, zRange: decks[r.deck].z }));
}

/** Axis-aligned extent {x, y, z} of a module. */
export function moduleExtent(m) {
  if (m.shape === 'cyl-x') return { x: m.x, y: [m.y - m.r, m.y + m.r], z: [m.z - m.r, m.z + m.r] };
  if (m.shape === 'cyl-z' || m.shape === 'turret' || m.shape === 'ring') return { x: [m.x - m.r, m.x + m.r], y: [m.y - m.r, m.y + m.r], z: m.z };
  if (m.shape === 'dish') return { x: [m.x - m.r, m.x + m.r], y: [m.y - m.r, m.y + m.r], z: [m.z, m.z + m.r] };
  return { x: m.x, y: m.y, z: m.z };
}

/** Axis-aligned box of one duct segment (a square tube of side `size`). */
export function segmentBox([p, q], size) {
  const h = size / 2;
  return {
    x: [Math.min(p[0], q[0]) - (p[0] === q[0] ? h : 0), Math.max(p[0], q[0]) + (p[0] === q[0] ? h : 0)],
    y: [Math.min(p[1], q[1]) - (p[1] === q[1] ? h : 0), Math.max(p[1], q[1]) + (p[1] === q[1] ? h : 0)],
    z: [Math.min(p[2], q[2]) - (p[2] === q[2] ? h : 0), Math.max(p[2], q[2]) + (p[2] === q[2] ? h : 0)],
  };
}

const span = (o) => ({ x: o.x, y: o.y, z: o.zRange || o.z });
function overlap(a, b, eps = 0.01) {
  const A = span(a), B = span(b);
  const o = (p, q) => Math.min(p[1], q[1]) - Math.max(p[0], q[0]);
  return o(A.x, B.x) > eps && o(A.y, B.y) > eps && o(A.z, B.z) > eps;
}
function corners(e, inset = 0.05) {
  const out = [];
  const ins = (r, i) => r[i] + (i ? -inset : inset);
  for (const i of [0, 1]) for (const j of [0, 1]) for (const k of [0, 1]) out.push([ins(e.x, i), ins(e.y, j), ins(e.z, k)]);
  return out;
}

/**
 * Check the arrangement against the sim's room graph. Returns
 * { ok, problems, hatches: [{id, a, b, uA, uB, curA, curB, kind}], volumes, resizes }.
 * uA/uB are the door positions the geometry implies; curA/curB what ship.json says today.
 */
export function checkArrangement(ship, sim) {
  const problems = [];
  const rooms = withDecks(ship);
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const simRooms = Object.fromEntries(sim.rooms.map((r) => [r.id, r]));
  // every sim compartment is placed, with the sim's length; new rooms are not in the sim
  for (const r of sim.rooms) {
    if (r.exterior) continue;
    const g = byId[r.id];
    if (!g) { problems.push(`room ${r.id} is not placed`); continue; }
    if (g.new) problems.push(`room ${r.id} is in the sim but marked new`);
    const L = roomLength(g);
    if (Math.abs(L - r.width) > 0.05 && !g.resize) problems.push(`room ${r.id}: length ${L.toFixed(2)} m, sim says ${r.width} m`);
  }
  for (const r of rooms) if (!r.new && !simRooms[r.id]) problems.push(`room ${r.id} is not in the sim; mark it new`);
  // no two rooms overlap; every room is inside the hull
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) if (overlap(rooms[i], rooms[j])) problems.push(`rooms ${rooms[i].id} and ${rooms[j].id} overlap`);
  for (const r of rooms) for (const c of corners(span(r))) if (!insideHull(ship, ...c)) { problems.push(`room ${r.id} pokes out of the hull near (${c.map((v) => v.toFixed(1)).join(', ')})`); break; }
  // shafts: inside the hull (unless they leave it on purpose) and clear of rooms they do not open to
  for (const s of ship.shafts || []) {
    if (!s.exterior) for (const c of corners(s)) if (!insideHull(ship, ...c)) { problems.push(`shaft ${s.id} pokes out of the hull near (${c.map((v) => v.toFixed(1)).join(', ')})`); break; }
    for (const r of rooms) if (overlap(s, r) && !(s.opensTo || []).includes(r.id)) problems.push(`shaft ${s.id} cuts through ${r.id}`);
    for (const id of s.opensTo || []) if (!byId[id]) problems.push(`shaft ${s.id} opens to unknown room ${id}`);
  }
  for (let i = 0; i < (ship.shafts || []).length; i++) for (let j = i + 1; j < ship.shafts.length; j++) if (overlap(ship.shafts[i], ship.shafts[j])) problems.push(`shafts ${ship.shafts[i].id} and ${ship.shafts[j].id} overlap`);
  // ducts: crawlable tubes inside the hull, clear of rooms and of every shaft except vents (where they join)
  for (const d of ship.ducts || []) {
    for (const seg of d.segments) {
      const box = segmentBox(seg, d.size);
      for (const c of corners(box)) if (!insideHull(ship, ...c)) { problems.push(`duct ${d.id} leaves the hull near (${c.map((v) => v.toFixed(1)).join(', ')})`); break; }
      for (const r of rooms) if (overlap(box, r)) problems.push(`duct ${d.id} cuts through ${r.id}`);
      for (const s of ship.shafts || []) if (s.kind !== 'vent' && overlap(box, s)) problems.push(`duct ${d.id} cuts through ${s.id}`);
    }
  }
  // machinery stays out of the rooms (except a vehicle parked in its bay)
  for (const m of ship.modules || []) {
    const e = moduleExtent(m);
    for (const r of rooms) if (overlap(e, r) && m.inRoom !== r.id) problems.push(`${m.id} intrudes into ${r.id}`);
    for (const s of ship.shafts || []) if (overlap(e, s)) problems.push(`${m.id} blocks ${s.id}`);
    for (const d of ship.ducts || []) for (const seg of d.segments) if (overlap(e, segmentBox(seg, d.size))) { problems.push(`${m.id} blocks ${d.id}`); break; }
  }
  // hatches: door points sit on both rooms' walls, at the positions the sim walks to
  const hatches = [];
  const geo = Object.fromEntries(ship.hatches.map((h) => [h.id, h]));
  for (const h of sim.hatches) {
    const g = geo[h.id];
    if (!g) { problems.push(`hatch ${h.id} is not placed`); continue; }
    const A = byId[h.a], B = byId[h.b];
    if (!A || !B) continue;
    let pA, pB;
    if (g.path) {
      const [p, q] = g.path;
      [pA, pB] = boxDistance(A, p) <= boxDistance(A, q) ? [p, q] : [q, p];
    } else pA = pB = g.at;
    for (const [room, p] of [[A, pA], [B, pB]]) if (boxDistance(room, p) > 0.7) problems.push(`hatch ${h.id} is ${boxDistance(room, p).toFixed(2)} m from ${room.id}`);
    // doors in an end wall stand half a door-width in from the corner
    const clampU = (room, p) => Math.min(roomLength(room) - 0.5, Math.max(0.5, roomU(room, p)));
    const uA = Math.round(clampU(A, pA) * 10) / 10;
    const uB = Math.round(clampU(B, pB) * 10) / 10;
    hatches.push({ id: h.id, a: h.a, b: h.b, uA, uB, curA: h.ax, curB: h.bx, kind: g.kind, note: g.note });
  }
  for (const d of ship.doors || []) for (const id of d.between) {
    const r = byId[id];
    if (!r) problems.push(`door ${d.between.join('/')} names unknown room ${id}`);
    else if (boxDistance(r, d.at) > 0.7) problems.push(`door ${d.between.join('/')} is ${boxDistance(r, d.at).toFixed(2)} m from ${id}`);
  }
  // every exterior camera is fixed to the ship
  for (const c of (ship.cameras && ship.cameras.exterior) || []) if (!mounted(ship, c.at)) problems.push(`camera ${c.id} is not mounted on the ship`);
  // every window lights something: a room or a sensor right behind it
  for (const w of ship.windows || []) {
    if (!w.backs) { problems.push(`window ${w.id} does not say what it lights`); continue; }
    const gap = windowGap(ship, w);
    if (!(gap <= 1.8)) problems.push(`window ${w.id} is ${gap === Infinity ? 'aimed at an unknown space' : `${gap.toFixed(1)} m from ${w.backs}`}`);
  }
  // window bays and light wells stay clear of other rooms, machinery, shafts and ducts
  const bayProblems = new Set();
  for (const bay of windowBays(ship)) {
    for (let i = 0; i < bay.slices.length - 1; i++) {
      const A = bay.slices[i], B = bay.slices[i + 1];
      const pts = A.poly.concat(B.poly);
      const box = { x: [A.x, B.x].sort((p, q) => p - q), y: [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))], z: [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))] };
      // shrink a little: the bay meets its own room's wall and the hull exactly
      const inner = { x: [box.x[0] + 0.05, box.x[1] - 0.05], y: [box.y[0] + 0.05, box.y[1] - 0.05], z: [box.z[0] + 0.05, box.z[1] - 0.05] };
      // only where the overlap is inside the hull: the bay's box also covers open space outside the slope
      const hits = (o) => {
        const e = span(o);
        if (!overlap(inner, o)) return false;
        const m = ['x', 'y', 'z'].map((k) => (Math.max(e[k][0], inner[k][0]) + Math.min(e[k][1], inner[k][1])) / 2);
        return insideHull(ship, ...m);
      };
      for (const r of rooms) if (r.id !== bay.room && hits(r)) bayProblems.add(`the ${bay.window} bay runs into ${r.id}`);
      for (const m of ship.modules || []) if (!m.inRoom && hits(moduleExtent(m))) bayProblems.add(`the ${bay.window} bay runs into ${m.id}`);
      for (const sh of ship.shafts || []) if (hits(sh)) bayProblems.add(`the ${bay.window} bay runs into ${sh.id}`);
      for (const d of ship.ducts || []) for (const seg of d.segments) if (hits(segmentBox(seg, d.size))) bayProblems.add(`the ${bay.window} bay runs into ${d.id}`);
    }
  }
  problems.push(...bayProblems);
  const volumes = {};
  for (const r of rooms) if (!r.unpressurized) volumes[r.id] = (r.x[1] - r.x[0]) * (r.y[1] - r.y[0]) * (r.zRange[1] - r.zRange[0]);
  const resizes = rooms.filter((r) => r.resize && simRooms[r.id] && Math.abs(simRooms[r.id].width - roomLength(r)) > 0.05).map((r) => ({ room: r.id, from: simRooms[r.id].width, to: roomLength(r), why: r.resize }));
  return { ok: problems.length === 0, problems, hatches, volumes, resizes, simRooms };
}

const MOUNT_REACH = 0.35;
const boxGap = (e, p) => Math.hypot(...[e.x, e.y, e.zRange || e.z].map((r, i) => Math.max(r[0] - p[i], 0, p[i] - r[1])));

/** Is a point on the ship: in or within reach of the hull skin, on a module, or inside a room (a bay camera)? */
export function mounted(ship, p, reach = MOUNT_REACH) {
  const offs = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  if (offs.some((o) => insideHull(ship, p[0] + o[0] * reach, p[1] + o[1] * reach, p[2] + o[2] * reach))) return true;
  if ((ship.modules || []).some((m) => boxGap(moduleExtent(m), p) < reach)) return true;
  return withDecks(ship).some((r) => boxGap(r, p) === 0);
}

/** How far a window is from what it lights: the nearest pane corner to its room (or module). */
export function windowGap(ship, w) {
  const target = w.backs && w.backs.startsWith('mod:') ? (ship.modules || []).find((m) => `mod:${m.id}` === w.backs) : withDecks(ship).find((r) => r.id === w.backs);
  if (!target) return Infinity;
  const e = target.zRange ? target : moduleExtent(target);
  return Math.min(...windowQuads(ship, w, 1).flat().map((p) => boxGap(e, p)));
}

/**
 * The shield bubble: an ellipsoid on the ship's bounding box, scaled until it
 * holds every hull vertex, module corner and camera, plus a margin.
 * Returns { c: [x, y, z], r: [a, b, c] }.
 */
export function shieldEllipsoid(ship, margin = 2.5) {
  const pts = [];
  for (const p of hullParts(ship)) for (const s of p.stations) { const st = station(p.stations, s.x); profile(p.profile, st).forEach(([y, z]) => pts.push([s.x, y + partY(p, st), z])); }
  for (const m of ship.modules || []) {
    const e = moduleExtent(m);
    for (const x of e.x) for (const y of e.y) for (const z of e.z) pts.push([x, y, z]);
  }
  for (const c of (ship.cameras && ship.cameras.exterior) || []) pts.push(c.at);
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))), hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
  const c0 = lo.map((v, i) => (v + hi[i]) / 2);
  const half = hi.map((v, i) => (v - lo[i]) / 2);
  // search proportions and a little centre shift for the smallest ellipsoid that still holds every point
  const fit = (c, r) => { const k = Math.max(...pts.map((p) => Math.hypot(...p.map((v, i) => (v - c[i]) / r[i])))); const rr = r.map((v) => v * k); return { c, r: rr, vol: rr[0] * rr[1] * rr[2] }; };
  let best = fit(c0, half);
  for (let step = 0.25; step > 0.01; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < 6; i++) for (const sgn of [1, -1]) {
        const c = [...best.c], r = [...best.r];
        if (i < 3) r[i] *= 1 + sgn * step; else c[i - 3] += sgn * step * half[i - 3] * 0.2;
        const t = fit(c, r);
        if (t.vol < best.vol - 1e-6) { best = t; improved = true; }
      }
    }
  }
  const c = best.c;
  return { c, r: best.r.map((v) => v + margin) };
}

/** Clip a polygon [[u, v], ...] to the half-plane f(p) >= 0, where f is linear. */
function clipHalf(poly, f) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length], fp = f(P), fq = f(Q);
    if (fp >= 0) out.push(P);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
  }
  return out;
}

/**
 * Pull a clockwise polygon in by d: every edge moves inward and neighbours
 * meet again at the corners. Works at the hull's concave wing root, where
 * clipping by each edge's half-plane would cut the wing off.
 */
function insetPolygon(poly, d) {
  const pts = poly.filter((p, i) => { const q = poly[(i + 1) % poly.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-9; });
  const n = pts.length;
  const lines = pts.map((A, i) => {
    const B = pts[(i + 1) % n], dy = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dy, dz);
    const nn = [-dz / l, dy / l]; // outward
    return { p: [A[0] - nn[0] * d, A[1] - nn[1] * d], v: [dy / l, dz / l], nn };
  });
  return pts.map((P, i) => {
    const L1 = lines[(i - 1 + n) % n], L2 = lines[i];
    const den = L1.v[0] * L2.v[1] - L1.v[1] * L2.v[0];
    if (Math.abs(den) < 1e-6) return [P[0] - L2.nn[0] * d, P[1] - L2.nn[1] * d];
    const t = ((L2.p[0] - L1.p[0]) * L2.v[1] - (L2.p[1] - L1.p[1]) * L2.v[0]) / den;
    return [L1.p[0] + L1.v[0] * t, L1.p[1] + L1.v[1] * t];
  });
}

const BAY_INSET = 0.12; // meters between a bay's outer surfaces and the hull skin
const PONY_WALL = 0.95; // meters: the low wall (with a rail on top) between a room and its window bay

/**
 * Window bays. A window on a sloping part of the hull is set at its angle,
 * and the room it lights opens out to it: the ceiling runs outboard until it
 * meets the hull above the glass, and a pony wall with a rail stands on the
 * room's old wall line so nobody steps out onto the glass. A skylight in the
 * flat deck gets a light well up through the ceiling void instead.
 * Each bay: { window, room, kind: 'bay' | 'well', side, x: [x0, x1], deck,
 *   slices: [{ x, poly: [[y, z], ...] }], rail: { y, z: [floor, top] } | null }.
 */
export function windowBays(ship) {
  const rooms = Object.fromEntries(withDecks(ship).map((r) => [r.id, r]));
  const parts = Object.fromEntries(hullParts(ship).map((p) => [p.id, p]));
  const out = [];
  for (const w of ship.windows || []) {
    const r = rooms[w.backs];
    if (!r || w.cap || !parts[w.part]) continue;
    const part = parts[w.part];
    const quads = windowQuads(ship, w, 1);
    if (!quads.length) continue;
    const ys = quads.flat().map((q) => q[1]), zs = quads.flat().map((q) => q[2]);
    const xs = [];
    for (let x = w.x[0]; x < w.x[1] - 1e-6; x += 1) xs.push(x);
    xs.push(w.x[1]);
    const [zf, zc] = r.zRange;
    if (Math.min(...zs) > zc) {
      // a skylight: a straight light well from the ceiling up to the glass
      const y0 = Math.min(...ys), y1 = Math.max(...ys);
      const slices = xs.map((x) => { const st = station(part.stations, x); return { x, poly: [[y0, zc], [y1, zc], [y1, st.zt - BAY_INSET], [y0, st.zt - BAY_INSET]] }; });
      out.push({ window: w.id, room: r.id, deck: r.deck, kind: 'well', side: Math.sign(y0 + y1), x: [w.x[0], w.x[1]], slices, rail: null });
      continue;
    }
    const side = Math.sign(ys.reduce((a, v) => a + v, 0));
    const wall = side > 0 ? r.y[1] : r.y[0];
    const slices = [];
    for (const x of xs) {
      const st = station(part.stations, x);
      if (!st) continue;
      const yc = partY(part, st);
      // keep the bay a hand's width inside the skin, so its walls never show through the hull
      let poly = insetPolygon(profile(part.profile, st).map(([y, z]) => [y + yc, z]), BAY_INSET);
      poly = clipHalf(poly, ([y]) => side * (y - wall));
      poly = clipHalf(poly, ([, z]) => z - zf);
      poly = clipHalf(poly, ([, z]) => zc - z);
      if (poly.length >= 3) slices.push({ x, poly: poly.map(([y, z]) => [Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000]) });
    }
    if (slices.length < 2) continue;
    out.push({ window: w.id, room: r.id, deck: r.deck, kind: 'bay', side, x: [w.x[0], w.x[1]], slices, rail: w.rail === false ? null : { y: wall, z: [zf, zf + PONY_WALL] } });
  }
  return out;
}

/**
 * The ladder in a ladder well (or the rungs in a vent shaft), mounted on the
 * wall the shaft names (ladderWall: '-x' | '+x' | '-y' | '+y'), and a hatch
 * frame wherever the well passes through a deck or a ceiling. Boxes {x, y, z}.
 */
export function ladderParts(ship, s) {
  const wall = s.ladderWall || '-x';
  const ax = wall[1] === 'x' ? 0 : 1; // the axis the wall faces along
  const out = wall[0] === '+' ? 1 : -1;
  const span = [s.x, s.y][ax], across = [s.x, s.y][1 - ax];
  const off = s.kind === 'vent' ? 0.08 : 0.14; // rails stand off the wall
  const face = out > 0 ? span[1] - off : span[0] + off;
  const c = (across[0] + across[1]) / 2, half = Math.min(0.24, (across[1] - across[0]) / 2 - 0.06);
  const box = (a, b, z) => (ax === 0 ? { x: a, y: b, z } : { x: b, y: a, z });
  const rails = [-1, 1].map((k) => box([face - 0.03, face + 0.03], [c + k * half - 0.03, c + k * half + 0.03], [s.z[0], s.z[1]]));
  const rungs = [];
  for (let z = s.z[0] + 0.3; z < s.z[1] - 0.1; z += 0.3) rungs.push(box([face - 0.02, face + 0.02], [c - half, c + half], [z - 0.02, z + 0.02]));
  // hatch frames: at every deck floor or ceiling the well passes through, and where it opens into something at either end
  const frames = [];
  if (s.kind === 'ladder') {
    const planes = new Set();
    for (const d of ship.decks || []) for (const z of d.z) if (z > s.z[0] + 0.01 && z < s.z[1] - 0.01) planes.add(z);
    const ceilings = new Set((ship.decks || []).map((d) => d.z[1]));
    if (ceilings.has(s.z[0])) planes.add(s.z[0]);
    if (!ceilings.has(s.z[1])) planes.add(s.z[1]);
    const t = 0.1, m = 0.08;
    for (const z of [...planes].sort((p, q) => p - q)) {
      const X = [s.x[0] - m, s.x[1] + m], Y = [s.y[0] - m, s.y[1] + m], Z = [z - 0.05, z + 0.05];
      frames.push({ x: X, y: [Y[0], Y[0] + t], z: Z }, { x: X, y: [Y[1] - t, Y[1]], z: Z }, { x: [X[0], X[0] + t], y: Y, z: Z }, { x: [X[1] - t, X[1]], y: Y, z: Z });
    }
  }
  return { rails, rungs, frames };
}

/** The ship.json edits this arrangement needs (doors that move by more than half a door width). */
export function proposedChanges(report, tolerance = 0.6) {
  const out = [];
  for (const h of report.hatches) {
    if (Math.abs(h.uA - h.curA) > tolerance) out.push({ hatch: h.id, side: 'a', room: h.a, from: h.curA, to: h.uA });
    if (Math.abs(h.uB - h.curB) > tolerance) out.push({ hatch: h.id, side: 'b', room: h.b, from: h.curB, to: h.uB });
  }
  return out;
}

/**
 * A window lying flush on a hull part: the strip of one profile edge
 * (`edge`, from vertex i to i+1, between fractions t[0]..t[1]) swept from
 * x[0] to x[1], nudged a few centimeters outward. Returns quads [[x,y,z] ×4].
 * A window with `cap` instead sits on a flat transverse face at that x.
 */
export function windowQuads(ship, w, step = 1) {
  if (w.cap) {
    const x = w.cap, [y0, y1] = w.y, [z0, z1] = w.z;
    return [[[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]]];
  }
  const part = hullParts(ship).find((p) => p.id === w.part);
  if (!part) return [];
  const xs = [];
  for (let x = w.x[0]; x < w.x[1] - 1e-6; x += step) xs.push(x);
  xs.push(w.x[1]);
  const strip = xs.map((x) => {
    const st = station(part.stations, x);
    if (!st) return null;
    const pts = profile(part.profile, st);
    const yc = partY(part, st);
    const A = pts[w.edge], B = pts[(w.edge + 1) % pts.length];
    const dy = B[0] - A[0], dz = B[1] - A[1];
    const l = Math.hypot(dy, dz) || 1;
    const ny = -dz / l * 0.04, nz = dy / l * 0.04; // profiles run clockwise: (-dz, dy) points out
    const at = (t) => [x, yc + A[0] + dy * t + ny, A[1] + dz * t + nz];
    // a band given in ship coordinates (w.y across a flat deck, w.z up a wall) becomes edge fractions here
    const clamp = (t) => Math.min(1, Math.max(0, t));
    let t = w.t;
    if (w.y && Math.abs(dy) > 1e-6) t = w.y.map((y) => clamp((y - yc - A[0]) / dy));
    else if (w.z && Math.abs(dz) > 1e-6) t = w.z.map((z) => clamp((z - A[1]) / dz));
    return [at(Math.min(...t)), at(Math.max(...t))];
  });
  const quads = [];
  for (let i = 0; i < strip.length - 1; i++) if (strip[i] && strip[i + 1]) quads.push([strip[i][0], strip[i][1], strip[i + 1][1], strip[i + 1][0]]);
  return quads;
}
