// The walkable ship: every pressurized space in the 3D layout
// (data/ship3d.json) as a box with a floor, a ceiling and four walls, the
// doors cut where the layout puts them, the ladder wells and the freight lift
// between decks, the window bays and skylight wells, the glass in upright
// walls and the bridge canopy, and the machinery that stands in a room. Each
// sim room's "back wall" (the one its camera looks at) carries the room's own
// drawing from the camera feeds; the other walls, floors and ceilings are
// plain plating in the room's colors. Pure geometry: no DOM, testable in node.
//
// Coordinates are the ship frame: x fore, y starboard, z up, in meters.
import { withDecks, roomU, roomLength, windowBays, windowQuads, ladderParts, hullParts, station, moduleExtent, segmentBox } from '../ship3d/geometry.js';

export const DOOR_W = 0.95;
export const DOOR_H = 2.05;
export const BODY_R = 0.25; // the walker's radius
export const PROP_DEPTH = 0.35; // the props layer stands this far off the back wall
export const CRAWL_R = 0.2; // half a body's width, on hands and knees in a duct
const PROP_KEEP = 0.62; // and the walker keeps this far from the back wall

const AXIS = { '+x': [1, 0], '-x': [-1, 0], '+y': [0, 1], '-y': [0, -1] };
const EPS = 1e-6;

/**
 * The four walls of a room box, each with its inward normal, its length and
 * the direction its texture runs (screen-right when you face it from inside).
 * side: 'x0' | 'x1' | 'y0' | 'y1'.
 */
function roomWalls(r) {
  const [x0, x1] = r.x, [y0, y1] = r.y;
  return [
    { side: 'x0', n: [1, 0], a: [x0, y1], b: [x0, y0] },  // aft wall: looking aft (-x), right is -y
    { side: 'x1', n: [-1, 0], a: [x1, y0], b: [x1, y1] }, // fore wall: looking fore, right is +y
    { side: 'y0', n: [0, 1], a: [x0, y0], b: [x1, y0] },  // port wall: looking port (-y), right is +x
    { side: 'y1', n: [0, -1], a: [x1, y1], b: [x0, y1] }, // starboard wall: looking starboard, right is -x
  ].map((w) => ({ ...w, len: Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), dir: [(w.b[0] - w.a[0]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), (w.b[1] - w.a[1]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])] }));
}

/** Which wall of a room a point on its boundary lies in, and how far along it (s). */
function wallAt(room, p, tol = 0.45) {
  let best = null;
  for (const w of room.walls) {
    // distance from the wall's line, and the position along it
    const d = Math.abs((p[0] - w.a[0]) * w.n[0] + (p[1] - w.a[1]) * w.n[1]);
    const s = (p[0] - w.a[0]) * w.dir[0] + (p[1] - w.a[1]) * w.dir[1];
    if (s < -0.2 || s > w.len + 0.2) continue;
    if (d < tol && (!best || d < best.d)) best = { wall: w, d, s };
  }
  return best;
}

const inBox = (r, x, y, m = 0) => x >= r.x[0] - m && x <= r.x[1] + m && y >= r.y[0] - m && y <= r.y[1] + m;

