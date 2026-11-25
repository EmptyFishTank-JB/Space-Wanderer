// CAM-EXT: a camera on the dorsal hull looking forward along the ship. The
// hull itself carries the story: radiator fins glowing under thermal load,
// shield shimmer in the corona, scorch from re-entry, frost after torpor.
import { W, H, mix, mul, rect, px, glow, hash, line, clamp01, css } from './gfx.js';
import { drawSpaceScene } from './celestial.js';
import { drawSurfaceScene } from './terrain.js';

export function renderExteriorFeed(ctx, m) {
  const { state, view, t } = m;
  const f = state.ship.flight;
  if (view.scene === 'surface') {
    drawSurfaceScene(ctx, { body: view.body, sys: view.sys, t, altitudeKm: view.altitudeKm, yaw: 0.25, pitch: view.altitudeKm > 0 ? -0.05 : 0.04, entryHeat: view.entryHeat, buffeting: view.buffeting });
  } else {
    drawSpaceScene(ctx, view, t, { yaw: 0, pitch: -0.08, pick: true });
  }
  const shake = view.buffeting ? Math.round(Math.sin(t * 31) * 2 * view.buffeting) : 0;
  drawHull(ctx, state, view, t, shake);
}

function drawHull(ctx, state, view, t, shake) {
  const sh = state.ship;
  const wear = sh.components.hull_plating.wear;
  const heat = sh.thermal.heat;
  const base = [96, 100, 108];
  const top = H - 46 + shake;
  // the dorsal hull in perspective: a wedge narrowing toward the bow
  for (let y = top; y < H; y++) {
    const k = (y - top) / (H - top);
    const half = 40 + k * 200;
    const shade = 0.55 + 0.45 * k;
    rect(ctx, mul(base, shade), W / 2 - half, y, half * 2, 1);
  }
  // panel seams converging to the bow
  for (let i = -4; i <= 4; i++) line(ctx, mul(base, 0.45), W / 2 + i * 10, top, W / 2 + i * 60, H, 0.6);
  for (let j = 1; j < 5; j++) { const y = top + j * j * 2.6; const half = 40 + ((y - top) / (H - top)) * 200; line(ctx, mul(base, 0.5), W / 2 - half, y, W / 2 + half, y, 0.5); }
  // weathering & scorch
  for (let i = 0; i < 140 * wear; i++) {
    const y = top + hash(i, 1, 41) * (H - top);
    const half = 40 + ((y - top) / (H - top)) * 200;
    px(ctx, [40, 34, 30], W / 2 + (hash(i, 2, 41) - 0.5) * 2 * half, y, 0.55);
  }
  // radiator fins, glowing with heat
  const g = clamp01((heat - 0.4) * 1.8);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = W / 2 + side * (70 + i * 12);
      rect(ctx, [70, 72, 78], x - 2, top + 8 + i * 3, 4, 12);
      if (g > 0) rect(ctx, mix([140, 40, 20], [255, 170, 70], g), x - 1, top + 9 + i * 3, 2, 10, 0.4 + 0.6 * g);
    }
  }
  if (g > 0) { ctx.globalCompositeOperation = 'lighter'; glow(ctx, [255, 110, 40], W / 2, top + 20, 120, 0.2 * g); ctx.globalCompositeOperation = 'source-over'; }
  // antenna mast with a nav beacon
  rect(ctx, [80, 84, 90], W / 2 - 1, top - 22, 2, 24);
  rect(ctx, [80, 84, 90], W / 2 - 6, top - 20, 12, 1);
  if (Math.sin(t * 2.4) > 0.6) { px(ctx, [255, 70, 50], W / 2, top - 23); ctx.globalCompositeOperation = 'lighter'; glow(ctx, [255, 60, 40], W / 2, top - 23, 6, 0.6); ctx.globalCompositeOperation = 'source-over'; }
  // shield shimmer under stellar heat
  if (view.mode === 'scooping' || (view.glare > 0.5 && heat > 0.6)) {
    for (let i = 0; i < 260; i++) {
      const x = hash(i, 1, Math.floor(t * 10)) * W;
      const y = top - 40 + Math.sin(x * 0.05 + t * 3) * 10 + hash(i, 2, 3) * 30;
      px(ctx, [140, 200, 255], x, y, 0.15 + 0.25 * clamp01(heat));
    }
  }
  // frost after the long cold of a void crossing
  if (state.ship.flight.mode === 'void') for (let i = 0; i < 300; i++) px(ctx, [220, 235, 255], hash(i, 1, 9) * W, top + hash(i, 2, 9) * (H - top), 0.5);
  // drive glow in supercruise and hyperspace
  if (view.speed > 0.0005 || view.scene === 'hyperspace' || view.charging > 0) {
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, [110, 150, 255], W / 2, H + 10, 90, 0.25 + 0.3 * (view.charging || 0) + (view.scene === 'hyperspace' ? 0.3 : 0));
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.fillStyle = css([0, 0, 0], 0.15);
  ctx.fillRect(0, 0, W, 2);
}
