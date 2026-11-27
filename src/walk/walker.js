// Someone walking the ship: a pair of eyes 1.62 m above the deck (1.0 m
// crouched, a hand's breadth over the duct floor crawling), moving at a walk
// or a run, sliding along walls, through open doors, never into machinery,
// up and down the ladder wells and the freight lift, up through a grille into
// the ductwork and along it on hands and knees, and up and down the vent
// shafts' rungs. The walker is only a viewer: nothing here touches the sim.
import { walkable, roomAt, climbsNear, landingSpot, crawlable, ductExits, BODY_R } from './world.js';

export const EYE = 1.62, EYE_CROUCH = 1.0, EYE_CRAWL = 0.34;
const WALK = 1.5, RUN = 3.2, CROUCH = 0.7, CRAWL = 0.6; // m/s
const CLIMB = 0.9, LIFT = 1.4; // m/s up a ladder, in the lift car

const lerp = (a, b, k) => a + (b - a) * k;
const ease = (u) => u * u * (3 - 2 * u);

export class Walker {
  constructor(world) {
    this.world = world;
    this.x = 0; this.y = 0; this.deck = 'main'; this.z = 0;
    this.yaw = 0; this.pitch = 0;
    this.mode = 'room'; // 'room' | 'duct'
    this.duct = null;
    this.crouch = false;
    this.eyeH = EYE;
    this.move = null; // a climb, a ride or a scramble in progress
    this.room = null;
    this.bob = 0;
    this.moving = false;
  }

  /** Stand in a room: at a spot (or its middle), facing a direction. */
  place(roomId, x = null, y = null, yaw = null) {
    const r = this.world.rooms[roomId];
    if (!r) return false;
    this.mode = 'room'; this.duct = null;
    this.deck = r.deck; this.z = r.z[0];
    let px = x ?? (r.x[0] + r.x[1]) / 2, py = y ?? (r.y[0] + r.y[1]) / 2;
    if (!walkable(this.world, r.deck, px, py) || roomAt(this.world, r.deck, px, py) !== r) {
      // the nearest clear spot in the room
      let best = null, bd = Infinity;
      for (let qx = r.x[0] + 0.1; qx < r.x[1]; qx += 0.2) for (let qy = r.y[0] + 0.1; qy < r.y[1]; qy += 0.2) {
        const d = Math.hypot(qx - px, qy - py);
        if (d < bd && walkable(this.world, r.deck, qx, qy) && roomAt(this.world, r.deck, qx, qy) === r) { best = [qx, qy]; bd = d; }
      }
      if (best) [px, py] = best;
    }
    this.x = px; this.y = py;
    if (yaw !== null) this.yaw = yaw;
    this.move = null;
    this.room = roomAt(this.world, this.deck, this.x, this.y) || r;
    this.eyeH = this.crouch ? EYE_CROUCH : EYE;
    return true;
  }

  get eye() { return [this.x, this.y, this.z + this.eyeH + Math.sin(this.bob) * (this.mode === 'duct' ? 0.015 : 0.025)]; }
  get busy() { return !!this.move; }

  /** What's within reach to climb, ride or crawl into, from where the walker is. */
  exits() {
    if (this.move) return [];
    if (this.mode === 'duct') return ductExits(this.world, this.duct, this.x, this.y);
    return climbsNear(this.world, this.room, this.x, this.y);
  }

  /** Take the way up (or down) in reach. Returns a word for what happened, or null. */
  go(dir) {
    const c = this.exits().find((q) => q.dir === dir);
    if (!c) return null;
    if (c.sealed) return 'sealed';
    const W = this.world;
    if (c.shaft) {
      // a ladder well or the lift: over to it, up (or down), off at the other deck
      const to = W.rooms[c.to];
      const end = landingSpot(W, c.shaft, c.to, [this.x, this.y]);
      const mid = [(c.shaft.x[0] + c.shaft.x[1]) / 2, (c.shaft.y[0] + c.shaft.y[1]) / 2];
      const dz = Math.abs(to.z[0] - this.z);
      this.move = { kind: c.shaft.kind === 'lift' ? 'lift' : 'ladder', shaft: c.shaft, start: [this.x, this.y], mid, end, z0: this.z, z1: to.z[0], eye0: this.eyeH, eye1: EYE, t: 0, dur: 0.8 + dz / (c.shaft.kind === 'lift' ? LIFT : CLIMB), arrive: { mode: 'room', room: c.to } };
      this.crouch = false;
      return c.shaft.kind === 'lift' ? 'lift' : 'ladder';
    }
    if (c.grille && this.mode === 'room') {
      // up through a ceiling grille (or down through one in the floor) into a duct, on hands and knees
      const d = W.ducts.find((q) => q.id === c.duct), g = c.grille;
      const mid = [(g.x[0] + g.x[1]) / 2, (g.y[0] + g.y[1]) / 2];
      this.move = { kind: 'grille', grille: g, start: [this.x, this.y], mid, end: nearestCrawl(d, mid), z0: this.z, z1: d.floor, eye0: this.eyeH, eye1: EYE_CRAWL, t: 0, dur: 2.2, arrive: { mode: 'duct', duct: d.id } };
      return 'duct';
    }
    if (c.grille && this.mode === 'duct') {
      // out through the grille into the room under (or over) it
      const r = W.rooms[c.to], g = c.grille;
      const mid = [(g.x[0] + g.x[1]) / 2, (g.y[0] + g.y[1]) / 2];
      const end = landingSpot(W, { x: g.x, y: g.y }, c.to, [this.x, this.y]);
      this.move = { kind: 'grille', grille: g, start: [this.x, this.y], mid, end, z0: this.z, z1: r.z[0], eye0: this.eyeH, eye1: this.crouch ? EYE_CROUCH : EYE, t: 0, dur: 2.2, arrive: { mode: 'room', room: c.to } };
      return 'room';
    }
    if (c.vent) {
      // the rungs of a vent shaft, up or down to the next duct
      const d = W.ducts.find((q) => q.id === c.duct), v = c.vent;
      const mid = [(v.x[0] + v.x[1]) / 2, (v.y[0] + v.y[1]) / 2];
      this.move = { kind: 'vent', vent: v, start: [this.x, this.y], mid, end: nearestCrawl(d, mid), z0: this.z, z1: d.floor, eye0: this.eyeH, eye1: EYE_CRAWL, t: 0, dur: 1.0 + Math.abs(d.floor - this.z) / CLIMB, arrive: { mode: 'duct', duct: d.id } };
      return 'vent';
    }
    return null;
  }