/** Build the walkable ship from the 3D layout and the sim's data (rooms, nav). */
export function buildWorld(S, data) {
  const decks = Object.fromEntries(S.decks.map((d) => [d.id, d]));
  const rooms = {};
  for (const r of withDecks(S)) {
    const sim = data.rooms[r.id] && !['surface', 'port'].includes(r.id) ? data.rooms[r.id] : null;
    const A = AXIS[r.axis];
    const V = [A[1], -A[0]]; // the camera's look: axis × up
    const walls = roomWalls(r);
    // the back wall is the one in the look direction
    const back = walls.find((w) => w.n[0] === -V[0] && w.n[1] === -V[1]);
    rooms[r.id] = {
      id: r.id, name: (sim && sim.name) || r.name || r.id, info: r.info || '', role: r.role, deck: r.deck, sim: !!sim,
      x: r.x, y: r.y, z: r.zRange, h: r.zRange[1] - r.zRange[0], axis: A, look: V, origin: r.origin, axisName: r.axis,
      len: roomLength(r), walls, back: back.side, openings: { x0: [], x1: [], y0: [], y1: [], floor: [], ceil: [] },
      doors: [], shafts: [], bays: [], solids: [], blocks: [],
    };
  }
  const R = (id) => rooms[id];
  const problems = [];

  // ───── doors: the sim's hatches where the layout gives them a place, and the layout's own doors ─────
  const doors = [];
  const geoHatch = Object.fromEntries(S.hatches.map((h) => [h.id, h]));
  const addDoor = (id, a, b, at, simHatch = null) => {
    const A = R(a), B = R(b);
    if (!A || !B) { problems.push(`door ${id}: unknown room ${!A ? a : b}`); return; }
    const wa = wallAt(A, at), wb = wallAt(B, at);
    if (!wa || !wb) { problems.push(`door ${id}: not on a wall of ${!wa ? a : b}`); return; }
    // the door's center line through both walls (they may be a wall's thickness apart)
    const n = wa.wall.n; // into A
    const along = [-n[1], n[0]];
    const dA = (at[0] - wa.wall.a[0]) * n[0] + (at[1] - wa.wall.a[1]) * n[1];
    const pa = [at[0] - n[0] * dA, at[1] - n[1] * dA]; // the door's center in A's wall
    const gap = Math.abs((wb.wall.a[0] - wa.wall.a[0]) * n[0] + (wb.wall.a[1] - wa.wall.a[1]) * n[1]);
    const mid = [pa[0] - (n[0] * gap) / 2, pa[1] - (n[1] * gap) / 2]; // halfway through the wall(s)
    // the slot through the doorway reaches as far into each room as the walker has to keep off that wall
    const keep = (room, side) => (room.sim && room.back === side ? PROP_KEEP : BODY_R);
    const reach = gap / 2 + Math.max(keep(A, wa.wall.side), keep(B, wb.wall.side)) + 0.12;
    const d = { id, a, b, simHatch, at: mid, z: Math.max(A.z[0], B.z[0]), n, along, gap, reach, wallA: wa.wall.side, wallB: wb.wall.side, sA: wa.s, sB: wb.s, open: 0 };
    doors.push(d);
    A.doors.push(d); B.doors.push(d);
    A.openings[wa.wall.side].push({ kind: 'door', s0: wa.s - DOOR_W / 2, s1: wa.s + DOOR_W / 2, z0: 0, z1: DOOR_H, to: b, door: d });
    B.openings[wb.wall.side].push({ kind: 'door', s0: wb.s - DOOR_W / 2, s1: wb.s + DOOR_W / 2, z0: 0, z1: DOOR_H, to: a, door: d });
  };
  for (const h of Object.values(data.nav.hatches)) {
    const g = geoHatch[h.id];
    if (!g) continue;
    if (g.at && (g.kind === 'door' || !g.kind)) addDoor(h.id, h.a, h.b, g.at, h.id);
    else if (g.path && g.kind === 'passage') {
      // a passage: a door out of each end room into the passage that runs between them
      const mid = g.path[0].map((v, i) => (v + g.path[g.path.length - 1][i]) / 2);
      const via = Object.values(rooms).find((r) => inBox(r, mid[0], mid[1]) && mid[2] >= r.z[0] - 0.01 && mid[2] <= r.z[1]);
      if (via) {
        // each end of the path opens into whichever of the two rooms it touches
        const p0 = g.path[0], p1 = g.path[g.path.length - 1];
        const touches = (id, p) => !!(R(id) && wallAt(R(id), p));
        const [e0, e1] = touches(h.a, p0) || !touches(h.b, p0) ? [h.a, h.b] : [h.b, h.a];
        addDoor(`${h.id}:0`, e0, via.id, p0, h.id); addDoor(`${h.id}:1`, via.id, e1, p1, h.id);
      }
      else problems.push(`passage ${h.id}: no room along its path`);
    }
  }
  (S.doors || []).forEach((d, i) => addDoor(`door:${i}:${d.between.join('-')}`, d.between[0], d.between[1], d.at));

  // ───── shafts: ladder wells and the freight lift, open through every floor and ceiling they pass ─────
  const shafts = [];
  for (const s of S.shafts || []) {
    if (s.kind !== 'ladder' && s.kind !== 'lift') continue;
    const stops = (s.opensTo || []).map(R).filter(Boolean).sort((p, q) => p.z[0] - q.z[0]);
    if (stops.length < 2) continue; // a ladder up to a lifeboat, not between rooms
    const parts = s.kind === 'ladder' ? ladderParts(S, s) : { rails: [], rungs: [], frames: [] };
    const hatches = S.hatches.filter((h) => h.path && h.kind === 'ladder' && h.path.every((q) => q[0] >= s.x[0] - 0.05 && q[0] <= s.x[1] + 0.05 && q[1] >= s.y[0] - 0.05 && q[1] <= s.y[1] + 0.05)).map((h) => h.id);
    const sh = { id: s.id, kind: s.kind, name: s.name || s.id, info: s.info || '', x: s.x, y: s.y, z: s.z, stops: stops.map((r) => r.id), parts, ladderWall: s.ladderWall || '-x', hatches };
    shafts.push(sh);
    for (const r of Object.values(rooms)) {
      // a room the shaft passes through: holes where it goes down through the floor and up through the ceiling
      if (!(s.x[0] < r.x[1] - EPS && s.x[1] > r.x[0] + EPS && s.y[0] < r.y[1] - EPS && s.y[1] > r.y[0] + EPS)) continue;
      if (!(s.z[0] < r.z[1] - EPS && s.z[1] > r.z[0] + EPS)) continue;
      r.shafts.push(sh);
      if (s.kind === 'lift') { r.blocks.push({ x: s.x, y: s.y, what: sh }); continue; } // the car's own walls
      // a ladder well: a hatch in the floor and in the ceiling, its lid shut (and walked over) unless someone is climbing
      if (s.z[0] < r.z[0] - EPS) r.openings.floor.push({ kind: 'shaft', x: s.x, y: s.y, shaft: sh });
      if (s.z[1] > r.z[1] + EPS) r.openings.ceil.push({ kind: 'shaft', x: s.x, y: s.y, shaft: sh });
    }
    // a lift beside a passage rather than in it: its doors are in the passage's wall
    for (const r of stops) {
      if (r.shafts.includes(sh)) continue;
      const gap = Math.max(s.x[0] - r.x[1], r.x[0] - s.x[1], s.y[0] - r.y[1], r.y[0] - s.y[1]);
      if (gap > 0.6) continue;
      const side = s.y[1] <= r.y[0] + 0.01 ? 'y0' : s.y[0] >= r.y[1] - 0.01 ? 'y1' : s.x[1] <= r.x[0] + 0.01 ? 'x0' : 'x1';
      const wall = r.walls.find((q) => q.side === side);
      const c = [(s.x[0] + s.x[1]) / 2, (s.y[0] + s.y[1]) / 2];
      const sc = (c[0] - wall.a[0]) * wall.dir[0] + (c[1] - wall.a[1]) * wall.dir[1];
      const half = Math.min(0.7, (side[0] === 'y' ? s.x[1] - s.x[0] : s.y[1] - s.y[0]) / 2);
      r.shafts.push(sh);
      r.openings[side].push({ kind: 'lift', s0: Math.max(0.2, sc - half), s1: Math.min(wall.len - 0.2, sc + half), z0: 0, z1: DOOR_H, shaft: sh });
    }
  }

  // ───── glass: window bays and skylight wells, windows in upright walls, canopies ─────
  const bays = windowBays(S);
  const bayWin = new Set(bays.map((b) => b.window));
  const winById = Object.fromEntries((S.windows || []).map((w) => [w.id, w]));
  for (const b of bays) {
    const r = R(b.room);
    if (!r) continue;
    const w = winById[b.window];
    const glass = windowQuads(S, w, 1);
    const bay = { ...b, glass, name: w.name, info: w.info || '', win: w.id };
    r.bays.push(bay);
    if (b.kind === 'well') {
      const ys = b.slices.flatMap((sl) => sl.poly.map((p) => p[0]));
      r.openings.ceil.push({ kind: 'well', x: b.x, y: [Math.min(...ys), Math.max(...ys)], bay });
    } else {
      // the bay opens the whole wall height over its length; a pony wall stands in the opening
      const side = b.side > 0 ? 'y1' : 'y0';
      const wall = r.walls.find((q) => q.side === side);
      const s = b.x.map((x) => (x - wall.a[0]) * wall.dir[0]).sort((p, q) => p - q);
      r.openings[side].push({ kind: 'bay', s0: Math.max(0, s[0]), s1: Math.min(wall.len, s[1]), z0: 0, z1: r.h, bay });
      if (b.rail) r.solids.push({ kind: 'pony', x: b.x, y: [b.rail.y - 0.07, b.rail.y + 0.07], z: [r.z[0], r.z[0] + 0.95], color: 'trim' }, { kind: 'rail', x: b.x, y: [b.rail.y - 0.04, b.rail.y + 0.04], z: [r.z[0] + 1.02, r.z[0] + 1.07], color: [150, 156, 160] });
    }
  }
  for (const w of S.windows || []) {
    const r = R(w.backs);
    if (!r || w.cap || bayWin.has(w.id)) continue;
    // glass set straight into a wall the room already reaches
    const quads = windowQuads(S, w, 1);
    if (!quads.length) continue;
    const ys = quads.flat().map((q) => q[1]), zs = quads.flat().map((q) => q[2]);
    const side = ys.reduce((a, v) => a + v, 0) > 0 ? 'y1' : 'y0';
    const wall = r.walls.find((q) => q.side === side);
    const s = w.x.map((x) => (x - wall.a[0]) * wall.dir[0]).sort((p, q) => p - q);
    const z0 = Math.max(0.3, Math.min(...zs) - r.z[0]), z1 = Math.min(r.h - 0.15, Math.max(...zs) - r.z[0]);
    if (z1 - z0 > 0.2) r.openings[side].push({ kind: 'window', s0: Math.max(0.15, s[0]), s1: Math.min(wall.len - 0.15, s[1]), z0, z1, win: { id: w.id, name: w.name, info: w.info || '' } });
  }
  for (const p of hullParts(S)) {
    if (!p.glass) continue;
    for (const r of Object.values(rooms)) {
      // a room whose forward wall stands under a raked canopy looks out through it
      if (r.x[1] < p.glass.x[0] - 0.01 || r.x[1] > p.glass.x[1] + 0.01) continue;
      const st = station(p.stations, r.x[1]);
      if (!st || r.z[0] < st.zk - 0.1 || r.z[1] > st.zt + 0.1) continue;
      const z0 = Math.max(1.0, st.zk + p.glass.above - r.z[0]), z1 = r.h - 0.15;
      if (z1 - z0 > 0.3) r.openings.x1.push({ kind: 'canopy', s0: 0.35, s1: r.y[1] - r.y[0] - 0.35, z0, z1, win: { id: `glass:${p.id}`, name: `${p.name || 'Canopy'} glazing`, info: 'The raked canopy, glazed from above the consoles to the roof.' } });
    }
  }

  // ───── machinery standing in a room ─────
  for (const m of S.modules || []) {
    const e = moduleExtent(m);
    const c = [(e.x[0] + e.x[1]) / 2, (e.y[0] + e.y[1]) / 2, (e.z[0] + e.z[1]) / 2];
    const r = Object.values(rooms).find((q) => inBox(q, c[0], c[1]) && c[2] >= q.z[0] && c[2] <= q.z[1]);
    if (!r) continue;
    r.solids.push({ kind: 'module', module: m, x: e.x, y: e.y, z: [Math.max(e.z[0], r.z[0]), Math.min(e.z[1], r.z[1])], name: m.name, info: m.info || '' });
    r.blocks.push({ x: [e.x[0] - 0.1, e.x[1] + 0.1], y: [e.y[0] - 0.1, e.y[1] + 0.1], what: m });
  }

  // ───── the crawlable ductwork: runs at one height each, vent shafts with rungs between them, grilles into the rooms ─────
  const ducts = [];
  for (const d of S.ducts || []) {
    const z = d.segments[0][0][2], half = d.size / 2;
    const segs = d.segments.map(([p, q]) => {
      const box = segmentBox([p, q], d.size);
      const alongX = Math.abs(q[0] - p[0]) > Math.abs(q[1] - p[1]);
      return { p, q, box, alongX };
    });
    const duct = { id: d.id, name: d.name, info: d.info || '', size: d.size, z, floor: z - half, top: z + half, segs, grilles: [], vents: [] };
    // a grille wherever a run passes over (or under) a room
    for (const sg of segs) for (const r of Object.values(rooms)) {
      const below = Math.abs(duct.floor - r.z[1]) < 1.5 && duct.floor >= r.z[1] - 0.01; // the room's ceiling under the duct
      const above = Math.abs(r.z[0] - duct.top) < 1.5 && r.z[0] >= duct.top - 0.01; // the room's floor over the duct
      if (!below && !above) continue;
      const ox = [Math.max(sg.box.x[0], r.x[0] + 0.5), Math.min(sg.box.x[1], r.x[1] - 0.5)], oy = [Math.max(sg.box.y[0], r.y[0] + 0.5), Math.min(sg.box.y[1], r.y[1] - 0.5)];
      if (ox[1] - ox[0] < 0.5 || oy[1] - oy[0] < 0.5) continue;
      const g = { duct, room: r.id, x: [(ox[0] + ox[1]) / 2 - 0.35, (ox[0] + ox[1]) / 2 + 0.35], y: [(oy[0] + oy[1]) / 2 - 0.35, (oy[0] + oy[1]) / 2 + 0.35], where: below ? 'ceiling' : 'floor' };
      // one grille per room per run, clear of a door's swing and the wells
      if (duct.grilles.some((q) => q.room === r.id && Math.hypot(q.x[0] - g.x[0], q.y[0] - g.y[0]) < 2.5)) continue;
      duct.grilles.push(g);
      (below ? r.openings.ceil : r.openings.floor).push({ kind: 'grille', x: g.x, y: g.y, grille: g });
    }
    ducts.push(duct);
  }
  // vent shafts: a ladder of rungs between the duct levels they pass
  for (const s of (S.shafts || []).filter((q) => q.kind === 'vent')) {
    const levels = ducts.filter((d) => d.z >= s.z[0] - 0.05 && d.z <= s.z[1] + 0.05 && d.segs.some((sg) => sg.box.x[0] < s.x[1] + 0.6 && sg.box.x[1] > s.x[0] - 0.6 && sg.box.y[0] < s.y[1] + 0.6 && sg.box.y[1] > s.y[0] - 0.6)).sort((a, b) => a.z - b.z);
    if (levels.length < 2) continue;
    const v = { id: s.id, kind: 'vent', name: s.name, info: s.info || '', x: s.x, y: s.y, z: s.z, levels: levels.map((d) => d.id), parts: ladderParts(S, s) };
    for (const d of levels) d.vents.push(v);
    shafts.push(v);
  }
  // the short ladders up to the lifeboat hatches: there to climb, though the boats stay sealed
  for (const s of (S.shafts || []).filter((q) => q.kind === 'ladder' && (q.opensTo || []).length === 1)) {
    const r = R(s.opensTo[0]);
    if (!r) continue;
    const sh = { id: s.id, kind: 'stub', name: s.name, info: s.info || '', x: s.x, y: s.y, z: s.z, stops: [r.id], parts: ladderParts(S, s), ladderWall: s.ladderWall, hatches: [] };
    shafts.push(sh);
    r.shafts.push(sh);
  }

  // ───── who can get where: doors, and the ladders and the lift ─────
  const links = Object.fromEntries(Object.keys(rooms).map((id) => [id, new Set()]));
  for (const d of doors) { links[d.a].add(d.b); links[d.b].add(d.a); }
  for (const s of shafts) for (let i = 0; i < (s.stops || []).length - 1; i++) { links[s.stops[i]].add(s.stops[i + 1]); links[s.stops[i + 1]].add(s.stops[i]); }

  return { rooms, doors, shafts, ducts, decks, problems, links, hatchDoors: Object.fromEntries(doors.filter((d) => d.simHatch).map((d) => [d.id, d])) };
}

