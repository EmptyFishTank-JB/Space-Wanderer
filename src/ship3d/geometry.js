// Pure geometry for the 3D ship arrangement (data/ship3d.json): hull
// cross-sections, containment, room-local coordinates, and the consistency
// check against the sim's room graph (data/ship.json). No DOM.

const lerp = (a, b, t) => a + (b - a) * t;

/** Interpolated hull station {b, zk, zt} at x, or null outside the hull. */
export function station(stations, x) {
  const s = [...stations].sort((a, b) => b.x - a.x); // fore → aft
  if (x > s[0].x || x < s[s.length - 1].x) return null;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], c = s[i + 1];
    if (x <= a.x && x >= c.x) {
      const t = (a.x - x) / (a.x - c.x);
      return { b: lerp(a.b, c.b, t), zk: lerp(a.z[0], c.z[0], t), zt: lerp(a.z[1], c.z[1], t) };
    }
  }
  return null;
}

/**
 * Cross-section outline (y, z) at a station, counter-clockwise. The main
 * hull is a flattened hexagon (sharp flanks, flat deck and keel); the head
 * superstructure is a chamfered box.
 */
export function profile(kind, st) {
  const { b, zk, zt } = st;
  const h = zt - zk;
  const pts = kind === 'head'
    ? [[0.75 * b, zt], [b, zt - Math.min(0.8, h * 0.3)], [b, zk], [-b, zk], [-b, zt - Math.min(0.8, h * 0.3)], [-0.75 * b, zt]]
    : [[0.62 * b, zt], [b, zt - 0.45 * h], [0.92 * b, zk + 0.18 * h], [0.55 * b, zk], [-0.55 * b, zk], [-0.92 * b, zk + 0.18 * h], [-b, zt - 0.45 * h], [-0.62 * b, zt]];
  return pts;
}

function inPoly(pts, y, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, zi] = pts[i], [yj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && y < ((yj - yi) * (z - zi)) / (zj - zi) + yi) inside = !inside;
  }
  return inside;
}

/** Is the point inside the main hull or the head superstructure? */
export function insideHull(ship, x, y, z) {
  for (const kind of ['main', 'head']) {
    const st = station(ship.hull[kind], x);
    if (st && inPoly(profile(kind, st), y, z)) return true;
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

/** Distance from a point to a room box (0 inside). */
export function boxDistance(r, p) {
  const z = r.zRange;
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

/**
 * Check the arrangement against the sim's room graph. Returns
 * { ok, problems: [...], hatches: [{id, a, b, uA, uB, curA, curB, kind}], volumes }.
 * uA/uB are the door positions the geometry implies; curA/curB what ship.json
 * says today.
 */
export function checkArrangement(ship, sim) {
  const problems = [];
  const rooms = withDecks(ship);
  const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const simRooms = Object.fromEntries(sim.rooms.map((r) => [r.id, r]));
  // every sim compartment is placed, with the sim's length
  for (const r of sim.rooms) {
    if (r.exterior) continue;
    const g = byId[r.id];
    if (!g) { problems.push(`room ${r.id} is not placed`); continue; }
    const L = roomLength(g);
    if (Math.abs(L - r.width) > 0.05 && !g.resize) problems.push(`room ${r.id}: length ${L.toFixed(2)} m, sim says ${r.width} m`);
  }
  // no two rooms overlap
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const o = (p, q) => Math.min(p[1], q[1]) - Math.max(p[0], q[0]);
      if (o(a.x, b.x) > 0.01 && o(a.y, b.y) > 0.01 && o(a.zRange, b.zRange) > 0.01) problems.push(`rooms ${a.id} and ${b.id} overlap`);
    }
  }
  // every room corner is inside the hull
  for (const r of rooms) {
    for (const x of r.x) for (const y of r.y) for (const z of r.zRange) {
      const inset = [x - Math.sign(x - (r.x[0] + r.x[1]) / 2) * 0.05, y - Math.sign(y - (r.y[0] + r.y[1]) / 2) * 0.05, z - Math.sign(z - (r.zRange[0] + r.zRange[1]) / 2) * 0.05];
      if (!insideHull(ship, ...inset)) problems.push(`room ${r.id} pokes out of the hull near (${x}, ${y}, ${z})`);
    }
  }
  // hatches: door points sit on both rooms' walls, at the positions the sim walks to
  const hatches = [];
  const geo = Object.fromEntries(ship.hatches.map((h) => [h.id, h]));
  for (const h of sim.hatches) {
    const g = geo[h.id];
    if (!g) { problems.push(`hatch ${h.id} is not placed`); continue; }
    const A = byId[h.a], B = byId[h.b];
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
  const volumes = {};
  for (const r of rooms) volumes[r.id] = (r.x[1] - r.x[0]) * (r.y[1] - r.y[0]) * (r.zRange[1] - r.zRange[0]);
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
