// DEVELOPER GALLERY — renders every camera feed from staged sim scenarios
// (scooping, orbit, EVA, hyperspace, night, faults…) for visual QA. It builds
// its own throwaway simulations; it never touches the viewer's saved traveler.
import { createInitialState, step, drain } from '../sim/index.js';
import { loadData, fetchJson } from '../load.js';
import { neighbors } from '../space/galaxy.js';
import { getSystem } from '../space/system.js';
import { startJump, startDescent } from '../space/flight.js';
import { plotRoute } from '../space/navigator.js';
import { roverCanDrive } from '../space/rover.js';
import { renderFeed } from '../render/app.js';
import { Director } from '../render/director.js';
import { spaceView } from '../render/spaceview.js';
import { TravelerTracker } from '../render/actor.js';
import { startFault } from '../sim/ship/wear.js';
import { W, H } from '../render/gfx.js';
import { setShipModel } from '../render/hull3d.js';
import { SCENARIOS } from './scenarios.js';

async function main() {
  const [data, cameras] = await Promise.all([loadData(), fetchJson('cameras')]);
  // the hull cameras draw the ship from its 3D layout (they fall back to sketches until it loads)
  await fetchJson('ship3d').then(setShipModel).catch(() => {});
  const params = new URLSearchParams(location.search);
  const only = params.get('scenario');
  const root = document.getElementById('gallery');
  const shots = [];
  for (const [name, build] of Object.entries(SCENARIOS)) {
    if (only && only !== name) continue;
    const h = document.createElement('h2');
    h.textContent = `${name} — building…`;
    root.appendChild(h);
    await new Promise((r) => setTimeout(r, 0));
    const { s, feeds } = build(data);
    h.textContent = `${name} — ${s.ship.flight.mode}, traveler ${s.traveler.pos.room} / ${s.traveler.activity ? s.traveler.activity.id : 'idle'}, heat ${s.ship.thermal.heat.toFixed(2)}`;
    const row = document.createElement('div');
    row.className = 'row';
    root.appendChild(row);
    for (const feed of feeds) {
      const fig = document.createElement('figure');
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const cap = document.createElement('figcaption');
      cap.textContent = feed;
      fig.append(cv, cap);
      row.appendChild(fig);
      const director = new Director(cameras, { rng: () => 0.5 });
      const tracker = new TravelerTracker();
      shots.push({ cv, feed, s, director, tracker });
    }
  }
  const t0 = performance.now() / 1000;
  const draw = () => {
    const t = params.has('t') ? Number(params.get('t')) : performance.now() / 1000 - t0 + 100;
    for (const sh of shots) {
      const ctx = sh.cv.getContext('2d', { willReadFrequently: true });
      const pos = sh.tracker.update(sh.s, 0, t);
      renderFeed(ctx, sh.feed, { state: sh.s, data, view: spaceView(sh.s, data), t, alpha: 0, pos, tracker: sh.tracker, dt: 1 }, sh.director);
    }
    document.body.dataset.ready = '1';
    if (params.has('animate')) requestAnimationFrame(draw);
  };
  draw();
}

main().catch((e) => { document.body.dataset.error = String(e.stack || e); console.error(e); });
