// Autonomous camera director + the viewer's (only) controls: switching feeds
// and panning within a camera's physical bounds. No DOM here: time is passed
// in, randomness is injected, so the behavior is testable.
import { W, PPM } from './gfx.js';

export const EXT = 'CAM-08';
export const EVA = 'EVA-POV';

const between = (rng, [a, b]) => a + (b - a) * rng();

export class Director {
  constructor(cameras, { rng = Math.random, idleReturnSeconds } = {}) {
    this.feeds = cameras.feeds;
    this.cfg = cameras.director;
    this.rng = rng;
    this.idle = Math.min(this.cfg.idleReturnRange[1], Math.max(this.cfg.idleReturnRange[0], idleReturnSeconds ?? this.cfg.idleReturnSeconds));
    this.byRoom = {};
    for (const f of this.feeds) if (f.room) this.byRoom[f.room] = f.id;
    this.mode = 'auto';
    this.feed = null;
    this.shotStart = 0;
    this.minShot = 30;
    this.pending = null; // { feed, at } — a cut waiting out the linger
    this.hold = null; // { feed, until, kind } — exterior / foreshadowing shot
    this.lastInput = -Infinity;
    this.panOffset = 0;
    this.camX = {};
    this.fade = null; // { start, dur }
    this.nextExteriorAt = null;
    this.nextForeshadowAt = null;
    this.log = [];
  }

  feedDef(id) { return this.feeds.find((f) => f.id === id); }
  feedForRoom(room) { return room === 'surface' ? EVA : this.byRoom[room] || null; }

  cut(now, feed, { fade = false, reason = 'follow' } = {}) {
    if (feed === this.feed) return;
    this.feed = feed;
    this.shotStart = now;
    this.minShot = between(this.rng, this.cfg.minShotSeconds);
    if (fade) this.fade = { start: now, dur: this.cfg.fadeSeconds * 2 };
    this.log.push({ t: now, feed, reason });
    if (this.log.length > 50) this.log.shift();
  }

  boot(now, feed) {
    this.feed = feed;
    this.shotStart = now;
    this.fade = { start: now, dur: this.cfg.bootFadeSeconds, boot: true };
    this.nextExteriorAt = now + 60 * between(this.rng, this.cfg.exteriorEveryMinutes);
    this.nextForeshadowAt = now + 60 * between(this.rng, this.cfg.foreshadowEveryMinutes);
  }

  // ── viewer input (camera only; nothing here can touch the simulation) ──
  input(now) { this.lastInput = now; }
  select(now, feed) {
    if (!this.feedDef(feed)) return;
    this.input(now);
    this.mode = 'manual';
    this.hold = null;
    this.pending = null;
    this.panOffset = 0;
    this.cut(now, feed, { reason: 'viewer' });
  }
  cycle(now, dir) {
    const i = this.feeds.findIndex((f) => f.id === this.feed);
    this.select(now, this.feeds[(i + dir + this.feeds.length) % this.feeds.length].id);
  }
  pan(now, dx) {
    this.input(now);
    if (this.mode !== 'manual') { this.mode = 'manual'; this.pending = null; this.hold = null; }
    this.panOffset += dx;
  }