// ───── room-local coordinates: the sim's position along a room, and depth off its back wall ─────

/** The back wall of a room as a line: a point on it and the inward normal. */
function backLine(r) {
  const w = r.walls.find((q) => q.side === r.back);
  return { p: w.a, n: w.n, w };
}

/** A point in the ship frame from a room position: u along the room (the sim's x), d off the back wall, h above the floor. */
export function roomPoint(r, u, d, h = 0) {
  const { p, n } = backLine(r);
  const A = r.axis;
  // along the axis from the origin, then in from the back wall
  const ax = A[0] !== 0 ? r.origin + A[0] * u : null, ay = A[1] !== 0 ? r.origin + A[1] * u : null;
  const x = ax !== null ? ax : p[0] + n[0] * d;
  const y = ay !== null ? ay : p[1] + n[1] * d;
  return [x, y, r.z[0] + h];
}

/** The sim's u (along the room) and the depth off the back wall of a ship-frame point. */
export function roomLocal(r, x, y) {
  const { p, n } = backLine(r);
  return { u: roomU({ axis: r.axisName, origin: r.origin }, [x, y]), d: (x - p[0]) * n[0] + (y - p[1]) * n[1] };
}

/** The room a point on a deck is in (inside its box), or null. */
export function roomAt(world, deck, x, y, margin = 0) {
  for (const r of Object.values(world.rooms)) if (r.deck === deck && inBox(r, x, y, margin)) return r;
  return null;
}

