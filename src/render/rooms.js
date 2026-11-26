// Interior compartments, side-on. Each room is drawn every frame from live
// sim state, so wear, clutter, crop growth, faults and power are all visible
// in the room itself — never as overlays.
import { W, H, PPM, FLOOR, CEIL, mix, mul, rect, px, hash, text, textWidth, hline, vline, disc, clamp01, line } from './gfx.js';
import { trayStage } from '../sim/ship/hydroponics.js';
import { writingProgress } from '../memory/captions.js';

const THEME = {
  bridge: { wall: [56, 62, 76], trim: [40, 44, 54], floor: [66, 68, 76] },
  lounge: { wall: [92, 76, 64], trim: [66, 54, 46], floor: [96, 68, 58] },
  quarters: { wall: [104, 92, 80], trim: [78, 68, 60], floor: [84, 78, 72] },
  galley: { wall: [94, 100, 96], trim: [70, 74, 72], floor: [116, 120, 116] },
  hydro: { wall: [64, 82, 76], trim: [46, 60, 56], floor: [58, 68, 64] },
  lifesupport: { wall: [66, 76, 86], trim: [48, 56, 64], floor: [60, 64, 70] },
  engineering: { wall: [60, 58, 62], trim: [42, 40, 44], floor: [58, 58, 62] },
  workshop: { wall: [84, 78, 70], trim: [60, 56, 50], floor: [70, 68, 64] },
  storage: { wall: [80, 76, 68], trim: [58, 54, 48], floor: [72, 70, 66] },
  airlock: { wall: [78, 80, 84], trim: [56, 58, 62], floor: [70, 72, 76] },
  corridor_fore: { wall: [62, 66, 72], trim: [44, 48, 52], floor: [56, 58, 62] },
  corridor_aft: { wall: [60, 64, 68], trim: [42, 46, 50], floor: [54, 56, 60] },
};
const SHORT = { bridge: 'BRIDGE', lounge: 'LOUNGE', quarters: 'QTRS', galley: 'GALLEY', corridor_fore: 'LIVING', corridor_aft: 'SERVICE', hydro: 'HYDRO', lifesupport: 'LIFE SUP', storage: 'STORES', airlock: 'AIRLOCK', workshop: 'SHOP', engineering: 'ENG' };

const LED = { ok: [80, 230, 120], warn: [255, 180, 40], bad: [255, 60, 50], off: [40, 44, 40] };

/** Window cut-outs per room, in room meters / screen rows. */
export function roomWindows(room) {
  switch (room) {
    case 'bridge': return [{ x0: 2.0, x1: 8.4, y0: CEIL + 10, y1: FLOOR - 46 }];
    case 'lounge': return [{ x0: 2.6, x1: 6.4, y0: CEIL + 8, y1: FLOOR - 26 }];
    case 'quarters': return [{ x0: 2.15, x1: 2.75, y0: CEIL + 26, y1: CEIL + 44, round: true }];
    case 'galley': return [{ x0: 2.85, x1: 3.35, y0: CEIL + 18, y1: CEIL + 34, round: true }];
    // hydroponics reaches the starboard flank: an angled window in a bay at the outboard end, behind a pony wall
    case 'hydro': return [{ x0: 17.7, x1: 19.5, y0: CEIL + 4, y1: FLOOR - 34, bay: true }];
    // interior rooms: a virtual window, a wall screen carrying an exterior camera
    case 'engineering': return [{ x0: 6.7, x1: 8.0, y0: CEIL + 8, y1: CEIL + 26, screen: 'EXT-STERN' }];
    case 'lifesupport': return [{ x0: 2.0, x1: 3.5, y0: CEIL + 8, y1: CEIL + 26, screen: 'EXT-DORSAL' }];
    case 'storage': return [{ x0: 3.9, x1: 5.4, y0: CEIL + 8, y1: CEIL + 26, screen: 'EXT-PORT' }];
    case 'workshop': return [{ x0: 4.6, x1: 6.1, y0: CEIL + 8, y1: CEIL + 26, screen: 'EXT-STBD' }];
    default: return [];
  }
}

export function ledFor(state, id) {
  const c = state.ship.components[id];
  if (!c) return LED.off;
  if (c.fault) return c.fault.severity === 'major' ? LED.bad : LED.warn;
  return c.wear > 0.6 ? LED.warn : LED.ok;
}

function blinkLed(ctx, rc, x, y, c, rate = 1) {
  const on = c === LED.ok || Math.sin(rc.t * 6 * rate) > 0;
  px(ctx, on ? c : mul(c, 0.3), x, y);
  if (on) rc.lights.push({ x, y, c, r: 4, a: 0.25 });
}

// ───────────────────────── shell ─────────────────────────
function drawShell(ctx, rc) {
  const { room, data } = rc;
  const th = THEME[room];
  const w = data.rooms[room].width * PPM;
  const L = rc.ox, R = rc.ox + w;
  // structure outside the compartment
  rect(ctx, [16, 17, 20], 0, 0, W, H);
  for (let x = Math.floor(L / 16) * 16 - 64; x < W; x += 16) vline(ctx, [24, 25, 30], x, 0, H);
  // back wall with panel seams
  rect(ctx, th.wall, L, CEIL, w, FLOOR - CEIL);
  for (let x = 0; x < w; x += 48) {
    vline(ctx, mul(th.wall, 0.82), L + x, CEIL, FLOOR);
    for (let y = CEIL + 30; y < FLOOR; y += 36) hline(ctx, mul(th.wall, 0.88), L + x + 1, L + x + 47, y);
    px(ctx, mul(th.wall, 1.15), L + x + 3, CEIL + 3);
  }
  // wear: grime collects low on the walls
  const grime = rc.state.ship.clutter[room] || 0;
  for (let i = 0; i < 40 * grime; i++) px(ctx, mul(th.wall, 0.7), L + hash(i, 1, 7) * w, FLOOR - 4 - hash(i, 2, 7) * 18, 0.6);
  // ceiling & floor bands
  rect(ctx, th.trim, L, CEIL - 6, w, 6);
  rect(ctx, mul(th.trim, 0.7), L, 0, w, CEIL - 6);
  for (let x = 6; x < w; x += 22) rect(ctx, mul(th.trim, 0.55), L + x, 4, 10, CEIL - 12); // ribs
  hline(ctx, [70, 74, 80], L, R, 10); hline(ctx, [52, 56, 60], L, R, 16); // ducts
  drawFloor(ctx, rc, th, L, w);
  // ceiling lights
  for (let x = 40; x < w; x += 80) {
    rect(ctx, [180, 180, 170], L + x - 8, CEIL - 3, 16, 2);
    rc.lamps.push({ x: L + x, y: CEIL });
  }
  // windows: cut through to space
  for (const win of roomWindows(room)) {
    const x0 = rc.M(win.x0), x1 = rc.M(win.x1);
    rect(ctx, win.screen ? [28, 30, 34] : mul(th.trim, 0.9), x0 - 3, win.y0 - 3, x1 - x0 + 6, win.y1 - win.y0 + 6);
    if (win.round) {
      const cx = (x0 + x1) / 2, cy = (win.y0 + win.y1) / 2, r = (x1 - x0) / 2;
      ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, r, (win.y1 - win.y0) / 2, 0, 0, Math.PI * 2); ctx.clip();
      ctx.clearRect(x0, win.y0, x1 - x0, win.y1 - win.y0);
      ctx.restore();
    } else {
      ctx.clearRect(x0, win.y0, x1 - x0, win.y1 - win.y0);
      for (let x = x0 + 64; x < x1 - 8; x += 64) rect(ctx, th.trim, x - 1, win.y0, 3, win.y1 - win.y0); // mullions
    }
    if (win.screen) {
      // it is a screen, not glass: scanlines over the picture and a tiny camera tag
      for (let y = win.y0; y < win.y1; y += 2) rect(ctx, [0, 0, 0], x0, y, x1 - x0, 1, 0.22);
      rect(ctx, [120, 220, 170], x0 + 1, win.y1 - 2, 3, 1, 0.8);
    }
    if (win.bay) {
      // the window is set at the hull's angle; a pony wall with a rail keeps people off the glass
      rect(ctx, mul(th.trim, 1.1), x0 - 6, FLOOR - 30, x1 - x0 + 12, 30);
      hline(ctx, mul(th.trim, 0.7), x0 - 6, x1 + 6, FLOOR - 30);
      rect(ctx, [150, 156, 160], x0 - 6, FLOOR - 36, x1 - x0 + 12, 2);
      for (let x = x0 - 4; x <= x1 + 4; x += 14) rect(ctx, [120, 126, 130], x, FLOOR - 34, 1, 4);
    }
    rc.windows.push({ x0, x1, y0: win.y0, y1: win.y1, screen: win.screen || null });
  }
  // doors in the back wall; a ladder up runs up the wall to a hatch in the ceiling
  for (const e of data.nav.endpoints) {
    if (e.room !== room) continue;
    const other = data.nav.endpoints[e.other].room;
    if (e.kind === 'ladder' && e.dir === 'up') drawLadderUp(ctx, rc, rc.M(e.x), e.hatch, other);
    else if (e.kind === 'door') drawDoor(ctx, rc, rc.M(e.x), e.hatch, other);
  }
}

