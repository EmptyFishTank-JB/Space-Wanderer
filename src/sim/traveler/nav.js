// Navigation over the ship's room graph. Positions are {room, x}. The graph's
// nodes are hatch endpoints; walking inside a room costs |dx| / speed and each
// hatch has a fixed pneumatic cycle time. Costs are in seconds at base speed.

export function buildNav(ship) {
  const endpoints = []; // {room, x, hatch, other}
  const hatches = {};
  for (const h of ship.hatches) {
    hatches[h.id] = h;
    const ia = endpoints.length;
    endpoints.push({ room: h.a, x: h.ax, hatch: h.id, other: ia + 1 });
    endpoints.push({ room: h.b, x: h.bx, hatch: h.id, other: ia });
  }
  const byRoom = {};
  endpoints.forEach((e, i) => (byRoom[e.room] ||= []).push(i));
  return { endpoints, byRoom, hatches };
}

/**
 * Single-source shortest times from `from` to every hatch endpoint.
 * Returns {dist, prev} arrays indexed by endpoint.
 */
export function dijkstra(nav, from, speed) {
  const n = nav.endpoints.length;
  const dist = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1); // -1: reached directly from source
  const done = new Array(n).fill(false);
  for (const i of nav.byRoom[from.room] || []) dist[i] = Math.abs(from.x - nav.endpoints[i].x) / speed;
  for (;;) {
    let u = -1;
    let best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) break;
    done[u] = true;
    const eu = nav.endpoints[u];
    // through the hatch
    const v = eu.other;
    const hs = nav.hatches[eu.hatch].seconds;
    if (dist[u] + hs < dist[v]) { dist[v] = dist[u] + hs; prev[v] = u; }
    // walking within the room to another endpoint
    for (const w of nav.byRoom[eu.room]) {
      if (w === u) continue;
      const c = dist[u] + Math.abs(eu.x - nav.endpoints[w].x) / speed;
      if (c < dist[w]) { dist[w] = c; prev[w] = u; }
    }
  }
  return { dist, prev };
}

/** Travel time (s) from the dijkstra origin to target {room, x}. */
export function timeTo(nav, from, sp, target, speed) {
  if (target.room === from.room) return Math.abs(target.x - from.x) / speed;
  let best = Infinity;
  for (const i of nav.byRoom[target.room] || []) {
    const c = sp.dist[i] + Math.abs(target.x - nav.endpoints[i].x) / speed;
    if (c < best) best = c;
  }
  return best;
}

/**
 * Plan a path as a list of segments:
 *  {kind:'walk', room, x0, x1}
 *  {kind:'hatch', hatch, from, to, x0, x1, seconds}
 */
export function planPath(nav, from, target, speed = 1) {
  if (target.room === from.room) {
    return from.x === target.x ? [] : [{ kind: 'walk', room: from.room, x0: from.x, x1: target.x }];
  }
  const sp = dijkstra(nav, from, speed);
  let best = Infinity;
  let last = -1;
  for (const i of nav.byRoom[target.room] || []) {
    const c = sp.dist[i] + Math.abs(target.x - nav.endpoints[i].x) / speed;
    if (c < best) { best = c; last = i; }
  }
  if (last < 0) return null;
  // Reconstruct endpoint chain.
  const chain = [];
  for (let i = last; i >= 0; i = sp.prev[i]) chain.unshift(i);
  const segs = [];
  let cur = { room: from.room, x: from.x };
  for (let k = 0; k < chain.length; k++) {
    const e = nav.endpoints[chain[k]];
    const p = k > 0 ? nav.endpoints[chain[k - 1]] : null;
    if (p && p.other === chain[k]) {
      // crossed a hatch from p to e
      segs.push({ kind: 'hatch', hatch: e.hatch, from: p.room, to: e.room, x0: p.x, x1: e.x, seconds: nav.hatches[e.hatch].seconds });
      cur = { room: e.room, x: e.x };
    } else {
      if (e.room !== cur.room) throw new Error('nav: inconsistent path');
      if (e.x !== cur.x) segs.push({ kind: 'walk', room: cur.room, x0: cur.x, x1: e.x });
      cur = { room: e.room, x: e.x };
    }
  }
  if (cur.room !== target.room) throw new Error('nav: path did not reach target room');
  if (cur.x !== target.x) segs.push({ kind: 'walk', room: cur.room, x0: cur.x, x1: target.x });
  return segs;
}
