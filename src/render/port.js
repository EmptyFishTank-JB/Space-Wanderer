// PORT-CAM: the station concourse, side-on, following the traveler ashore.
// A long hall of shopfronts (market, bar, mission board), a viewing deck
// window onto the hangar, and people: crowds coming and going, a few at the
// bar, someone at the board. Quiet when the traveler is not ashore.
import { W, H, PPM, FLOOR, CEIL, rect, px, hash, text, textWidth, mix, mul, glow, css } from './gfx.js';
import { drawTraveler } from './traveler.js';
import { travelerPose } from './actor.js';
import { renderNoSignal } from './feed.js';
import { drawHangar } from './celestial.js';
import { picks } from './picks.js';
import { stationIn, factionName } from '../space/ports.js';

const TOPS = [[170, 60, 60], [60, 110, 170], [200, 170, 70], [90, 150, 100], [140, 90, 160], [210, 210, 210], [60, 60, 70], [190, 110, 60]];
const BOTTOMS = [[50, 52, 60], [70, 60, 50], [40, 60, 90], [90, 90, 96], [30, 30, 34]];

export function ashore(state) {
  const a = state.traveler.activity;
  return !!(a && a.id === 'go_ashore' && a.phase === 'perform' && state.traveler.pos.room === 'port');
}