/** Can the walker stand here? Inside a room clear of its walls and props, or in a doorway; never in a well or machinery. */
export function walkable(world, deck, x, y) {
  let ok = false, here = null;
  for (const r of Object.values(world.rooms)) {
    if (r.deck !== deck || !inBox(r, x, y, 0.4)) continue;
    // keep clear of the walls, and of the furniture along a drawn back wall
    let m = [r.x[0] + BODY_R, r.x[1] - BODY_R, r.y[0] + BODY_R, r.y[1] - BODY_R];
    if (r.sim) {
      const keep = Math.min(PROP_KEEP, (r.back[0] === 'x' ? r.x[1] - r.x[0] : r.y[1] - r.y[0]) / 2 - BODY_R);
      if (r.back === 'x0') m[0] = r.x[0] + keep; if (r.back === 'x1') m[1] = r.x[1] - keep;
      if (r.back === 'y0') m[2] = r.y[0] + keep; if (r.back === 'y1') m[3] = r.y[1] - keep;
    }
    if (x >= m[0] && x <= m[1] && y >= m[2] && y <= m[3]) { ok = true; here = r; break; }
  }
  if (!ok) {
    // a doorway: a slot through the wall (or walls) between two rooms
    for (const d of world.doors) {
      if (world.rooms[d.a].deck !== deck && world.rooms[d.b].deck !== deck) continue;
      const rx = x - d.at[0], ry = y - d.at[1];
      const across = Math.abs(rx * d.n[0] + ry * d.n[1]), along = Math.abs(rx * d.along[0] + ry * d.along[1]);
      if (d.open < 0.85) continue; // a shut door is a wall
      if (along <= DOOR_W / 2 - BODY_R + 0.05 && across <= d.reach) { ok = true; break; }
    }
  }
  if (!ok) return false;
  // nothing solid underfoot or in the way: open wells, the lift car, machinery
  for (const r of Object.values(world.rooms)) {
    if (r.deck !== deck || !inBox(r, x, y, 0.5)) continue;
    for (const b of r.blocks) if (x > b.x[0] - BODY_R && x < b.x[1] + BODY_R && y > b.y[0] - BODY_R && y < b.y[1] + BODY_R) return false;
  }
  return here || true;
}

