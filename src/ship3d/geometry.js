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
      return { b: lerp(a.b, c.b, t), zk: lerp(a.z[0], c.z[0], t), zt: lerp(a.z[1], c.z[1], t) };
    }
  }
  return null;
}

/**
 * Cross-section outline (y, z) at a station, counter-clockwise, centred on
 * the part's own axis. 'hex' is a flattened hexagon (sharp flanks, flat deck
 * and keel); 'box' is a chamfered box for superstructure.
 */
export function profile(kind, st) {
  const { b, zk, zt } = st;
  const h = zt - zk;
  if (kind === 'box' || kind === 'head') {
    const ch = Math.min(0.8, h * 0.3);
    return [[0.75 * b, zt], [b, zt - ch], [b, zk], [-b, zk], [-b, zt - ch], [-0.75 * b, zt]];
  }
  return [[0.62 * b, zt], [b, zt - 0.45 * h], [0.92 * b, zk + 0.18 * h], [0.55 * b, zk], [-0.55 * b, zk], [-0.92 * b, zk + 0.18 * h], [-b, zt - 0.45 * h], [-0.62 * b, zt]];
}

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
    if (st && inPoly(profile(part.profile, st), y - part.y, z)) return true;
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
  if (m.shape === 'cyl-z') return { x: [m.x - m.r, m.x + m.r], y: [m.y - m.r, m.y + m.r], z: m.z };
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
  const volumes = {};
  for (const r of rooms) if (!r.unpressurized) volumes[r.id] = (r.x[1] - r.x[0]) * (r.y[1] - r.y[0]) * (r.zRange[1] - r.zRange[0]);
  const resizes = rooms.filter((r) => r.resize && simRooms[r.id]).map((r) => ({ room: r.id, from: simRooms[r.id].width, to: roomLength(r), why: r.resize }));
  return { ok: problems.length === 0, problems, hatches, volumes, resizes, simRooms };
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
