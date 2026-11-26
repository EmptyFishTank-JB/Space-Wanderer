// ROVER-CAM: a camera in the rover's cab, looking out through the windshield.
// The ground rolls past and the cab bounces over it; the dashboard shows speed,
// distance out, battery and a strip map of the ship, the sites and the rover.
// Parked at a site, the traveler is out on foot ahead of the cab.
import { W, H, rect, px, hash, clamp01, text, textWidth, css } from './gfx.js';
import { drawSurfaceScene } from './terrain.js';
import { currentSystem } from '../space/flight.js';
import { renderNoSignal } from './feed.js';
import { speedOn } from '../space/rover.js';

const CAB = [30, 32, 36];
const TRIM = [52, 55, 62];
const LCD = [110, 230, 170];

function outing(state) {
  const a = state.traveler.activity;
  return a && a.id === 'rover_outing' && a.phase === 'perform' && a.params.plan ? a.params.plan : null;
}

/** The rover is out and the traveler aboard (or boarding): the cab camera's turn. */
export function roverActive(state) {
  const p = outing(state);
  if (!p) return false;
  const ph = p.phases[p.i];
  return !!ph && ['board', 'drive', 'dock'].includes(ph.name) && !p.site;
}

function poly(ctx, c, pts) {
  ctx.fillStyle = css(c);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(Math.round(x), Math.round(y)) : ctx.moveTo(Math.round(x), Math.round(y))));
  ctx.closePath();
  ctx.fill();
}

export function renderRoverFeed(ctx, m) {
  const { state, data, t } = m;
  const p = outing(state);
  const ph = p && p.phases[p.i];
  if (!p || !ph || !['board', 'drive', 'dock'].includes(ph.name)) {
    renderNoSignal(ctx, t, `ROVER DOCKED · ${Math.round((state.ship.rover ? state.ship.rover.charge : 1) * 100)}%`);
    return;
  }
  const sys = currentSystem(state, data);
  const body = sys.byId[p.body];
  const driving = ph.name === 'drive' && !p.site;
  const speed = driving ? speedOn(data, body) : 0;
  // bounce over the ground: rougher at speed, softer in low gravity
  const rough = driving ? (0.6 + 0.4 * Math.min(1.5, body.gravity)) : 0;
  const bob = rough * (Math.sin(t * 7.3 + p.x * 0.05) * 1.4 + (hash(Math.floor(t * 4), 1, 9) - 0.5) * 2);
  const facing = ph.name === 'board' || ph.name === 'dock' ? -1 : p.returning ? -1 : 1;
  drawSurfaceScene(ctx, {
    body, sys, t, altitudeKm: 0, yaw: Math.sin(t * 0.07) * 0.05, pitch: -0.03 + bob / 300,
    walkX: p.x, facing, features: p.features, shipX: 0,
  });
  // parked at a site: the traveler, suited, out ahead of the cab
  if (p.site) {
    const dx = state.traveler.pos.x - p.x;
    const d = 6 + Math.abs(dx);
    const s = 26 / d;
    const x = W / 2 + dx * 4, y = 118 - 22 / d;
    rect(ctx, [225, 228, 232], x - 2 * s, y - 9 * s, 4 * s, 9 * s);
    rect(ctx, [200, 205, 210], x - 1.5 * s, y - 12 * s, 3 * s, 3 * s);
    rect(ctx, [120, 180, 220], x - 1 * s, y - 11.5 * s, 2 * s, 1.2 * s);
  }
  // the cab: roof, pillars, dashboard
  const shake = Math.round(bob);
  rect(ctx, CAB, 0, 0, W, 14 + shake);
  rect(ctx, TRIM, 0, 13 + shake, W, 2);
  poly(ctx, CAB, [[0, 0], [34, 0], [18, H], [0, H]]);
  poly(ctx, CAB, [[W, 0], [W - 34, 0], [W - 18, H], [W, H]]);
  poly(ctx, TRIM, [[34, 14 + shake], [38, 14 + shake], [22, 140], [18, 140]]);
  poly(ctx, TRIM, [[W - 34, 14 + shake], [W - 38, 14 + shake], [W - 22, 140], [W - 18, 140]]);
  const dash = 140 + shake;
  rect(ctx, CAB, 0, dash, W, H - dash);
  rect(ctx, TRIM, 0, dash, W, 2);
  // dust on the windshield, thicker the farther out
  for (let i = 0; i < Math.min(80, 8 + p.driven * 0.004); i++) px(ctx, [200, 190, 170], 30 + hash(i, 1, 23) * (W - 60), 16 + hash(i, 2, 23) * (dash - 18), 0.3);
  // gauges along the top of the dash
  const g = (x, label, value) => {
    rect(ctx, [12, 16, 16], x, dash + 4, 50, 13);
    text(ctx, label, x + 3, dash + 7, [90, 130, 110]);
    text(ctx, value, x + 47 - textWidth(value), dash + 7, LCD);
  };
  const bat = state.ship.rover ? state.ship.rover.charge : 1;
  g(44, 'SPD', `${Math.round(speed * 3.6)}`);
  g(100, 'KM', (p.x / 1000).toFixed(1));
  g(W - 150, 'BAT', `${Math.round(bat * 100)}%`);
  g(W - 94, 'O2', `${Math.round(p.suitO2 * 100)}%`);
  const status = p.site ? 'PARKED · SAMPLING' : ph.name === 'board' ? 'BOARDING' : ph.name === 'dock' ? 'DOCKING' : p.returning ? 'RETURNING' : 'OUTBOUND';
  // the strip map below (ship at the left, the sites along the line, the rover moving between), the status beside it
  const mx0 = 52, mx1 = W - 124, my = dash + 27;
  rect(ctx, [12, 16, 16], mx1 + 12, dash + 20, W - 44 - (mx1 + 12), 14);
  text(ctx, status, mx1 + 16, dash + 25, [90, 130, 110]);
  rect(ctx, [12, 16, 16], mx0 - 8, dash + 20, mx1 - mx0 + 16, 14);
  rect(ctx, [50, 80, 66], mx0, my, mx1 - mx0, 1);
  const X = (x) => mx0 + clamp01(x / Math.max(1, p.maxX)) * (mx1 - mx0);
  rect(ctx, [200, 210, 220], mx0 - 2, my - 3, 4, 7); // the ship
  for (const f of p.features) rect(ctx, f.visited ? [90, 130, 110] : [230, 190, 90], X(f.x) - 1, my - 2, 3, 5);
  if (Math.sin(t * 5) > -0.3) rect(ctx, LCD, X(p.x) - 2, my - 4, 4, 3);
}
