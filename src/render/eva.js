// EVA-POV: the traveler's head-mounted camera. Visor framing, a suit-status
// LED at the helmet edge, dust and frost on the glass, breath fog, a walking
// bob and slow head turns toward whatever they are looking at.
import { W, H, rect, px, glow, hash, clamp01, css, mix, disc } from './gfx.js';
import { drawSurfaceScene } from './terrain.js';
import { currentSystem } from '../space/flight.js';
import { renderNoSignal } from './feed.js';

export function evaActive(state) {
  const a = state.traveler.activity;
  return !!(a && a.id === 'eva' && a.phase === 'perform' && a.params.plan && state.traveler.pos.room === 'surface');
}

export function renderEvaFeed(ctx, m) {
  const { state, data, t } = m;
  if (!evaActive(state)) { renderNoSignal(ctx, t, 'EVA LINK IDLE'); return; }
  const a = state.traveler.activity;
  const plan = a.params.plan;
  const sys = currentSystem(state, data);
  const body = sys.byId[plan.body];
  const facing = plan.returning ? -1 : 1;
  // walking head-bob and gaze: turn toward the nearest feature ahead
  const walkPhase = plan.x * 2.2;
  const bob = Math.sin(walkPhase * 2) * 1.6;
  let yaw = Math.sin(t * 0.11) * 0.22 + Math.sin(t * 0.37) * 0.06;
  let pitch = -0.02;
  const near = plan.features.find((f) => !plan.returning && f.x > plan.x && f.x - plan.x < 25);
  if (near) { yaw *= 0.3; pitch = -0.09; }
  drawSurfaceScene(ctx, {
    body, sys, t, altitudeKm: 0, yaw, pitch: pitch + bob / 400, walkX: plan.x, facing,
    features: plan.features, shipX: 0,
  });
  // heat shimmer on hot worlds: rows slide a little
  if (body.tempK > 420) {
    const img = ctx.getImageData(0, H / 2 - 20, W, 40);
    const shifted = ctx.createImageData(W, 40);
    for (let y = 0; y < 40; y++) {
      const off = Math.round(Math.sin(y * 0.6 + t * 4) * 1.2);
      for (let x = 0; x < W; x++) {
        const sx = Math.min(W - 1, Math.max(0, x + off));
        for (let c = 0; c < 4; c++) shifted.data[(y * W + x) * 4 + c] = img.data[(y * W + sx) * 4 + c];
      }
    }
    ctx.putImageData(shifted, 0, H / 2 - 20);
  }
  drawVisor(ctx, state, body, plan, t, a);
}

function drawVisor(ctx, state, body, plan, t, a) {
  const tr = state.traveler;
  // breath fog: rhythm follows exertion
  const rate = 0.35 + 0.25 * (tr.needs.fatigue + (plan.returning ? 0.1 : 0.3));
  const ph = (t * rate) % 1;
  if (body.tempK < 260 && ph < 0.35) {
    const k = Math.sin((ph / 0.35) * Math.PI);
    const g = ctx.createRadialGradient(W / 2, H + 10, 4, W / 2, H + 10, 60 + 30 * k);
    g.addColorStop(0, `rgba(225,232,240,${0.3 * k})`);
    g.addColorStop(1, 'rgba(225,232,240,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H - 100, W, 100);
  }
  // dust specks collected on the glass; frost creeping in on cold worlds
  const dusty = body.atmosphere === 'thin' || body.type === 'rocky' || body.type === 'metal_rich';
  const nDust = dusty ? Math.min(60, 10 + plan.x * 0.08) : 6;
  for (let i = 0; i < nDust; i++) px(ctx, [200, 190, 170], hash(i, 1, 21) * W, hash(i, 2, 21) * H, 0.35);
  if (body.tempK < 160) {
    for (let i = 0; i < 500; i++) {
      const x = hash(i, 1, 31) * W, y = hash(i, 2, 31) * H;
      const e = Math.min(x, W - x, y * 1.6, (H - y) * 1.6);
      if (e < 30 * hash(i, 3, 31)) px(ctx, [220, 235, 250], x, y, 0.45);
    }
  }
  // faint reflections on the visor
  for (let i = 0; i < 30; i++) px(ctx, [255, 255, 255], 40 + i * 2, 18 + i, 0.05);
  for (let i = 0; i < 18; i++) px(ctx, [255, 255, 255], W - 70 + i * 2, 14 + i, 0.04);
  // helmet edge: a soft dark oval vignette
  const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.55, W / 2, H / 2, W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(6,6,8,0.65)');
  g.addColorStop(1, 'rgba(6,6,8,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // suit status LED at the helmet rim (O2: green → amber → red)
  const o2 = plan.suitO2;
  const c = o2 > 0.5 ? [90, 230, 120] : o2 > 0.35 ? [255, 180, 40] : [255, 60, 50];
  const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * (o2 > 0.5 ? 1.5 : 4)));
  disc(ctx, c, 14, 16, 1.4, pulse);
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, c, 14, 16, 8, 0.35 * pulse);
  ctx.globalCompositeOperation = 'source-over';
  // a second, steady comms LED; flickers with static now and then
  const comm = hash(Math.floor(t * 3), 4, 7) > 0.08;
  px(ctx, comm ? [120, 170, 255] : [40, 50, 70], 20, 17);
  if (!comm) for (let i = 0; i < 30; i++) rect(ctx, [200, 200, 210], 0, hash(i, Math.floor(t * 30), 5) * H, W, 1, 0.04);
}

export { mix, css };
