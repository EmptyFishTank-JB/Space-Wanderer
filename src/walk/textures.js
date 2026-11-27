// What the walls, floors and ceilings look like when you walk the ship: drawn
// with the camera feeds' own routines and colors. A sim room's back wall is
// its feed drawing itself (redrawn live, so LEDs blink, crops grow and a
// fault shows), its furniture on a second layer that stands a little off the
// wall. Every other wall is the same plating, and the floors and ceilings are
// the room's deck and trim. Openings are cut where the 3D layout puts them,
// with frames and signs, like the feeds draw them. Needs a canvas (the browser).
import { PPM, FLOOR, CEIL, rect, hline, vline, px, mul, text, textWidth, hash, glow } from '../render/gfx.js';
import { drawRoomWalk, themeFor, floorFor, SHORT, LED } from '../render/rooms.js';
import { drawTraveler } from '../render/traveler.js';
import { registerRoomPicks, registerMugPick, picks } from '../render/picks.js';
import { DOOR_H } from './world.js';

export const BAND = FLOOR - CEIL; // the feeds' wall band, floor to ceiling: 110 px
export const FPPM = 16; // floors and ceilings, at half the walls' resolution
const canvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));
const ctx2 = (c) => c.getContext('2d', { willReadFrequently: true });
const texOf = (c, x, y, w, h, wrap = false) => ({ w, h, data: new Uint32Array(ctx2(c).getImageData(x, y, w, h).data.buffer.slice(0)), wrap });

/** A room's short name, for the signs over its doors. */
export const shortName = (room) => SHORT[room.id] || room.name.toUpperCase().replace(/^THE /, '').replace(/[^A-Z0-9 ]/g, '').split(/\s+/).slice(0, 2).join(' ').slice(0, 11);

function sign(ctx, label, x, y) {
  const w = textWidth(label);
  rect(ctx, [30, 32, 36], x - w / 2 - 2, y, w + 4, 8);
  text(ctx, label, x - w / 2, y + 2, [150, 190, 170]);
}

/** The plating every wall shares: panels, seams, trim top and bottom, grime low down. */
function plating(ctx, th, w, grime = 0, x0 = 0) {
  rect(ctx, th.wall, x0, 0, w, BAND);
  for (let x = 0; x < w; x += 48) {
    vline(ctx, mul(th.wall, 0.82), x0 + x, 0, BAND);
    for (let y = 30; y < BAND; y += 36) hline(ctx, mul(th.wall, 0.88), x0 + x + 1, x0 + x + 47, y);
    px(ctx, mul(th.wall, 1.15), x0 + x + 3, 3);
  }
  rect(ctx, th.trim, x0, 0, w, 3);
  rect(ctx, mul(th.trim, 0.85), x0, BAND - 4, w, 4);
  for (let i = 0; i < 40 * grime * (w / 320); i++) px(ctx, mul(th.wall, 0.7), x0 + hash(i, 1, 7) * w, BAND - 6 - hash(i, 2, 7) * 18, 0.6);
}

/**
 * Cut a wall's openings into its canvas (rows in band space, `top` px down
 * the canvas): doors with their frames and the sign of the room beyond,
 * windows with trim and mullions, bays the full height. `props` is cut too,
 * but low furniture stays in front of a bay's pony wall.
 */
function cutOpenings(ctx, props, room, list, lenPx, wallLen, top, rooms) {
  const k = lenPx / wallLen;
  const row = (z) => top + Math.round(BAND * (1 - z / room.h));
  const th = themeFor(room.id, room.role);
  for (const o of list) {
    const x0 = Math.round(o.s0 * k), x1 = Math.round(o.s1 * k), y0 = row(o.z1), y1 = row(o.z0);
    if (o.kind === 'door') {
      rect(ctx, [36, 38, 42], x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 3);
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      if (props) props.clearRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 2);
      sign(ctx, shortName(rooms[o.to]), (x0 + x1) / 2, y0 - 13);
      px(ctx, LED.ok, x1 + 2, y0 + 30);
    } else if (o.kind === 'lift') {
      // the lift's own doors in the wall, shut, with its sign
      rect(ctx, [36, 38, 42], x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 3);
      const m = (x0 + x1) >> 1;
      rect(ctx, [110, 114, 122], x0, y0, m - x0 - 1, y1 - y0); rect(ctx, [110, 114, 122], m + 1, y0, x1 - m - 1, y1 - y0);
      rect(ctx, [200, 160, 60], x0, y1 - 3, x1 - x0, 2);
      sign(ctx, 'LIFT', m, y0 - 13);
      px(ctx, LED.ok, x1 + 3, y0 + 30); px(ctx, LED.warn, x1 + 3, y0 + 34);
      if (props) props.clearRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 2);
    } else if (o.kind === 'bay') {
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      if (props) props.clearRect(x0, y0, x1 - x0, row(1.0) - y0);
    } else {
      rect(ctx, mul(th.trim, 0.9), x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      if (props) props.clearRect(x0, y0, x1 - x0, y1 - y0);
      if (o.kind === 'canopy' || x1 - x0 > 80) for (let x = x0 + 64; x < x1 - 8; x += 64) rect(ctx, th.trim, x - 1, y0, 3, y1 - y0);
    }
  }
}