const reachOf = (b, x, y) => Math.hypot(Math.max(b.x[0] - x, 0, x - b.x[1]), Math.max(b.y[0] - y, 0, y - b.y[1]));

/** Ladders, the lift and duct grilles within reach of someone standing in a room: where each goes, up or down. */
export function climbsNear(world, room, x, y) {
  if (!room) return [];
  const out = [];
  for (const s of room.shafts) {
    if (reachOf(s, x, y) > 0.9) continue;
    if (s.kind === 'stub') { out.push({ shaft: s, dir: 'up', to: null, sealed: true }); continue; }
    const i = s.stops.indexOf(room.id);
    if (i < 0) continue;
    if (i < s.stops.length - 1) out.push({ shaft: s, dir: 'up', to: s.stops[i + 1] });
    if (i > 0) out.push({ shaft: s, dir: 'down', to: s.stops[i - 1] });
  }
  // a grille in the ceiling or the floor: up (or down) into the ductwork
  for (const d of world.ducts) for (const g of d.grilles) {
    if (g.room !== room.id || reachOf(g, x, y) > 0.55) continue;
    out.push({ grille: g, dir: g.where === 'ceiling' ? 'up' : 'down', duct: d.id });
  }
  return out;
}

/** In a duct: can you crawl here? Inside a run, with room for your shoulders. */
export function crawlable(duct, x, y) {
  for (const sg of duct.segs) if (x >= sg.box.x[0] + CRAWL_R && x <= sg.box.x[1] - CRAWL_R && y >= sg.box.y[0] + CRAWL_R && y <= sg.box.y[1] - CRAWL_R) return true;
  for (const v of duct.vents) if (x >= v.x[0] + 0.1 && x <= v.x[1] - 0.1 && y >= v.y[0] + 0.1 && y <= v.y[1] - 0.1) return true;
  return false;
}

