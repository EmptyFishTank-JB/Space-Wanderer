// Composes one camera feed into the 320×180 framebuffer:
//   space (or surface) behind the glass → room layer (shell, props,
//   traveler) → lighting on the room layer → glare, strobes, sparks.
import { W, H, PPM, FLOOR, CEIL, css, mix, mul, hex, rect, glow, hash, clamp01, text, px } from './gfx.js';
import { drawRoom, roomWindows } from './rooms.js';
import { drawTraveler } from './traveler.js';
import { drawSpaceScene, makeCanvas } from './celestial.js';
import { drawSurfaceScene } from './terrain.js';
import { travelerPose } from './actor.js';
import { registerRoomPicks, registerMugPick } from './picks.js';

let layer = null;
function roomLayer() {
  if (!layer) layer = makeCanvas(W, H);
  return layer;
}

/** How bright a compartment is right now (0..1) and its tint. */
export function roomLight(state, room, t) {
  const p = state.ship.power;
  let L = p.lightLevel;
  const tr = state.traveler;
  const a = tr.activity;
  const asleepHere = a && a.phase === 'perform' && tr.pos.room === room && ['sleep', 'enter_torpor', 'nap'].includes(a.id);
  if (asleepHere && room === 'quarters') L = 0.2;
  if (room === 'corridor_aft') {
    const f = state.ship.components.corridor_lights_aft.fault;
    if (f) L *= f.severity === 'major' ? 0.25 : (hash(Math.floor(t * 11), 1, 3) > 0.22 ? 1 : 0.2);
  }
  if (room === 'corridor_fore' || room === 'galley' || room === 'quarters') {
    const jb = state.ship.components.junction_box_fore.fault;
    if (jb && jb.severity === 'major') L *= 0.45;
  }
  let tint = null;
  if (p.mode === 'limp') tint = { c: [200, 30, 20], a: 0.28 };
  else if (room === 'hydro' && state.ship.ops.lampOn && !state.ship.hydroDormant) tint = { c: [200, 70, 170], a: 0.12 * p.lampLevel };
  return { L: clamp01(L), tint };
}