export class TextureStore {
  constructor(world, data) {
    this.world = world;
    this.data = data;
    this.walls = new Map(); // `${room}:${side}` -> tex (the plain walls)
    this.flats = new Map(); // `${room}:floor|ceil` -> tex
    this.backs = new Map(); // room -> { shell, props, picks, at }
    this.shared = this.makeShared();
  }

  theme(room) { return themeFor(room.id, room.role); }

  /** A plain wall: plating, its openings cut, signs over its doors. */
  wall(room, side) {
    const key = `${room.id}:${side}`;
    let t = this.walls.get(key);
    if (t) return t;
    const w = room.walls.find((q) => q.side === side);
    const lenPx = Math.max(4, Math.round(w.len * PPM));
    const c = canvas(lenPx, BAND), g = ctx2(c);
    plating(g, this.theme(room), lenPx, 0);
    cutOpenings(g, null, room, room.openings[side], lenPx, w.len, 0, this.world.rooms);
    t = texOf(c, 0, 0, lenPx, BAND);
    this.walls.set(key, t);
    return t;
  }

  /**
   * The back wall, live: the room's feed drawing (shell and furniture on two
   * layers) with the 3D layout's openings cut in. Redrawn a few times a second
   * while it's in view. Also what on it can be selected, in its own pixels.
   */
  back(room, m, every = 0.15) {
    const e = this.backs.get(room.id);
    if (e && m.t - e.at < every && m.t >= e.at) return e;
    const { state, data, t, alpha } = m;
    const sim = room.sim ? data.rooms[room.id] : null;
    const def = sim || { id: room.id, name: room.name, width: room.len, floor: floorFor(room.role), stations: {} };
    const lenPx = Math.max(4, Math.round(def.width * PPM));
    const cache = e || { shellC: canvas(lenPx, FLOOR + 2), propsC: canvas(lenPx, FLOOR + 2) };
    const sc = ctx2(cache.shellC), pc = ctx2(cache.propsC);
    sc.clearRect(0, 0, lenPx, FLOOR + 2); pc.clearRect(0, 0, lenPx, FLOOR + 2);
    const back = room.walls.find((q) => q.side === room.back);
    // furniture keeps clear of the doors in this wall
    const avoid = room.openings[room.back].filter((o) => o.kind === 'door').map((o) => [(o.s0 * def.width) / back.len, (o.s1 * def.width) / back.len]);
    const rc = {
      ctx: sc, state, s: state, data, d: data, room: room.id, ox: 0, M: (xm) => xm * PPM, t, alpha: alpha || 0,
      lights: [], lamps: [], windows: [], seed: 1, powerDim: state.ship.power.lightLevel ?? 1, flash: 0,
      walk: true, theme: this.theme(room), roomDef: def, avoid,
    };
    drawRoomWalk(sc, pc, rc);
    // the mug, wherever it was left, and what on this wall can be selected
    picks.begin();
    if (sim) {
      registerRoomPicks(rc, null);
      const mug = registerMugPick(rc);
      if (mug) { rect(pc, [206, 204, 196], mug.x - 2, mug.y - 4, 4, 5); rect(pc, [206, 204, 196], mug.x + 2, mug.y - 3, 1, 2); }
    }
    const found = picks.all().filter((p) => p.id.startsWith('st:') || p.id === 'mug');
    // the little lights glow
    for (const g of [sc, pc]) {
      g.globalCompositeOperation = 'lighter';
      for (const l of rc.lights) if (!l.wide) glow(g, l.c, l.x, l.y, l.r, l.a);
      g.globalCompositeOperation = 'source-over';
    }
    cutOpenings(sc, pc, room, room.openings[room.back], lenPx, back.len, CEIL, this.world.rooms);
    const out = { shell: texOf(cache.shellC, 0, CEIL, lenPx, BAND), props: texOf(cache.propsC, 0, CEIL, lenPx, BAND), picks: found, at: t, lenPx, shellC: cache.shellC, propsC: cache.propsC };
    this.backs.set(room.id, out);
    return out;
  }