/** In a duct: the grilles out into rooms, and the vent shafts to the other ducts, within reach. */
export function ductExits(world, duct, x, y) {
  const out = [];
  for (const g of duct.grilles) if (reachOf(g, x, y) < 0.45) out.push({ grille: g, dir: g.where === 'ceiling' ? 'down' : 'up', to: g.room });
  for (const v of duct.vents) {
    if (reachOf(v, x, y) > 0.5) continue;
    const i = v.levels.indexOf(duct.id);
    if (i < v.levels.length - 1) out.push({ vent: v, dir: 'up', duct: v.levels[i + 1] });
    if (i > 0) out.push({ vent: v, dir: 'down', duct: v.levels[i - 1] });
  }
  return out;
}

/** The nearest door within reach, roughly in front of the walker: to open or shut by hand. */
export function doorNear(world, deck, x, y, yaw) {
  let best = null, bd = 1.8;
  for (const d of world.doors) {
    if (world.rooms[d.a].deck !== deck && world.rooms[d.b].deck !== deck) continue;
    const dx = d.at[0] - x, dy = d.at[1] - y, dist = Math.hypot(dx, dy);
    if (dist > bd) continue;
    const ahead = (dx * Math.cos(yaw) + dy * Math.sin(yaw)) / (dist || 1);
    if (dist > 0.7 && ahead < 0.35) continue;
    best = d; bd = dist;
  }
  return best;
}

/** Where to stand after climbing into a room by a shaft: just off the well, on the walkable side nearest where you were. */
export function landingSpot(world, shaft, roomId, from) {
  const r = world.rooms[roomId];
  const cx = (shaft.x[0] + shaft.x[1]) / 2, cy = (shaft.y[0] + shaft.y[1]) / 2;
  const hx = (shaft.x[1] - shaft.x[0]) / 2 + BODY_R + 0.2, hy = (shaft.y[1] - shaft.y[0]) / 2 + BODY_R + 0.2;
  const cands = [[cx + hx, cy], [cx - hx, cy], [cx, cy + hy], [cx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy - hy], [cx + hx, cy - hy], [cx - hx, cy + hy]];
  cands.sort((p, q) => Math.hypot(p[0] - from[0], p[1] - from[1]) - Math.hypot(q[0] - from[0], q[1] - from[1]));
  for (const [x, y] of cands) if (walkable(world, r.deck, x, y)) return [x, y];
  // nowhere obvious: the middle of the room
  return [(r.x[0] + r.x[1]) / 2, (r.y[0] + r.y[1]) / 2];
}

export { roomWalls };