export function renderRoomFeed(ctx, m) {
  const { state, data, view, room, camX, t, alpha, feed } = m;
  const roomW = data.rooms[room].width * PPM;
  const ox = Math.round(-camX);
  const wins = roomWindows(room);
  // 1. what's outside the glass
  if (wins.length || room === 'airlock') {
    if (view.scene === 'surface') drawSurfaceScene(ctx, { body: view.body, sys: view.sys, t, altitudeKm: view.altitudeKm, yaw: feed.yaw || 0, pitch: 0.05, entryHeat: view.entryHeat });
    else drawSpaceScene(ctx, view, t, { yaw: feed.yaw || 0, parallax: camX * 0.0006 });
  } else {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
  }
  // 2. the room layer
  const lc = roomLayer().getContext('2d');
  lc.clearRect(0, 0, W, H);
  const light = roomLight(state, room, t);
  const rc = {
    ctx: lc, state, s: state, data, d: data, room, ox, M: (xm) => ox + xm * PPM, t, alpha,
    lights: [], lamps: [], windows: [], seed: view.seed || 1, powerDim: light.L, flash: 0,
  };
  drawRoom(lc, rc);
  let seen = null;
  if (m.pos && m.pos.room === room) {
    const k = travelerPose(state, data, m.tracker, m.pos, t);
    seen = k;
    if (k) {
      drawTraveler(lc, ox + k.x, k.y, k, t);
      if (k.privacy) mosaic(lc, ox + k.x, k.y, k.pose);
      if (k.pose === 'sit_back') {
        // seen from behind, the chair's backrest and seat sit in front of them
        rect(lc, [44, 46, 52], ox + k.x - 7, FLOOR - 31, 14, 12);
        rect(lc, [58, 60, 66], ox + k.x - 7, FLOOR - 31, 14, 1);
        rect(lc, [40, 42, 48], ox + k.x - 9, FLOOR - 18, 18, 3);
        rect(lc, [36, 38, 44], ox + k.x - 1, FLOOR - 15, 2, 14);
        rect(lc, [36, 38, 44], ox + k.x - 6, FLOOR - 1, 12, 1);
      }
    }
  }
  registerRoomPicks(rc, seen);
  const mug = registerMugPick(rc);
  if (mug) {
    // a small mug on the furniture, steaming a little while hot
    rect(lc, [206, 204, 196], mug.x - 2, mug.y - 4, 4, 5);
    rect(lc, [206, 204, 196], mug.x + 2, mug.y - 3, 1, 2);
    const m = state.traveler.mug;
    if (m.fill > 0) rect(lc, m.contents === 'water' ? [150, 190, 210] : [110, 70, 45], mug.x - 1, mug.y - 4, 2, 1);
    if (m.tempC > 50 && m.fill > 0) for (let i = 0; i < 3; i++) rect(lc, [230, 230, 230], mug.x - 1 + Math.round(Math.sin(t * 2 + i) * 1.2), mug.y - 7 - i * 2, 1, 1, 0.35 - i * 0.1);
  }
  // 3. lighting, applied only to the room (windows stay transparent)
  lc.globalCompositeOperation = 'source-atop';
  const dark = 1 - (0.12 + 0.88 * light.L);
  if (dark > 0.01) { lc.fillStyle = `rgba(4,5,10,${dark})`; lc.fillRect(0, 0, W, H); }
  if (light.tint) { lc.fillStyle = css(light.tint.c, light.tint.a); lc.fillRect(0, 0, W, H); }
  lc.globalCompositeOperation = 'lighter';
  if (light.L > 0.25) for (const l of rc.lamps) glow(lc, [255, 236, 200], l.x, l.y + 30, 46, 0.07 * light.L);
  for (const l of rc.lights) {
    if (l.wide) { const g = lc.createLinearGradient(0, l.y - 20, 0, FLOOR); g.addColorStop(0, css(l.c, l.a)); g.addColorStop(1, css(l.c, 0)); lc.fillStyle = g; lc.fillRect(l.x - l.r / 2, l.y - 20, l.r, FLOOR - l.y + 20); }
    else glow(lc, l.c, l.x, l.y, l.r, l.a);
  }
  lc.globalCompositeOperation = 'source-over';
  ctx.drawImage(roomLayer(), 0, 0);

  // 4. stellar glare flooding in through the glass
  if (rc.windows.length && view.scene === 'space' && view.glare > 0.15) {
    const sc = hex(view.star.color);
    const k = clamp01(view.glare) * (view.mode === 'scooping' ? 0.75 + 0.25 * Math.sin(t * 7) : 0.6);
    ctx.globalCompositeOperation = 'lighter';
    for (const w of rc.windows) {
      const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2;
      glow(ctx, mix(sc, [255, 255, 255], 0.3), cx, cy, 160 * k + 40, 0.35 * k);
      const g = ctx.createLinearGradient(0, w.y1, 0, FLOOR);
      g.addColorStop(0, css(sc, 0.25 * k)); g.addColorStop(1, css(sc, 0));
      ctx.fillStyle = g; ctx.fillRect(w.x0 - 30, w.y1, w.x1 - w.x0 + 60, FLOOR - w.y1);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  // 5. caution strobes when the ship runs hot (amber, then red)
  const heat = state.ship.thermal.heat;
  if (heat > 0.78) {
    const red = heat > 0.95;
    const on = Math.sin(t * (red ? 9 : 5)) > 0.35;
    if (on) { ctx.fillStyle = red ? 'rgba(255,40,30,0.16)' : 'rgba(255,160,30,0.11)'; ctx.fillRect(0, 0, W, H); }
  }
  if (rc.flash > 0) { ctx.fillStyle = `rgba(210,225,255,${rc.flash * 0.5})`; ctx.fillRect(0, 0, W, H); }
  return { roomW };
}

/** Static & "NO SIGNAL" for a feed with nothing to show (e.g. helmet cam aboard). */
export function renderNoSignal(ctx, t, label = 'NO SIGNAL') {
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const f = Math.floor(t * 24);
  for (let i = 0; i < W * H; i++) {
    const v = hash(i, f, 3) * 60;
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v + 6; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  rect(ctx, [0, 0, 0], W / 2 - 26, H / 2 - 5, 52, 11, 0.8);
  text(ctx, label, W / 2 - label.length * 2 + 1, H / 2 - 2, [200, 200, 200]);
}

/**
 * Privacy pixelation over the body (toilet, shower): average the drawn
 * pixels in 4 px blocks, the way broadcast footage would.
 */
function mosaic(ctx, x, y, pose) {
  const seated = pose === 'sit_side' || pose === 'sit_back';
  const x0 = Math.round(x - 10), y0 = Math.round(y - (seated ? 30 : 38)), w = 20, h = seated ? 26 : 32;
  const B = 4;
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  for (let by = 0; by < h; by += B) for (let bx = 0; bx < w; bx += B) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = by; yy < Math.min(h, by + B); yy++) for (let xx = bx; xx < Math.min(w, bx + B); xx++) {
      const i = (yy * w + xx) * 4;
      r += d[i] * d[i + 3]; g += d[i + 1] * d[i + 3]; b += d[i + 2] * d[i + 3]; a += d[i + 3]; n++;
    }
    if (!a) continue;
    const c = [r / a, g / a, b / a, a / n];
    for (let yy = by; yy < Math.min(h, by + B); yy++) for (let xx = bx; xx < Math.min(w, bx + B); xx++) {
      const i = (yy * w + xx) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.max(d[i + 3], c[3] > 40 ? 255 : c[3]);
    }
  }
  ctx.putImageData(img, x0, y0);
}