/** How far open a hatch is while the traveler cycles it (0..1). */
function hatchOpen(rc, hatch) {
  const mv = rc.state.traveler.move;
  if (!(mv && mv.segs[mv.i] && mv.segs[mv.i].kind === 'hatch' && mv.segs[mv.i].hatch === hatch)) return 0;
  const seg = mv.segs[mv.i];
  const u = clamp01((mv.segT + rc.alpha) / seg.seconds);
  return u < 0.25 ? u / 0.25 : u > 0.8 ? (1 - u) / 0.2 : 1;
}

function hatchSign(ctx, x, y, other) {
  const label = SHORT[other] || '';
  rect(ctx, [30, 32, 36], x - textWidth(label) / 2 - 2, y, textWidth(label) + 4, 8);
  text(ctx, label, x - textWidth(label) / 2, y + 2, [150, 190, 170]);
}

/** A ladder on the back wall, up through a hatch in the ceiling. */
function drawLadderUp(ctx, rc, x, hatch, other) {
  const open = hatchOpen(rc, hatch);
  const x0 = Math.round(x - 9);
  // the ceiling hatch: a dark well, its lid sliding aside as the traveler climbs
  rect(ctx, [12, 12, 14], x0 - 4, CEIL - 6, 26, 6);
  rect(ctx, [96, 100, 106], x0 - 4 + Math.round(open * 22), CEIL - 6, 26 - Math.round(open * 22), 3);
  // rails and rungs
  rect(ctx, [120, 124, 130], x0, CEIL, 2, FLOOR - CEIL);
  rect(ctx, [120, 124, 130], x0 + 16, CEIL, 2, FLOOR - CEIL);
  for (let y = FLOOR - 8; y > CEIL + 2; y -= 9) rect(ctx, [104, 108, 114], x0 + 2, y, 14, 1);
  rect(ctx, [200, 160, 60], x0 - 2, FLOOR - 2, 22, 2); // hazard stripe at its foot
  // the sign beside the ladder, on whichever side has room
  const signX = x0 + 9 + (x0 < rc.ox + 40 ? 1 : -1) * (14 + textWidth(SHORT[other] || '') / 2);
  hatchSign(ctx, signX, CEIL + 40, other);
  px(ctx, open > 0 ? LED.warn : LED.ok, x0 + 21, CEIL + 54);
}

/** A hatch in the floor with grab rails, for a ladder (or crawl duct) going down. Drawn in front of the room's furniture. */
function drawFloorHatch(ctx, rc, x, hatch, other, kind) {
  const open = hatchOpen(rc, hatch);
  const w = kind === 'crawl' ? 18 : 24, x0 = Math.round(x - w / 2);
  rect(ctx, [12, 12, 14], x0, FLOOR, w, 6);
  rect(ctx, [96, 100, 106], x0 + Math.round(open * (w - 4)), FLOOR, w - Math.round(open * (w - 4)), 2);
  rect(ctx, [200, 160, 60], x0 - 2, FLOOR - 1, w + 4, 1);
  if (kind === 'ladder') {
    // grab rails either side of the opening
    for (const rx of [x0 - 1, x0 + w - 1]) { rect(ctx, [130, 134, 140], rx, FLOOR - 30, 2, 30); }
    rect(ctx, [130, 134, 140], x0 - 1, FLOOR - 31, w + 2, 2);
  }
  hatchSign(ctx, x0 + w / 2, FLOOR - (kind === 'ladder' ? 42 : 14), other);
}

function drawFloorHatches(ctx, rc) {
  for (const e of rc.data.nav.endpoints) {
    if (e.room !== rc.room || !((e.kind === 'ladder' && e.dir === 'down') || e.kind === 'crawl')) continue;
    drawFloorHatch(ctx, rc, rc.M(e.x), e.hatch, rc.data.nav.endpoints[e.other].room, e.kind);
  }
}

function drawFloor(ctx, rc, th, L, w) {
  const mat = rc.data.rooms[rc.room].floor;
  rect(ctx, th.floor, L, FLOOR, w, 6);
  hline(ctx, mul(th.floor, 1.25), L, L + w, FLOOR);
  if (mat === 'grating' || mat === 'damp_deck') for (let x = 0; x < w; x += 4) vline(ctx, mul(th.floor, 0.6), L + x, FLOOR + 1, FLOOR + 5);
  if (mat === 'tile') for (let x = 0; x < w; x += 8) rect(ctx, mul(th.floor, (x / 8) % 2 ? 0.9 : 1.05), L + x, FLOOR + 1, 8, 5);
  if (mat === 'carpet' || mat === 'padded') for (let x = 0; x < w; x += 3) px(ctx, mul(th.floor, 0.85), L + x, FLOOR + 2 + (x % 2));
  if (mat === 'damp_deck') for (let i = 0; i < 12; i++) rect(ctx, [110, 140, 150], L + hash(i, 4, 3) * w, FLOOR + 1, 4, 1, 0.35);
  // sub-floor
  rect(ctx, [22, 23, 27], L, FLOOR + 6, w, H - FLOOR - 6);
  hline(ctx, [60, 54, 46], L, L + w, FLOOR + 12); hline(ctx, [44, 52, 60], L, L + w, FLOOR + 18);
  for (let x = 10; x < w; x += 28) rect(ctx, [34, 36, 40], L + x, FLOOR + 6, 2, H - FLOOR - 6);
}