  /** Crouch or stand (in a room; in a duct you crawl). */
  toggleCrouch() {
    if (this.mode !== 'room' || this.move) return;
    this.crouch = !this.crouch;
  }

  /**
   * Advance by dt seconds. input: { fwd, side (−1..1), run, turn (rad/s), look: [dyaw, dpitch] }.
   * Returns what happened: { arrived?: { mode, room | duct } }.
   */
  step(dt, input = {}) {
    const out = {};
    if (input.look) { this.yaw += input.look[0]; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + input.look[1])); }
    if (input.turn) this.yaw += input.turn * dt;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    // the eye settles to its height: standing, crouched, crawling
    const want = this.mode === 'duct' ? EYE_CRAWL : this.crouch ? EYE_CROUCH : EYE;
    if (!this.move) this.eyeH += (want - this.eyeH) * Math.min(1, dt * 8);
    if (this.move) {
      const c = this.move;
      c.t += dt;
      const u = Math.min(1, c.t / c.dur);
      if (u < 0.15) { const k = ease(u / 0.15); this.x = lerp(c.start[0], c.mid[0], k); this.y = lerp(c.start[1], c.mid[1], k); }
      else if (u > 0.85) { const k = ease((u - 0.85) / 0.15); this.x = lerp(c.mid[0], c.end[0], k); this.y = lerp(c.mid[1], c.end[1], k); }
      else { this.x = c.mid[0]; this.y = c.mid[1]; }
      const zu = ease(Math.max(0, Math.min(1, (u - 0.12) / 0.76)));
      this.z = lerp(c.z0, c.z1, zu);
      this.eyeH = lerp(c.eye0, c.eye1, zu);
      if (u >= 1) {
        this.move = null;
        this.x = c.end[0]; this.y = c.end[1]; this.z = c.z1; this.eyeH = c.eye1;
        if (c.arrive.mode === 'room') {
          const r = this.world.rooms[c.arrive.room];
          this.mode = 'room'; this.duct = null; this.deck = r.deck;
          this.room = roomAt(this.world, this.deck, this.x, this.y) || r;
        } else {
          this.mode = 'duct'; this.duct = this.world.ducts.find((q) => q.id === c.arrive.duct);
          this.room = null;
        }
        out.arrived = c.arrive;
      }
      return out;
    }
    const fwd = input.fwd || 0, side = input.side || 0;
    const mag = Math.hypot(fwd, side);
    this.moving = mag > 0.01;
    if (!this.moving) return out;
    const pace = this.mode === 'duct' ? CRAWL : this.crouch ? CROUCH : input.run ? RUN : WALK;
    const sp = pace * Math.min(1, mag) * dt;
    const f = [Math.cos(this.yaw), Math.sin(this.yaw)], r = [-f[1], f[0]]; // right is to starboard of the heading
    const dx = ((f[0] * fwd + r[0] * side) / mag) * sp, dy = ((f[1] * fwd + r[1] * side) / mag) * sp;
    const ok = this.mode === 'duct' ? (x, y) => crawlable(this.duct, x, y) : (x, y) => walkable(this.world, this.deck, x, y);
    // in small steps, sliding along whatever is in the way
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.1));
    for (let i = 0; i < n; i++) {
      const sx = dx / n, sy = dy / n;
      if (ok(this.x + sx, this.y + sy)) { this.x += sx; this.y += sy; }
      else if (ok(this.x + sx, this.y)) this.x += sx;
      else if (ok(this.x, this.y + sy)) this.y += sy;
    }
    this.bob += Math.hypot(dx, dy) * (this.mode === 'duct' ? 7 : input.run ? 4.2 : 5.2);
    if (this.mode === 'room') { const here = roomAt(this.world, this.deck, this.x, this.y); if (here) this.room = here; }
    return out;
  }
}

/** The nearest crawlable point in a duct to a spot (a vent's foot, a grille). */
function nearestCrawl(duct, p) {
  let best = p, bd = Infinity;
  for (const sg of duct.segs) {
    const x = Math.max(sg.box.x[0] + 0.25, Math.min(sg.box.x[1] - 0.25, p[0])), y = Math.max(sg.box.y[0] + 0.25, Math.min(sg.box.y[1] - 0.25, p[1]));
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

export { BODY_R };