export function renderPortFeed(ctx, m) {
  const { state, data, t } = m;
  const f = state.ship.flight;
  if (!ashore(state)) { renderNoSignal(ctx, t, f.mode === 'docked' ? 'CONCOURSE · NOBODY ABOARD' : 'NOT DOCKED'); return; }
  const stn = stationIn(state.space.galaxySeed, state.space.systemId, data.space);
  const room = data.rooms.port;
  const L = room.width * PPM;
  const tx = state.traveler.pos.x * PPM;
  const camX = Math.max(0, Math.min(L - W, tx - W / 2));
  const ox = -Math.round(camX);
  const M = (xm) => ox + xm * PPM;
  // the hangar behind the viewing deck's glass, then the hall
  drawHangar(ctx, { }, t, camX * 0.002);
  const wall = [70, 74, 84], trim = [48, 52, 60];
  const viewX0 = M(room.stations.viewdeck - 8), viewX1 = M(room.stations.viewdeck + 8);
  rect(ctx, [16, 17, 20], 0, 0, W, H);
  // ceiling and its light strips
  rect(ctx, trim, 0, 0, W, CEIL);
  for (let x = Math.floor(camX / 40) * 40; x < camX + W + 40; x += 40) { rect(ctx, [230, 228, 210], x - camX - 10, CEIL - 6, 20, 2); }
  // the back wall, with the viewing deck's window cut through to the hangar
  rect(ctx, wall, 0, CEIL, W, FLOOR - CEIL);
  for (let x = Math.floor(camX / 48) * 48; x < camX + W + 48; x += 48) rect(ctx, mul(wall, 0.85), x - camX, CEIL, 1, FLOOR - CEIL);
  if (viewX1 > 0 && viewX0 < W) {
    ctx.save(); ctx.beginPath(); ctx.rect(viewX0, CEIL + 8, viewX1 - viewX0, FLOOR - CEIL - 30); ctx.clip();
    drawHangar(ctx, {}, t, 0.3);
    ctx.restore();
    for (let x = viewX0; x < viewX1; x += 64) rect(ctx, trim, x, CEIL + 8, 3, FLOOR - CEIL - 30);
  }
  // shopfronts: lit signs over open counters
  const shop = (st, label, color) => {
    const x = M(room.stations[st]);
    if (x < -80 || x > W + 80) return;
    rect(ctx, [30, 32, 38], x - 34, CEIL + 22, 68, FLOOR - CEIL - 22);
    rect(ctx, mix(color, [255, 255, 255], 0.1), x - 30, CEIL + 26, 60, 3);
    const lw = textWidth(label);
    rect(ctx, [12, 14, 18], x - lw / 2 - 3, CEIL + 8, lw + 6, 10);
    text(ctx, label, x - lw / 2, CEIL + 10, color);
    rect(ctx, mul(color, 0.35), x - 30, FLOOR - 34, 60, 8); // the counter
    ctx.globalCompositeOperation = 'lighter'; glow(ctx, color, x, CEIL + 30, 40, 0.1); ctx.globalCompositeOperation = 'source-over';
  };
  shop('market', 'MARKET', [120, 220, 170]);
  shop('bar', 'BAR', [255, 170, 90]);
  shop('board', 'MISSIONS', [120, 190, 255]);
  // the mission board: rows of offers, scrolling
  const bx = M(room.stations.board);
  if (bx > -40 && bx < W + 40) for (let i = 0; i < 6; i++) rect(ctx, (Math.floor(t * 0.5) + i) % 3 ? [70, 130, 190] : [190, 220, 255], bx - 24, CEIL + 36 + i * 7, 48 - (i * 7) % 18, 2);
  // the station's name over the gate
  const gx = M(room.stations.gate);
  const name = stn ? stn.name.toUpperCase() : 'STATION';
  if (gx > -120 && gx < W + 60) { rect(ctx, [12, 14, 18], gx - 4, CEIL + 4, textWidth(name) + 8, 10); text(ctx, name, gx, CEIL + 6, [200, 210, 220]); }
  // floor
  rect(ctx, [60, 62, 70], 0, FLOOR, W, H - FLOOR);
  for (let x = Math.floor(camX / 24) * 24; x < camX + W + 24; x += 24) rect(ctx, [52, 54, 62], x - camX, FLOOR, 1, H - FLOOR);
  // people: passers-by walking the hall, and a few standing at the venues
  const npc = (i, x, facing, pose) => {
    if (x < -20 || x > W + 20) return;
    const k = { pose, facing, phase: t * 3 + i, fatigue: 0, yawn: 0, alpha: 1, x: 0, y: FLOOR, outfit: { top: TOPS[i % TOPS.length], bottom: BOTTOMS[(i * 7) % BOTTOMS.length], shoes: [30, 28, 26] } };
    drawTraveler(ctx, x, FLOOR, k, t + i);
  };
  for (let i = 0; i < 14; i++) {
    const speed = 0.7 + hash(i, 1, 51) * 0.8, dir = hash(i, 2, 51) > 0.5 ? 1 : -1;
    const xm = (((hash(i, 3, 51) * room.width + dir * speed * t) % room.width) + room.width) % room.width;
    npc(i, M(xm), dir, 'walk');
  }
  for (const [st, n] of [['bar', 3], ['market', 2], ['board', 1], ['viewdeck', 2]]) for (let j = 0; j < n; j++) npc(20 + j * 5 + st.length, M(room.stations[st] + (j - n / 2) * 1.4 + 0.6), j % 2 ? 1 : -1, 'stand_back');
  // the traveler
  const k = m.tracker ? travelerPose(state, data, m.tracker, state.traveler.pos, t) : null;
  if (k) drawTraveler(ctx, M(state.traveler.pos.x), FLOOR, { ...k, pose: m.tracker && Math.abs(m.tracker.lastX - state.traveler.pos.x) > 1e-3 ? 'walk' : 'stand_back', phase: state.traveler.pos.x * 3 }, t);
  // selection: the venues and the traveler
  for (const [st, label, lines] of [['market', 'Market', [['Sells', 'ore, ice, samples, survey data'], ['Restocks', 'spares, filters, food']]], ['bar', 'Bar', [['Company', 'a few regulars, and whoever just docked']]], ['board', 'Mission board', [['Offers', `${(state.space.offers && state.space.offers.list.length) || 0} today`], ['Taken', `${state.space.missions.length}`]]]]) {
    const x = M(room.stations[st]);
    if (x > -40 && x < W + 40) picks.add({ id: `port:${st}`, x: x - 34, y: CEIL + 8, w: 68, h: FLOOR - CEIL - 8, info: () => ({ name: label, sub: stn ? `${stn.name} · ${factionName(stn.faction)}` : '', lines }) });
  }
  picks.add({ id: 'traveler', x: M(state.traveler.pos.x) - 8, y: FLOOR - 40, w: 16, h: 40, info: () => ({ name: 'The traveler', sub: stn ? `Ashore on ${stn.name}` : 'Ashore', lines: [['Credits', `${Math.round(state.space.credits).toLocaleString('en-US')}`], ['Missions', `${state.space.missions.length}`], ['Loneliness', `${Math.round(state.traveler.needs.solitude * 100)}%`]] }) });
  ctx.fillStyle = css([0, 0, 0], 0.1); ctx.fillRect(0, 0, W, 2);
}