function drawDoor(ctx, rc, x, hatch, other) {
  const w = 30, h = 68;
  const x0 = Math.round(x - w / 2), y0 = FLOOR - h;
  rect(ctx, [36, 38, 42], x0 - 3, y0 - 3, w + 6, h + 3);
  rect(ctx, [14, 14, 16], x0, y0, w, h);
  // open fraction while the traveler cycles this hatch
  let open = 0;
  const mv = rc.state.traveler.move;
  if (mv && mv.segs[mv.i] && mv.segs[mv.i].kind === 'hatch' && mv.segs[mv.i].hatch === hatch) {
    const seg = mv.segs[mv.i];
    const u = clamp01((mv.segT + rc.alpha) / seg.seconds);
    open = u < 0.3 ? u / 0.3 : u > 0.75 ? (1 - u) / 0.25 : 1;
  }
  const ph = Math.round(h * (1 - open));
  if (ph > 0) {
    rect(ctx, [96, 100, 106], x0, y0, w, ph);
    rect(ctx, [120, 124, 130], x0 + 2, y0 + 2, w - 4, 2);
    if (ph > 30) { rect(ctx, [70, 74, 80], x0 + w / 2 - 1, y0 + 6, 2, ph - 12); rect(ctx, [200, 160, 60], x0 + 4, y0 + ph - 6, w - 8, 2); }
  }
  rect(ctx, [30, 32, 36], x0 + w / 2 - textWidth(SHORT[other] || '') / 2 - 2, y0 - 12, textWidth(SHORT[other] || '') + 4, 8);
  text(ctx, SHORT[other] || '', x0 + w / 2 - textWidth(SHORT[other] || '') / 2, y0 - 10, [150, 190, 170]);
  px(ctx, open > 0 ? LED.warn : LED.ok, x0 + w + 2, y0 + 30);
}

// ───────────────────────── props helpers ─────────────────────────
function monitor(ctx, rc, x, y, w, h, draw) {
  rect(ctx, [30, 32, 36], x - 1, y - 1, w + 2, h + 2);
  rect(ctx, [6, 14, 16], x, y, w, h);
  if (rc.powerDim > 0.2) draw(x, y, w, h);
  rc.lights.push({ x: x + w / 2, y: y + h / 2, c: [80, 180, 200], r: Math.max(w, h), a: 0.12 });
}

function chair(ctx, x, facing = 1) {
  rect(ctx, [48, 50, 56], x - 6, FLOOR - 17, 12, 3);
  rect(ctx, [40, 42, 48], x - 1, FLOOR - 14, 2, 14);
  rect(ctx, [40, 42, 48], x - 5, FLOOR - 1, 10, 1);
  rect(ctx, [52, 54, 60], x - 6 * facing - (facing > 0 ? 2 : 0), FLOOR - 30, 3, 15);
}

function cabinet(ctx, x, y, w, h, c) {
  rect(ctx, c, x, y, w, h);
  rect(ctx, mul(c, 1.15), x, y, w, 1);
  rect(ctx, mul(c, 0.75), x, y + h - 1, w, 1);
  for (let i = 1; i < 3; i++) vline(ctx, mul(c, 0.8), x + (w * i) / 3, y + 2, y + h - 2);
}

function pipeV(ctx, x, y0, y1, c = [90, 96, 100]) { rect(ctx, c, x, y0, 3, y1 - y0); vline(ctx, mul(c, 1.3), x, y0, y1); }

/** A hydroponic plant, drawn by crop and growth stage. */
function plant(ctx, x, y, tray, t, seed) {
  const st = trayStage(tray);
  if (st === 'empty') return;
  const crop = tray.crop;
  const healthy = clamp01(tray.health);
  const green = mix([150, 130, 60], [70, 150, 70], healthy);
  const dark = mul(green, 0.7);
  if (st === 'dead') { for (let i = 0; i < 5; i++) vline(ctx, [96, 76, 50], x - 6 + i * 3, y - 3 - (i % 2) * 2, y); return; }
  const g = Math.min(1.25, tray.growth);
  const h = Math.max(2, Math.round((crop === 'wheat' ? 40 : crop === 'tomato' ? 38 : crop === 'lettuce' || crop === 'herbs' ? 14 : 30) * g));
  const sway = Math.round(Math.sin(t * 0.6 + seed) * (g > 0.3 ? 1 : 0));
  const droop = st === 'wilting' ? 3 : 0;
  if (crop === 'wheat') {
    for (let i = 0; i < 7; i++) {
      const sx = x - 9 + i * 3;
      vline(ctx, green, sx + sway, y - h + droop, y);
      if (g > 0.75) rect(ctx, mix([200, 180, 90], green, 0.2), sx + sway, y - h - 3 + droop, 1, 4);
    }
    return;
  }
  if (crop === 'lettuce' || crop === 'herbs') {
    const r = Math.max(1, Math.round((crop === 'lettuce' ? 8 : 5) * g));
    for (let i = -1; i <= 1; i++) disc(ctx, i === 0 ? green : dark, x + i * (r + 1) * 1.6, y - r, r);
    if (crop === 'lettuce' && g > 0.6) disc(ctx, mul(green, 1.2), x, y - r - 1, Math.max(1, r - 2));
    return;
  }
  // bushy crops: stem + leaf clusters
  vline(ctx, dark, x, y - h, y);
  const n = Math.max(1, Math.round(h / 3.5));
  for (let i = 0; i < n; i++) {
    const ly = y - 2 - i * 3.5 + droop * (i / n);
    const side = i % 2 ? 1 : -1;
    const len = 5 + (i % 3) * 2 - Math.round(i / n * 3);
    rect(ctx, i % 3 ? green : dark, x + side * 1 + sway * (i / n), ly - 2, side * len, 3);
    if (i % 2 === 0) px(ctx, mul(green, 1.25), x + side * (len - 1) + sway, ly - 3);
  }
  if (st === 'overgrown') for (let i = 0; i < 6; i++) px(ctx, dark, x - 8 + hash(i, 1, seed) * 16, y - h - hash(i, 2, seed) * 6);
  if (g > 0.75 && healthy > 0.4) {
    const fruit = crop === 'tomato' ? [200, 50, 40] : crop === 'soy' ? [140, 160, 80] : [230, 230, 210];
    for (let i = 0; i < 5; i++) px(ctx, fruit, x - 4 + hash(i, 3, seed) * 9, y - 4 - hash(i, 4, seed) * (h - 4));
  }
}