  /**
   * Advance the director.
   * c: { travelerRoom, eva, events: [{type, phase}], shipMode, travelerStill, interestingRooms: [room] }
   */
  update(now, c) {
    const target = c.eva ? EVA : this.feedForRoom(c.travelerRoom) || this.feed;
    if (this.feed === null) { this.boot(now, target); return this.feed; }

    // idle return: smoothly back to the traveler
    if (this.mode === 'manual') {
      if (now - this.lastInput < this.idle) return this.feed;
      this.mode = 'auto';
      this.panOffset = 0;
      this.hold = null;
      this.pending = null;
      this.cut(now, target, { fade: true, reason: 'idle-return' });
      return this.feed;
    }

    // during EVA the helmet cam owns the screen
    if (c.eva) { this.hold = null; this.pending = null; this.cut(now, EVA, { reason: 'eva' }); return this.feed; }
    if (this.feed === EVA) { this.cut(now, target, { reason: 'eva-end' }); return this.feed; }

    // high-scale events cut to the hull camera
    for (const e of c.events || []) {
      let dur = this.cfg.eventExterior[e.type];
      if (!dur && e.type === 'descent_phase' && this.cfg.descentExteriorPhases.includes(e.phase)) dur = 30;
      if (!dur) continue;
      const major = ['hyperspace_charge', 'hyperspace_exit', 'touchdown', 'liftoff', 'scoop_start', 'torpor_start', 'descent_phase'].includes(e.type);
      if (major || now - this.shotStart >= this.minShot) {
        this.hold = { feed: EXT, until: now + dur, kind: 'exterior' };
        this.pending = null;
        this.cut(now, EXT, { reason: e.type });
      }
    }

    if (this.hold) {
      if (now < this.hold.until) return this.feed;
      this.hold = null;
      this.cut(now, target, { reason: 'hold-end' });
      return this.feed;
    }

    // following the traveler between rooms: linger on the empty room first
    if (this.feed !== target) {
      if (!this.pending) this.pending = { at: now + between(this.rng, this.cfg.lingerSeconds) };
      if (now >= this.pending.at) { this.pending = null; this.cut(now, target, { reason: 'follow' }); }
      return this.feed;
    }
    this.pending = null;

    // discretionary shots, only after a patient minimum shot length
    if (now - this.shotStart < this.minShot) return this.feed;
    if (now >= this.nextExteriorAt) {
      this.nextExteriorAt = now + 60 * between(this.rng, this.cfg.exteriorEveryMinutes);
      if (['cruise', 'orbit', 'scooping', 'landed', 'idle', 'void'].includes(c.shipMode)) {
        this.hold = { feed: EXT, until: now + between(this.rng, this.cfg.exteriorHoldSeconds), kind: 'exterior' };
        this.cut(now, EXT, { reason: 'exterior' });
        return this.feed;
      }
    }
    if (now >= this.nextForeshadowAt) {
      this.nextForeshadowAt = now + 60 * between(this.rng, this.cfg.foreshadowEveryMinutes);
      const rooms = (c.interestingRooms || []).filter((r) => r !== c.travelerRoom && this.byRoom[r]);
      if (c.travelerStill && rooms.length) {
        const room = rooms[Math.floor(this.rng() * rooms.length)];
        this.hold = { feed: this.byRoom[room], until: now + between(this.rng, this.cfg.foreshadowHoldSeconds), kind: 'foreshadow' };
        this.cut(now, this.byRoom[room], { reason: 'foreshadow' });
      }
    }
    return this.feed;
  }

  /** 0..1 darkness for fades (idle return dips to black and back; boot fades in). */
  fadeAmount(now) {
    if (!this.fade) return 0;
    const u = (now - this.fade.start) / this.fade.dur;
    if (u >= 1) { this.fade = null; return 0; }
    if (this.fade.boot) return 1 - u;
    return u < 0.5 ? 1 - Math.abs(u - 0.5) * 2 : 1 - (u - 0.5) * 2;
  }

  /**
   * Camera x (left edge, in room pixels) for a room feed: eased tracking with
   * a dead zone, plus the viewer's manual pan within physical bounds.
   */
  cameraX(feed, roomWidthM, travelerX, dt, travelerHere) {
    const roomW = roomWidthM * PPM;
    let target;
    const margin = 36;
    if (roomW <= W) target = (roomW - W) / 2;
    else {
      const cur = this.camX[feed] ?? Math.min(Math.max(0, travelerX - W / 2), roomW - W);
      target = cur;
      if (travelerHere) {
        const rel = travelerX - cur;
        if (rel < W * 0.32) target = travelerX - W * 0.32;
        if (rel > W * 0.68) target = travelerX - W * 0.68;
      }
      target = Math.min(Math.max(0, target), roomW - W);
    }
    const lo = Math.min(0, (roomW - W) / 2) - margin;
    const hi = Math.max(roomW - W, (roomW - W) / 2) + margin;
    // keep the manual offset inside the camera's physical bounds
    if (target + this.panOffset < lo) this.panOffset = lo - target;
    if (target + this.panOffset > hi) this.panOffset = hi - target;
    const goal = target + this.panOffset;
    const prev = this.camX[feed] ?? goal;
    const next = prev + (goal - prev) * Math.min(1, dt * 1.8);
    this.camX[feed] = next;
    return next;
  }
}

/** Rooms where something is quietly happening (for foreshadowing holds). */
export function interestingRooms(state) {
  const s = state.ship;
  const out = [];
  if (s.ops.lampOn && s.trays.some((t) => t.crop && t.water < 0.85)) out.push('hydro');
  const C = s.components;
  if (Object.entries(C).some(([id, c]) => c.fault && ['reactor_core', 'thermal_vents', 'scoop_manifold', 'drive_coil'].includes(id)) || s.thermal.heat > 0.6 || s.flight.mode === 'charging') out.push('engineering');
  if (['water_recycler', 'o2_scrubber', 'ogs', 'dehumidifier'].some((id) => C[id].fault || C[id].wear > 0.6)) out.push('lifesupport');
  if (C.junction_box_fore.fault) out.push('corridor_fore');
  if (C.corridor_lights_aft.fault) out.push('corridor_aft');
  if (s.ops.fabricating) out.push('workshop');
  if (s.food.mealReady) out.push('galley');
  return out;
}