  /** The deck underfoot: the room's floor color and material, hatches and grilles in it. */
  floor(room) {
    const key = `${room.id}:floor`;
    let t = this.flats.get(key);
    if (t) return t;
    const th = this.theme(room);
    const mat = room.sim ? this.data.rooms[room.id].floor : floorFor(room.role);
    const w = Math.max(2, Math.round((room.x[1] - room.x[0]) * FPPM)), h = Math.max(2, Math.round((room.y[1] - room.y[0]) * FPPM));
    const c = canvas(w, h), g = ctx2(c);
    rect(g, th.floor, 0, 0, w, h);
    if (mat === 'grating' || mat === 'damp_deck') { for (let x = 0; x < w; x += 2) vline(g, mul(th.floor, 0.7), x, 0, h); for (let y = 0; y < h; y += 8) hline(g, mul(th.floor, 0.6), 0, w, y); }
    else if (mat === 'tile') { for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) rect(g, mul(th.floor, ((x + y) / 8) % 2 ? 0.92 : 1.05), x, y, 8, 8); }
    else if (mat === 'carpet' || mat === 'padded') { for (let i = 0; i < w * h * 0.15; i++) px(g, mul(th.floor, 0.86 + 0.2 * hash(i, 3, 9)), hash(i, 1, 9) * w, hash(i, 2, 9) * h); }
    else { for (let x = 0; x < w; x += 16) vline(g, mul(th.floor, 0.8), x, 0, h); for (let y = 0; y < h; y += 16) hline(g, mul(th.floor, 0.8), 0, w, y); for (let x = 2; x < w; x += 16) for (let y = 2; y < h; y += 16) px(g, mul(th.floor, 1.2), x, y); }
    if (mat === 'damp_deck') for (let i = 0; i < 20; i++) rect(g, [110, 140, 150], hash(i, 4, 3) * w, hash(i, 5, 3) * h, 4, 1, 0.35);
    this.holes(g, room, room.openings.floor, w, h);
    t = texOf(c, 0, 0, w, h);
    this.flats.set(key, t);
    return t;
  }

  /** Overhead: the trim color, a light panel every couple of meters, hatches, grilles and skylight wells. */
  ceiling(room) {
    const key = `${room.id}:ceil`;
    let t = this.flats.get(key);
    if (t) return t;
    const th = this.theme(room);
    const w = Math.max(2, Math.round((room.x[1] - room.x[0]) * FPPM)), h = Math.max(2, Math.round((room.y[1] - room.y[0]) * FPPM));
    const c = canvas(w, h), g = ctx2(c);
    rect(g, mul(th.trim, 0.8), 0, 0, w, h);
    for (let x = 0; x < w; x += 22) vline(g, mul(th.trim, 0.6), x, 0, h);
    // light panels across the room, every 2.5 m along it, like the feeds' ceiling lights
    const alongX = room.axis[0] !== 0;
    const L = alongX ? w : h, D = alongX ? h : w;
    for (let a = 1.25 * FPPM; a < L; a += 2.5 * FPPM) {
      const p = room.axis[0] < 0 || room.axis[1] < 0 ? L - a : a;
      if (alongX) rect(g, [215, 214, 200], p - 4, Math.max(1, D * 0.2), 8, Math.max(2, D * 0.6));
      else rect(g, [215, 214, 200], Math.max(1, D * 0.2), p - 4, Math.max(2, D * 0.6), 8);
    }
    this.holes(g, room, room.openings.ceil, w, h);
    t = texOf(c, 0, 0, w, h);
    this.flats.set(key, t);
    return t;
  }

  holes(g, room, list, w, h) {
    const X = (x) => Math.round((x - room.x[0]) * FPPM), Y = (y) => Math.round((y - room.y[0]) * FPPM);
    for (const o of list) {
      const x0 = X(o.x[0]), x1 = X(o.x[1]), y0 = Y(o.y[0]), y1 = Y(o.y[1]);
      if (o.kind === 'grille') {
        // a grille into the ductwork: a frame and slats
        rect(g, [40, 42, 46], x0, y0, x1 - x0, y1 - y0);
        for (let x = x0 + 1; x < x1 - 1; x += 2) vline(g, [110, 114, 120], x, y0 + 1, y1 - 2);
        continue;
      }
      // a well or a skylight: the hole, with a hazard-striped edge round a hatch
      if (o.kind === 'shaft') for (let i = -2; i < x1 - x0 + 2; i += 2) { px(g, (i >> 1) % 2 ? [200, 160, 60] : [30, 30, 30], x0 + i, y0 - 1); px(g, (i >> 1) % 2 ? [200, 160, 60] : [30, 30, 30], x0 + i, y1); }
      g.clearRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  /** Shared bits: a door panel, a hatch lid, duct plating, a duct grille, a lift car's face, the shutters' armor. */
  makeShared() {
    const door = canvas(30, 66), dg = ctx2(door);
    rect(dg, [96, 100, 106], 0, 0, 30, 66);
    rect(dg, [120, 124, 130], 2, 2, 26, 2);
    rect(dg, [70, 74, 80], 14, 6, 2, 54);
    rect(dg, [200, 160, 60], 4, 60, 22, 2);
    const lid = canvas(16, 16), lg = ctx2(lid);
    rect(lg, [96, 100, 106], 0, 0, 16, 16);
    for (let i = 0; i < 16; i += 2) { px(lg, (i >> 1) % 2 ? [200, 160, 60] : [30, 30, 30], i, 0); px(lg, (i >> 1) % 2 ? [200, 160, 60] : [30, 30, 30], i, 15); }
    rect(lg, [70, 74, 80], 6, 7, 4, 2);
    const duct = canvas(32, 29), ug = ctx2(duct);
    rect(ug, [78, 82, 88], 0, 0, 32, 29);
    vline(ug, [58, 60, 66], 0, 0, 28); hline(ug, [92, 96, 102], 0, 31, 1); hline(ug, [60, 62, 68], 0, 31, 27);
    for (const y of [4, 24]) for (const x of [4, 28]) px(ug, [110, 114, 120], x, y);
    const grille = canvas(16, 16), gg = ctx2(grille);
    for (let x = 0; x < 16; x += 2) vline(gg, [96, 100, 106], x, 0, 15);
    hline(gg, [70, 74, 80], 0, 15, 0); hline(gg, [70, 74, 80], 0, 15, 15);
    const lift = canvas(32, BAND), fg = ctx2(lift);
    rect(fg, [84, 88, 96], 0, 0, 32, BAND);
    rect(fg, [36, 38, 42], 3, BAND - 70, 26, 70); rect(fg, [110, 114, 122], 5, BAND - 68, 11, 68); rect(fg, [110, 114, 122], 16, BAND - 68, 11, 68);
    rect(fg, [30, 32, 36], 7, BAND - 82, 18, 8); text(fg, 'LIFT', 8, BAND - 80, [150, 190, 170]);
    const armor = canvas(32, 32), ag = ctx2(armor);
    rect(ag, [58, 60, 66], 0, 0, 32, 32);
    for (let y = 0; y < 32; y += 6) { hline(ag, [76, 78, 86], 0, 31, y); hline(ag, [40, 42, 46], 0, 31, y + 5); }
    return {
      door: texOf(door, 0, 0, 30, 66), lid: texOf(lid, 0, 0, 16, 16), duct: texOf(duct, 0, 0, 32, 29, true),
      grille: texOf(grille, 0, 0, 16, 16, true), lift: texOf(lift, 0, 0, 32, BAND), armor: texOf(armor, 0, 0, 32, 32, true),
    };
  }
}

/** A person, drawn by the feeds' own figure routine into a small sprite: 64×80 px, feet at the bottom middle. */
const spriteCanvas = canvas(64, 80);
export function personSprite(k, t, privacy = false) {
  const g = ctx2(spriteCanvas);
  g.clearRect(0, 0, 64, 80);
  const lying = k.pose === 'lie';
  drawTraveler(g, 32, lying ? 74 : 78, { ...k, x: 0, y: 78 }, t);
  if (privacy) {
    // the broadcast mosaic over the body, as the feeds do it
    const B = 4, img = g.getImageData(20, 36, 24, 42), d = img.data;
    for (let by = 0; by < 42; by += B) for (let bx = 0; bx < 24; bx += B) {
      let r = 0, gg = 0, b = 0, a = 0;
      for (let yy = by; yy < Math.min(42, by + B); yy++) for (let xx = bx; xx < Math.min(24, bx + B); xx++) { const i = (yy * 24 + xx) * 4; r += d[i] * d[i + 3]; gg += d[i + 1] * d[i + 3]; b += d[i + 2] * d[i + 3]; a += d[i + 3]; }
      if (!a) continue;
      for (let yy = by; yy < Math.min(42, by + B); yy++) for (let xx = bx; xx < Math.min(24, bx + B); xx++) { const i = (yy * 24 + xx) * 4; d[i] = r / a; d[i + 1] = gg / a; d[i + 2] = b / a; d[i + 3] = 255; }
    }
    g.putImageData(img, 20, 36);
  }
  return texOf(spriteCanvas, 0, 0, 64, 80);
}

export { DOOR_H };