// ───────────────────────── rooms ─────────────────────────
const ROOMS = {
  bridge(ctx, rc) {
    const { M, s } = rc;
    const f = s.ship.flight;
    // forward console bank under the viewport
    rect(ctx, [44, 48, 58], M(2.0), FLOOR - 34, M(8.4) - M(2.0), 8);
    rect(ctx, [36, 40, 48], M(2.0), FLOOR - 26, M(8.4) - M(2.0), 26);
    for (let i = 0; i < 20; i++) px(ctx, hash(i, 1, 3) > 0.7 ? LED.warn : LED.ok, M(2.1) + i * 10, FLOOR - 31, 0.8);
    // helm
    monitor(ctx, rc, M(3.0) - 10, FLOOR - 50, 20, 12, (x, y, w, h) => {
      const v = f.mode === 'cruise' ? Math.min(1, Math.log10(1 + f.v * 1000) / 6.3) : f.mode === 'scooping' ? 0.05 : 0;
      rect(ctx, [60, 200, 220], x + 2, y + h - 4, Math.max(1, (w - 4) * v), 2);
      text(ctx, f.mode === 'hyperspace' ? 'FSD' : f.mode === 'cruise' ? 'SC' : f.mode === 'orbit' ? 'ORB' : f.mode === 'landed' ? 'LND' : 'IDL', x + 2, y + 2, [120, 220, 230]);
    });
    chair(ctx, M(3.0), 1);
    // nav: a little star map with the plotted route
    monitor(ctx, rc, M(4.6) - 12, FLOOR - 52, 24, 14, (x, y, w, h) => {
      for (let i = 0; i < 14; i++) px(ctx, [140, 160, 200], x + 1 + hash(i, 1, rc.seed) * (w - 2), y + 1 + hash(i, 2, rc.seed) * (h - 2));
      if (s.space.route || s.space.void) line(ctx, s.space.void ? [255, 180, 80] : [80, 220, 140], x + w / 2, y + h / 2, x + w - 3, y + 3);
      px(ctx, [255, 255, 255], x + w / 2, y + h / 2);
    });
    chair(ctx, M(4.6), 1);
    // scanner: waveform; spikes with heat and glare, static when degraded
    monitor(ctx, rc, M(6.2) - 12, FLOOR - 52, 24, 14, (x, y, w, h) => {
      const heat = s.ship.thermal.heat;
      const q = s.ship.components.bridge_sensors.fault ? 0.5 : 1;
      for (let i = 0; i < w - 2; i++) {
        const v = Math.sin(i * 0.5 + rc.t * 4) * 2 + (hash(i, Math.floor(rc.t * 8), 5) - 0.5) * (2 + heat * 10) * (2 - q);
        px(ctx, heat > 0.8 ? [255, 120, 80] : [80, 220, 160], x + 1 + i, y + h / 2 + v);
      }
    });
    chair(ctx, M(6.2), 1);
    // log terminal (standing height)
    rect(ctx, [40, 42, 50], M(7.6) - 7, FLOOR - 40, 14, 40);
    monitor(ctx, rc, M(7.6) - 9, FLOOR - 58, 18, 14, (x, y, w, h) => terminalText(ctx, rc, x, y, w, h, 'bridge'));
  },

  lounge(ctx, rc) {
    const { M, s } = rc;
    // couch facing the glass
    rect(ctx, [120, 70, 60], M(1.6), FLOOR - 18, M(3.2) - M(1.6), 10);
    rect(ctx, [104, 60, 52], M(1.6), FLOOR - 30, 6, 22);
    rect(ctx, [90, 52, 46], M(1.6), FLOOR - 8, M(3.2) - M(1.6), 8);
    // speaker with a status LED (lit while music plays)
    cabinet(ctx, M(1.3) - 7, FLOOR - 34, 14, 34, [60, 50, 44]);
    disc(ctx, [30, 26, 24], M(1.3), FLOOR - 24, 4);
    disc(ctx, [30, 26, 24], M(1.3), FLOOR - 10, 3);
    const playing = s.traveler.activity && s.traveler.activity.id === 'listen_music' && s.traveler.activity.phase === 'perform';
    blinkLed(ctx, rc, M(1.3), FLOOR - 32, playing ? LED.ok : LED.off);
    if (playing) for (let i = 0; i < 3; i++) px(ctx, [200, 200, 160], M(1.3) + 6 + i * 2, FLOOR - 26 - ((rc.t * 8 + i * 3) % 10), 0.5);
    // easel with today's sketch
    line(ctx, [110, 84, 60], M(6.0) - 6, FLOOR, M(6.0), FLOOR - 40);
    line(ctx, [110, 84, 60], M(6.0) + 6, FLOOR, M(6.0), FLOOR - 40);
    rect(ctx, [228, 222, 206], M(6.0) - 9, FLOOR - 40, 18, 16);
    for (let i = 0; i < Math.min(12, 3 + s.traveler.history.sketches % 12); i++) px(ctx, [70, 70, 90], M(6.0) - 7 + hash(i, s.traveler.history.sketches, 1) * 14, FLOOR - 38 + hash(i, 2, s.traveler.history.sketches) * 12);
    // sketches of things remembered, pinned to the wall; cleaner as the hand improves
    const pinned = (s.traveler.sketchesOf || []).slice(-6);
    pinned.forEach((sk, i) => {
      const px0 = M(6.55) + (i % 3) * 11, py0 = CEIL + 10 + Math.floor(i / 3) * 12;
      rect(ctx, [214, 208, 192], px0, py0, 9, 8);
      px(ctx, [170, 60, 50], px0 + 4, py0); // pin
      const rec = (s.memory && s.memory.records.find((r) => r.id === sk.memoryId)) || null;
      const tags = rec ? rec.tags : [];
      const ink = tags.includes('star') ? [170, 110, 50] : tags.includes('eva') ? [110, 90, 70] : tags.includes('awe') || tags.includes('rings') ? [80, 90, 130] : [70, 80, 100];
      const n = 5 + Math.round(sk.quality * 10);
      for (let k = 0; k < n; k++) {
        const jitter = (1 - sk.quality) * 1.5;
        px(ctx, ink, px0 + 1 + ((k * 3 + hash(k, sk.memoryId, 2) * jitter) % 7), py0 + 2 + (hash(k, 4, sk.memoryId) * 5), 0.85);
      }
    });
    // rowing rig
    rect(ctx, [70, 72, 78], M(6.6), FLOOR - 4, M(7.7) - M(6.6), 3);
    rect(ctx, [50, 52, 58], M(7.6), FLOOR - 16, 3, 13);
    // a potted plant in the corner
    rect(ctx, [120, 84, 60], M(7.55) - 4, FLOOR - 9, 8, 9);
    for (let i = 0; i < 9; i++) line(ctx, [70, 130, 70], M(7.55), FLOOR - 9, M(7.55) - 8 + i * 2, FLOOR - 20 - (i % 3) * 3);
  },

  quarters(ctx, rc) {
    const { M, s } = rc;
    // bunk
    rect(ctx, [80, 64, 54], M(1.15), FLOOR - 16, M(2.7) - M(1.15), 16);
    rect(ctx, [196, 190, 176], M(1.15), FLOOR - 20, M(2.7) - M(1.15), 4);
    rect(ctx, [220, 214, 204], M(1.18), FLOOR - 23, 10, 3);
    rect(ctx, [80, 64, 54], M(1.15) - 2, FLOOR - 30, 3, 30);
    // compact toilet in the wet corner beside the basin, with a slatted screen that slides out when in use
    const inUse = s.traveler.activity && s.traveler.activity.id === 'use_toilet' && s.traveler.activity.phase === 'perform';
    rect(ctx, [176, 180, 184], M(2.88) - 4, FLOOR - 11, 8, 3);
    rect(ctx, [150, 154, 158], M(2.88) - 2, FLOOR - 8, 5, 8);
    rect(ctx, [160, 164, 168], M(2.88) + 2, FLOOR - 20, 3, 9);
    if (inUse) for (let i = 0; i < 6; i++) rect(ctx, [126, 110, 92], M(2.88) - 9, FLOOR - 52 + i * 8, 3, 6);
    // sink & mirror
    rect(ctx, [180, 186, 190], M(3.2) - 8, FLOOR - 32, 16, 4);
    rect(ctx, [120, 126, 130], M(3.2) - 2, FLOOR - 28, 4, 28);
    rect(ctx, [150, 170, 180], M(3.2) - 7, FLOOR - 62, 14, 18);
    // desk + chair; clutter grows when tired
    rect(ctx, [110, 84, 62], M(3.75), FLOOR - 28, M(4.5) - M(3.75), 3);
    rect(ctx, [90, 68, 50], M(3.78), FLOOR - 25, 2, 25);
    rect(ctx, [90, 68, 50], M(4.45), FLOOR - 25, 2, 25);
    const cl = s.ship.clutter.quarters || 0;
    for (let i = 0; i < Math.round(cl * 10); i++) rect(ctx, mix([220, 210, 190], [150, 90, 70], hash(i, 3, 1)), M(3.8) + hash(i, 1, 2) * 20, FLOOR - 30 - (i % 3), 3, 2);
    monitor(ctx, rc, M(4.1) - 7, FLOOR - 42, 14, 10, (x, y, w, h) => terminalText(ctx, rc, x, y, w, h, 'quarters'));
    chair(ctx, M(4.1), -1);
    // shelf of keepsakes
    rect(ctx, [110, 84, 62], M(4.55), FLOOR - 74, M(5.15) - M(4.55), 2);
    const ks = s.traveler.keepsakes || [];
    for (let i = 0; i < Math.min(8, ks.length); i++) {
      const kind = ks[ks.length - 1 - i].kind;
      const c = kind === 'bio_sample' ? [110, 200, 140] : kind === 'anomaly_fragment' ? [170, 160, 230] : [170, 140, 120];
      rect(ctx, c, M(4.57) + i * 2.4, FLOOR - 78, 2, kind === 'bio_sample' ? 4 : 3);
    }
    // a star chart pinned over the desk once the voyage has history
    if (s.space.stats.systems > 20) { rect(ctx, [200, 196, 180], M(3.8), CEIL + 22, 18, 12); for (let i = 0; i < 9; i++) px(ctx, [60, 60, 90], M(3.8) + 2 + hash(i, 5, 5) * 14, CEIL + 24 + hash(i, 6, 5) * 8); }
    // locker
    cabinet(ctx, M(5.5) - 9, FLOOR - 70, 18, 70, [86, 90, 96]);
    // torpor pod (frosted when occupied)
    const inPod = s.traveler.activity && s.traveler.activity.id === 'enter_torpor' && s.traveler.activity.phase === 'perform';
    rect(ctx, [150, 156, 164], M(6.1) - 10, FLOOR - 74, 20, 74);
    rect(ctx, inPod ? [150, 190, 220] : [40, 60, 70], M(6.1) - 7, FLOOR - 70, 14, 62);
    if (inPod) for (let i = 0; i < 40; i++) px(ctx, [230, 240, 255], M(6.1) - 7 + hash(i, 1, 4) * 14, FLOOR - 70 + hash(i, 2, 4) * 62, 0.6);
    blinkLed(ctx, rc, M(6.1), FLOOR - 4, inPod ? LED.ok : LED.off, 0.2);
    // a dim reading lamp over the bunk, and starlight through the porthole
    const a = s.traveler.activity;
    if (a && a.phase === 'perform' && ['sleep', 'nap'].includes(a.id)) {
      rc.lights.push({ x: M(1.3), y: FLOOR - 30, c: [255, 190, 120], r: 26, a: 0.18 });
      rc.lights.push({ x: M(2.45), y: FLOOR - 60, c: [120, 150, 220], r: 40, a: 0.12 });
    }
  },

  galley(ctx, rc) {
    const { M, s } = rc;
    cabinet(ctx, M(0.7) - 6, CEIL + 4, M(2.2) - M(0.7) + 12, 18, [150, 150, 140]); // pantry (upper)
    const cooking = s.ship.ops.cooking;
    // stove
    rect(ctx, [70, 72, 76], M(1.6) - 12, FLOOR - 28, 24, 28);
    rect(ctx, cooking ? [240, 110, 40] : [50, 50, 54], M(1.6) - 9, FLOOR - 29, 7, 1);
    rect(ctx, [50, 50, 54], M(1.6) + 2, FLOOR - 29, 7, 1);
    if (cooking || s.ship.food.mealReady) {
      rect(ctx, [150, 150, 156], M(1.6) - 9, FLOOR - 33, 7, 4); // pot
      for (let i = 0; i < 6; i++) px(ctx, [230, 230, 235], M(1.6) - 6 + Math.sin(rc.t * 2 + i) * 2, FLOOR - 36 - ((rc.t * 6 + i * 4) % 14), 0.5);
    }
    if (cooking) rc.lights.push({ x: M(1.6) - 5, y: FLOOR - 29, c: [255, 120, 40], r: 10, a: 0.4 });
    // counter with whatever hasn't been put away
    rect(ctx, [130, 130, 124], M(2.2), FLOOR - 28, M(3.1) - M(2.2), 28);
    rect(ctx, [170, 170, 160], M(2.2), FLOOR - 29, M(3.1) - M(2.2), 2);
    const cl = s.ship.clutter.galley || 0;
    for (let i = 0; i < Math.round(cl * 12); i++) rect(ctx, mix([220, 220, 220], [180, 140, 110], hash(i, 1, 9)), M(2.25) + hash(i, 2, 9) * 24, FLOOR - 32 + (i % 2), 3, 3);
    // table & stool
    rect(ctx, [120, 96, 72], M(3.3), FLOOR - 24, M(4.1) - M(3.3), 3);
    rect(ctx, [96, 76, 58], M(3.7) - 1, FLOOR - 21, 3, 21);
    rect(ctx, [80, 84, 90], M(3.25) - 5, FLOOR - 15, 9, 2);
    rect(ctx, [80, 84, 90], M(3.25) - 1, FLOOR - 13, 2, 13);
    if (s.ship.food.mealReady) rect(ctx, [220, 220, 210], M(3.6), FLOOR - 26, 6, 2);
    // sink
    rect(ctx, [120, 124, 128], M(4.4) - 8, FLOOR - 28, 16, 28);
    rect(ctx, [180, 186, 190], M(4.4) - 7, FLOOR - 29, 14, 2);
    blinkLed(ctx, rc, M(4.4) + 6, FLOOR - 20, ledFor(s, 'galley_heater'));
  },

  hydro(ctx, rc) {
    const { M, s, d } = rc;
    const p = s.ship.power;
    // seed bank
    const hs = d.rooms.hydro.stations;
    cabinet(ctx, M(hs.seedbank) - 8, FLOOR - 40, 16, 40, [140, 150, 146]);
    // condensation on the bay glass (humidity)
    const hum = clamp01(s.ship.atmo.airWater / 5.8);
    for (const win of rc.windows) {
      const n = Math.round((win.x1 - win.x0) * (win.y1 - win.y0) * Math.max(0, hum - 0.4) * 0.12);
      for (let i = 0; i < n; i++) px(ctx, [200, 220, 230], win.x0 + hash(i, 1, 11) * (win.x1 - win.x0), win.y0 + hash(i, 2, 11) * (win.y1 - win.y0), 0.35);
    }
    // racks
    s.ship.trays.forEach((tray, i) => {
      const x = M(d.rooms.hydro.stations[`tray_${i}`]);
      const bank = i < 5 ? 'grow_lamps_a' : 'grow_lamps_b';
      const lampFault = s.ship.components[bank].fault;
      rect(ctx, [80, 90, 86], x - 12, FLOOR - 34, 24, 4); // trough
      rect(ctx, [50, 40, 34], x - 11, FLOOR - 35, 22, 2); // substrate
      rect(ctx, [70, 78, 74], x - 11, FLOOR - 30, 2, 30); rect(ctx, [70, 78, 74], x + 9, FLOOR - 30, 2, 30);
      // water gauge
      rect(ctx, [30, 40, 50], x - 10, FLOOR - 28, 3, 10);
      rect(ctx, tray.water < 0.3 ? LED.bad : [80, 160, 220], x - 10, FLOOR - 18 - Math.round(tray.water * 10), 3, Math.round(tray.water * 10));
      plant(ctx, x, FLOOR - 35, tray, rc.t, i * 17);
      // grow lamp bar
      let lvl = s.ship.ops.lampOn && !s.ship.hydroDormant ? p.lampLevel : 0;
      if (lampFault) lvl *= lampFault.severity === 'major' ? 0 : (hash(i, Math.floor(rc.t * 9), 2) > 0.25 ? 0.85 : 0.1);
      rect(ctx, [60, 60, 66], x - 12, CEIL + 22, 24, 3);
      if (lvl > 0) {
        rect(ctx, mix([90, 40, 90], [255, 120, 220], lvl), x - 11, CEIL + 25, 22, 1);
        rc.lights.push({ x, y: CEIL + 34, c: [255, 90, 200], r: 22, a: 0.07 * lvl, wide: true });
      }
      // misting when the pumps top a tray up
      if (tray.crop && tray.water < 0.85 && s.ship.ops.lampOn) for (let k = 0; k < 4; k++) px(ctx, [190, 220, 240], x - 6 + hash(k, Math.floor(rc.t * 5), i) * 12, CEIL + 28 + hash(k, 3, Math.floor(rc.t * 5)) * 30, 0.5);
    });
    // pumps: they shudder when a bearing rattles
    for (const [id, st] of [['hydro_pump_1', 'pump_1'], ['hydro_pump_2', 'pump_2']]) {
      const c = s.ship.components[id];
      const shake = c.fault && c.fault.severity === 'minor' ? Math.round(Math.sin(rc.t * 40)) : 0;
      const x = M(d.rooms.hydro.stations[st]);
      rect(ctx, [90, 100, 110], x - 6 + shake, FLOOR - 10, 12, 10);
      disc(ctx, [70, 80, 90], x + shake, FLOOR - 5, 3);
      blinkLed(ctx, rc, x + 5, FLOOR - 12, ledFor(s, id));
    }
    // algae vat
    const a = s.ship.algae;
    rect(ctx, [120, 140, 140], M(hs.algae) - 12, FLOOR - 56, 24, 56);
    rect(ctx, mix([60, 90, 50], [30, 110, 50], a.density), M(hs.algae) - 10, FLOOR - 52, 20, 46);
    const bub = s.ship.components.algae_bubbler.fault ? 0.2 : 1;
    for (let i = 0; i < 10 * bub; i++) px(ctx, [170, 220, 170], M(hs.algae) - 9 + hash(i, 1, 12) * 18, FLOOR - 8 - ((rc.t * 10 + i * 7) % 44), 0.7);
    blinkLed(ctx, rc, M(hs.algae), FLOOR - 58, ledFor(s, 'algae_bubbler'));
  },

  lifesupport(ctx, rc) {
    const { M, s } = rc;
    // water recycler
    rect(ctx, [100, 110, 120], M(1.5) - 14, FLOOR - 50, 28, 50);
    rect(ctx, [60, 100, 140], M(1.5) - 10, FLOOR - 44, 8, 30);
    rect(ctx, [80, 140, 190], M(1.5) - 10, FLOOR - 14 - Math.round(clamp01(s.ship.water.potable / 400) * 30), 8, Math.round(clamp01(s.ship.water.potable / 400) * 30));
    blinkLed(ctx, rc, M(1.5) + 8, FLOOR - 44, ledFor(s, 'water_recycler'));
    pipeV(ctx, M(1.5) + 4, CEIL, FLOOR - 50);
    // OGS: an electrolysis column, bubbling when it works
    rect(ctx, [110, 116, 124], M(3.0) - 8, FLOOR - 60, 16, 60);
    rect(ctx, [150, 180, 200], M(3.0) - 5, FLOOR - 56, 10, 40);
    for (let i = 0; i < 12 * s.ship.ops.ogsDuty; i++) px(ctx, [240, 250, 255], M(3.0) - 4 + hash(i, 1, 13) * 8, FLOOR - 18 - ((rc.t * 14 + i * 5) % 36));
    blinkLed(ctx, rc, M(3.0), FLOOR - 62, ledFor(s, 'ogs'));
    // CO2 scrubber
    cabinet(ctx, M(4.6) - 12, FLOOR - 46, 24, 46, [96, 104, 100]);
    rect(ctx, [40, 50, 46], M(4.6) - 8, FLOOR - 40, 16, 8);
    rect(ctx, mix([200, 200, 120], [120, 80, 60], s.ship.components.o2_scrubber.wear), M(4.6) - 7, FLOOR - 39, Math.round(14 * (1 - s.ship.components.o2_scrubber.wear)), 6);
    blinkLed(ctx, rc, M(4.6) + 9, FLOOR - 44, ledFor(s, 'o2_scrubber'));
    // dehumidifier fan (stopped when seized; drips when it leaks)
    const dh = s.ship.components.dehumidifier;
    rect(ctx, [90, 96, 104], M(6.0) - 10, FLOOR - 70, 20, 20);
    disc(ctx, [40, 44, 50], M(6.0), FLOOR - 60, 7);
    const spin = dh.fault && dh.fault.severity === 'major' ? 0 : rc.t * 12;
    line(ctx, [140, 146, 150], M(6.0) - Math.cos(spin) * 6, FLOOR - 60 - Math.sin(spin) * 6, M(6.0) + Math.cos(spin) * 6, FLOOR - 60 + Math.sin(spin) * 6);
    if (dh.fault) px(ctx, [140, 180, 220], M(6.0) + 3, FLOOR - 48 + ((rc.t * 20) % 46));
    blinkLed(ctx, rc, M(6.0) + 8, FLOOR - 68, ledFor(s, 'dehumidifier'));
    for (let x = 0.2; x < 6.8; x += 1.7) pipeV(ctx, M(x), CEIL, CEIL + 20, [80, 110, 130]);
  },

  engineering(ctx, rc) {
    const { M, s } = rc;
    const heat = s.ship.thermal.heat;
    const p = s.ship.power;
    // hazard stripes along the floor edge
    for (let x = 0; x < 11 * PPM; x += 8) rect(ctx, (x / 8) % 2 ? [200, 160, 40] : [30, 30, 30], rc.ox + x, FLOOR - 3, 8, 3);
    // scoop manifold: glows while scooping
    const scoop = s.ship.flight.mode === 'scooping';
    rect(ctx, [90, 86, 80], M(2.4) - 14, FLOOR - 40, 28, 37);
    for (let i = 0; i < 4; i++) pipeV(ctx, M(2.4) - 10 + i * 7, CEIL, FLOOR - 40, [110, 100, 90]);
    if (scoop) rc.lights.push({ x: M(2.4), y: FLOOR - 30, c: [255, 150, 60], r: 26, a: 0.5 });
    blinkLed(ctx, rc, M(2.4) + 12, FLOOR - 38, ledFor(s, 'scoop_manifold'));
    // console + fault relay
    rect(ctx, [50, 52, 58], M(3.8) - 8, FLOOR - 36, 16, 36);
    monitor(ctx, rc, M(3.8) - 7, FLOOR - 50, 14, 10, (x, y, w, h) => {
      rect(ctx, [80, 220, 140], x + 2, y + h - 3, Math.round((w - 4) * clamp01(s.ship.fuel.tons / s.ship.fuel.capacity)), 2);
      rect(ctx, heat > 0.75 ? [255, 90, 60] : [255, 190, 80], x + 2, y + 2, Math.round((w - 4) * clamp01(heat)), 2);
    });
    const anyFault = Object.values(s.ship.components).some((c) => c.fault && c.known);
    blinkLed(ctx, rc, M(3.8) + 9, FLOOR - 54, anyFault ? LED.bad : LED.ok, 1.6);
    // reactor core: brightness with output, color with heat; the coolant pump judders when faulted
    const out = clamp01(p.reactorOut / 40);
    const rf = s.ship.components.reactor_core.fault;
    const shake = rf ? Math.round(Math.sin(rc.t * 37)) : 0;
    const rx = M(5.6) + shake;
    // heavy housing: base plinth, banded containment vessel, coolant lines
    rect(ctx, [56, 58, 64], rx - 30, FLOOR - 12, 60, 12);
    rect(ctx, [70, 72, 78], rx - 30, FLOOR - 13, 60, 1);
    rect(ctx, [84, 88, 96], rx - 22, CEIL + 10, 44, FLOOR - CEIL - 22);
    for (let y = CEIL + 16; y < FLOOR - 16; y += 14) { rect(ctx, [104, 108, 116], rx - 24, y, 48, 3); px(ctx, [140, 144, 150], rx - 22, y + 1); px(ctx, [140, 144, 150], rx + 21, y + 1); }
    rect(ctx, [40, 42, 48], rx - 9, CEIL + 18, 18, FLOOR - CEIL - 40);
    const core = mix([80, 160, 255], [255, 140, 60], clamp01((heat - 0.4) * 1.6));
    const pulse = 0.75 + 0.25 * Math.sin(rc.t * 2.2);
    rect(ctx, mul(core, 0.3 + 0.7 * out * pulse), rx - 5, CEIL + 20, 10, FLOOR - CEIL - 44);
    for (let i = 0; i < 6; i++) px(ctx, mix(core, [255, 255, 255], 0.6), rx - 4 + hash(i, Math.floor(rc.t * 6), 3) * 8, CEIL + 22 + hash(i, 2, Math.floor(rc.t * 6)) * (FLOOR - CEIL - 48), out);
    pipeV(ctx, rx - 28, CEIL, FLOOR - 12, [90, 110, 130]);
    pipeV(ctx, rx + 25, CEIL, FLOOR - 12, [90, 110, 130]);
    rc.lights.push({ x: M(5.6), y: (CEIL + FLOOR) / 2, c: core, r: 60, a: 0.35 * out });
    blinkLed(ctx, rc, M(5.6) + 18, CEIL + 12, ledFor(s, 'reactor_core'));
    // radiator vents: fins glow with heat
    for (let i = 0; i < 7; i++) {
      const x = M(8.4) - 18 + i * 6;
      rect(ctx, [70, 70, 74], x, FLOOR - 64, 4, 60);
      const g = clamp01((heat - 0.45) * 2);
      if (g > 0) rect(ctx, mix([120, 40, 20], [255, 160, 60], g), x + 1, FLOOR - 62, 2, 56, 0.4 + 0.6 * g);
    }
    if (heat > 0.5) rc.lights.push({ x: M(8.4), y: FLOOR - 34, c: [255, 110, 40], r: 40, a: clamp01(heat - 0.5) });
    blinkLed(ctx, rc, M(8.4) + 22, FLOOR - 66, ledFor(s, 'thermal_vents'));
    // drive coil: rings light up blue on charge and in hyperspace
    const fsd = s.ship.flight.mode === 'charging' ? 0.5 + 0.5 * Math.sin(rc.t * 10) : s.ship.flight.mode === 'hyperspace' ? 1 : 0.08;
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(${Math.round(60 + 140 * fsd)},${Math.round(90 + 140 * fsd)},255,${0.6 + 0.4 * fsd})`;
      ctx.beginPath(); ctx.ellipse(M(10.2), FLOOR - 42, 4 + i * 0.5, 22 - i * 4, 0, 0, Math.PI * 2); ctx.stroke();
    }
    if (fsd > 0.1) rc.lights.push({ x: M(10.2), y: FLOOR - 42, c: [120, 160, 255], r: 50, a: 0.5 * fsd });
  },

  workshop(ctx, rc) {
    const { M, s } = rc;
    // bench with tools; more scattered when cluttered
    rect(ctx, [120, 96, 70], M(1.8), FLOOR - 30, M(3.0) - M(1.8), 4);
    rect(ctx, [90, 70, 52], M(1.85), FLOOR - 26, 3, 26); rect(ctx, [90, 70, 52], M(2.9), FLOOR - 26, 3, 26);
    for (let i = 0; i < 6; i++) rect(ctx, [150, 150, 160], M(1.9) + i * 6, CEIL + 30, 1, 10); // pegboard
    for (let i = 0; i < Math.round((s.ship.clutter.workshop || 0) * 10); i++) rect(ctx, [160, 160, 170], M(1.9) + hash(i, 1, 21) * 34, FLOOR - 32, 4, 1);
    // parts bins: the stock you can see
    for (let i = 0; i < Math.min(12, s.ship.inventory.parts); i++) rect(ctx, [150, 120, 70], M(1.9) + (i % 6) * 6, FLOOR - 14 + Math.floor(i / 6) * 5, 5, 4);
    // fabricator: a warm window while it prints
    const fab = s.ship.ops.fabricating;
    rect(ctx, [96, 100, 108], M(4.4) - 16, FLOOR - 48, 32, 48);
    rect(ctx, fab ? [255, 150, 60] : [30, 34, 40], M(4.4) - 10, FLOOR - 40, 20, 16);
    if (fab) { rc.lights.push({ x: M(4.4), y: FLOOR - 32, c: [255, 140, 60], r: 30, a: 0.5 }); px(ctx, [255, 255, 220], M(4.4) - 8 + ((rc.t * 9) % 16), FLOOR - 30); }
    blinkLed(ctx, rc, M(4.4) + 13, FLOOR - 46, ledFor(s, 'fabricator'));
    // lathe
    rect(ctx, [80, 84, 90], M(5.8) - 14, FLOOR - 26, 28, 6);
    rect(ctx, [60, 64, 70], M(5.8) - 12, FLOOR - 20, 24, 20);
    // ore sample crates waiting to be refined
    for (let i = 0; i < Math.min(6, Math.ceil(s.space.cargo.ore / 4)); i++) rect(ctx, [110, 90, 70], M(6.4) + i * 5 - 10, FLOOR - 6, 4, 6);
  },

  storage(ctx, rc) {
    const { M, s } = rc;
    for (let j = 0; j < 4; j++) {
      rect(ctx, [90, 86, 80], M(1.4), FLOOR - 20 - j * 22, M(3.4) - M(1.4), 2);
      const fill = clamp01(s.ship.salvage.remainingKg / 180);
      for (let i = 0; i < Math.round(8 * fill); i++) rect(ctx, mix([140, 120, 90], [100, 110, 120], hash(i, j, 5)), M(1.45) + i * 8, FLOOR - 30 - j * 22, 7, 10);
    }
    for (let i = 0; i < 5; i++) rect(ctx, [120, 104, 80], M(4.0) + (i % 3) * 14 - (i > 2 ? 7 : 0), FLOOR - 14 - (i > 2 ? 14 : 0), 13, 14);
    // ice canisters
    for (let i = 0; i < Math.min(5, Math.ceil(s.space.cargo.ice / 6)); i++) rect(ctx, [170, 200, 220], M(5.2) + i * 5, FLOOR - 10, 4, 10);
  },

  airlock(ctx, rc) {
    const { M, s } = rc;
    for (let x = M(0.1); x < M(4.9); x += 8) rect(ctx, ((x / 8) | 0) % 2 ? [210, 170, 40] : [30, 30, 30], x, FLOOR - 3, 8, 3);
    // suit rack: empty while someone is wearing it
    const out = s.traveler.activity && s.traveler.activity.id === 'eva' && s.traveler.activity.phase === 'perform';
    rect(ctx, [80, 84, 90], M(2.0) - 12, CEIL + 10, 24, 4);
    if (!out) {
      rect(ctx, [214, 214, 206], M(2.0) - 7, CEIL + 30, 14, 30);
      rect(ctx, [214, 214, 206], M(2.0) - 6, CEIL + 16, 12, 12);
      rect(ctx, [40, 60, 80], M(2.0) - 4, CEIL + 19, 8, 6);
      rect(ctx, [180, 180, 174], M(2.0) - 6, CEIL + 60, 5, 30); rect(ctx, [180, 180, 174], M(2.0) + 1, CEIL + 60, 5, 30);
    }
    // outer door (pressure status light: red while cycling / out)
    rect(ctx, [110, 110, 104], M(4.5) - 18, FLOOR - 80, 36, 80);
    rect(ctx, [80, 80, 76], M(4.5) - 14, FLOOR - 76, 28, 76);
    rect(ctx, [60, 60, 56], M(4.5) - 8, FLOOR - 66, 16, 16);
    // porthole in the outer door: a real cut through to what's outside
    ctx.save(); ctx.beginPath(); ctx.arc(M(4.5), FLOOR - 58, 6, 0, Math.PI * 2); ctx.clip(); ctx.clearRect(M(4.5) - 7, FLOOR - 65, 14, 14); ctx.restore();
    rc.windows.push({ x0: M(4.5) - 6, x1: M(4.5) + 6, y0: FLOOR - 64, y1: FLOOR - 52 });
    const cycling = s.ship.ops.airlockCycling;
    blinkLed(ctx, rc, M(4.5), FLOOR - 84, out || cycling ? LED.bad : LED.ok, cycling ? 2 : 0.5);
    if (cycling) for (let i = 0; i < 10; i++) px(ctx, [220, 220, 220], M(3.4) + hash(i, Math.floor(rc.t * 6), 2) * 50, FLOOR - 10 - hash(i, 3, Math.floor(rc.t * 6)) * 70, 0.4);
    blinkLed(ctx, rc, M(2.0) + 14, CEIL + 12, ledFor(s, 'airlock_seals'));
  },

  corridor_fore(ctx, rc) { corridor(ctx, rc, 'junction_box_fore', 7.0); },
  corridor_aft(ctx, rc) { corridor(ctx, rc, null, 0); },
};

function corridor(ctx, rc, junction, jx) {
  const { M, s } = rc;
  const w = rc.data.rooms[rc.room].width;
  // conduits along the wall
  hline(ctx, [90, 80, 60], M(0), M(w), CEIL + 6); hline(ctx, [70, 90, 100], M(0), M(w), CEIL + 9);
  hline(ctx, [60, 64, 70], M(0), M(w), FLOOR - 8);
  for (let x = 1; x < w; x += 2) rect(ctx, [50, 54, 58], M(x), CEIL + 4, 2, 8);
  // handrail
  hline(ctx, [120, 124, 130], M(0), M(w), FLOOR - 38);
  if (junction) {
    const c = s.ship.components[junction];
    cabinet(ctx, M(jx) - 7, FLOOR - 64, 14, 18, [110, 112, 104]);
    blinkLed(ctx, rc, M(jx) + 4, FLOOR - 62, ledFor(s, junction), 1.5);
    if (c.fault && c.fault.id === 'arcing' && hash(0, Math.floor(rc.t * 4), 7) > 0.55) {
      for (let i = 0; i < 8; i++) px(ctx, [255, 240, 160], M(jx) - 6 + hash(i, Math.floor(rc.t * 20), 1) * 12, FLOOR - 46 + hash(i, 2, Math.floor(rc.t * 20)) * 14);
      rc.lights.push({ x: M(jx), y: FLOOR - 50, c: [200, 220, 255], r: 30, a: 0.6 });
      rc.flash = Math.max(rc.flash || 0, 0.25);
    }
  }
}

/** Log terminal: the entry's own characters type out while the traveler writes; idle cursor otherwise. */
function terminalText(ctx, rc, x, y, w, h, where) {
  const p = writingProgress(rc.state);
  const c = [120, 230, 170];
  if (!p || rc.state.traveler.pos.room !== where) { if (Math.sin(rc.t * 3) > 0) rect(ctx, c, x + 2, y + 2, 2, 1); return; }
  const text = p.a.params.text;
  const per = Math.floor((w - 4) / 2);
  const lines = Math.floor((h - 2) / 2);
  // wrap the typed text into tiny 2-px "characters"; spaces stay blank
  const typed = text.slice(0, p.chars);
  const rows = [];
  for (let i = 0; i < typed.length; i += per) rows.push(typed.slice(i, i + per));
  const view = rows.slice(-lines);
  view.forEach((row, l) => {
    for (let k = 0; k < row.length; k++) if (row[k] !== ' ') px(ctx, c, x + 2 + k * 2, y + 1 + l * 2, /[.,;:]/.test(row[k]) ? 0.45 : 0.9);
  });
  if (Math.sin(rc.t * 6) > 0) px(ctx, [220, 255, 230], x + 2 + ((view[view.length - 1] || '').length) * 2, y + 1 + Math.max(0, view.length - 1) * 2);
}

/** Draw a whole room (shell + props) into ctx. rc collects light sources for the lighting pass. */
export function drawRoom(ctx, rc) {
  drawShell(ctx, rc);
  const fn = ROOMS[rc.room];
  if (fn) fn(ctx, rc);
  drawFloorHatches(ctx, rc);
}

export function roomPixelWidth(data, room) {
  return data.rooms[room].width * PPM;
}
export { LED, THEME };
