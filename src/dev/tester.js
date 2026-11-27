// Ship tester (dev/tester.html): pick a scene (any room, any activity, flight,
// the surface, the hull cameras), watch it run live at a chosen speed, switch
// cameras, step time, select things and read the event stream. Scenes are
// staged by running a throwaway simulation up to the moment; nothing here
// touches a real voyage.
import { W, H, rect } from '../render/gfx.js';
import { createInitialState, step, drain } from '../sim/index.js';
import { loadData, fetchJson } from '../load.js';
import { renderFeed } from '../render/app.js';
import { Director, interestingRooms } from '../render/director.js';
import { spaceView } from '../render/spaceview.js';
import { TravelerTracker } from '../render/actor.js';
import { evaActive } from '../render/eva.js';
import { roverActive } from '../render/rover.js';
import { picks } from '../render/picks.js';
import { setShipModel } from '../render/hull3d.js';
import { activityLabel } from '../ui/telemetry-model.js';
import { shipHour } from '../sim/clock.js';
import { SCENARIOS, runUntil } from './scenarios.js';

const $ = (id) => document.getElementById(id);

// the indoor activities, each staged by living ordinary days until it happens
const ACTIVITIES = [
  ['sleep', 'Sleep'], ['nap', 'Nap'], ['cook_meal', 'Cook a meal'], ['eat_meal', 'Eat a meal'], ['snack', 'Snack'], ['drink_water', 'Drink water'],
  ['wash', 'Shower'], ['use_toilet', 'Toilet'], ['change_clothes', 'Get dressed'], ['exercise', 'Exercise'], ['stretch', 'Stretch'],
  ['tend_trays', 'Tend the grow trays'], ['harvest_tray', 'Harvest a tray'], ['plant_tray', 'Plant a tray'], ['tend_algae', 'Tend the algae'],
  ['maintain', 'Maintenance'], ['clean_room', 'Clean a room'], ['wash_dishes', 'Wash dishes'], ['organize_storage', 'Organize storage'],
  ['inspect_engineering', 'Inspect engineering'], ['inspect_lifesupport', 'Inspect life support'], ['fabricate', 'Fabricate parts'],
  ['check_scans', 'Check scans'], ['nav_review', 'Review navigation'], ['write_log', 'Write the log'], ['gaze_viewport', 'Gaze out a window'],
  ['read', 'Read'], ['listen_music', 'Listen to music'], ['sketch', 'Sketch'], ['play_solitaire', 'Solitaire'], ['play_instrument', 'Play an instrument'],
  ['stroll', 'Stroll'], ['tinker', 'Tinker'], ['reflect', 'Reflect'], ['plot_route', 'Plot a route'], ['jump', 'Jump'], ['scoop_fuel', 'Scoop fuel'],
  ['refine_samples', 'Refine samples'], ['melt_ice', 'Melt ice'],
];
const SCENES = {
  'Ship': [['day', 'A normal day'], ['night', 'Night'], ['faults', 'Faults'], ['hull', 'Hull cameras']],
  'Flight': [['scoop', 'Scooping a star'], ['hyperspace', 'Jump'], ['ringed', 'Ringed world'], ['earthlike', 'Earth-like world'], ['descent', 'Landing'], ['torpor', 'Deep sleep crossing']],
  'Surface': [['eva', 'Planet walk'], ['rover', 'Rover outing: driving'], ['roversite', 'Rover outing: at a site']],
};

let data, cameras;
let scene = null; // { s, director, tracker, feed: 'auto' | id, log: [] }
let playing = true, selecting = false, mouse = null, acc = 0, last = null;

function stageActivity(id) {
  const s = createInitialState(data, { seed: `tester-${id}` });
  runUntil(s, data, (x) => x.traveler.activity && x.traveler.activity.id === id && x.traveler.activity.phase === 'perform' && x.traveler.activity.elapsed > 15, 86400 * 8);
  return s;
}

function stageRoom(room) {
  const s = createInitialState(data, { seed: 'tester-rooms' });
  runUntil(s, data, (x) => x.t > 3.3 * 3600);
  const f = cameras.feeds.find((q) => q.room === room);
  return { s, feed: f ? f.id : 'auto' };
}

async function open(kind, key, label, btn) {
  document.querySelectorAll('#menu button.on').forEach((b) => b.classList.remove('on'));
  btn.classList.add('on');
  $('status').innerHTML = `<span class="busy">Staging “${label}”: running the simulation up to that moment…</span>`;
  await new Promise((r) => setTimeout(r, 30));
  let s, feed = 'auto';
  if (kind === 'scene') { const r = SCENARIOS[key](data); s = r.s; feed = r.feeds[0] || 'auto'; }
  else if (kind === 'room') { const r = stageRoom(key); s = r.s; feed = r.feed; }
  else s = stageActivity(key);
  drain(s);
  const director = new Director(cameras, { rng: Math.random });
  scene = { s, director, tracker: new TravelerTracker(), feed, log: [], label };
  $('feed').value = feed;
  $('log').innerHTML = '';
  const a = s.traveler.activity;
  if (kind === 'activity' && !(a && a.id === key)) logLine(`(didn't happen within 8 days on this seed; showing where the voyage got to)`);
}

function logLine(text) {
  const d = document.createElement('div');
  d.innerHTML = text;
  $('log').prepend(d);
  while ($('log').children.length > 80) $('log').lastChild.remove();
}

function describe(e) {
  const skip = new Set(['type', 't', 'id', 'mt', 'day']);
  const rest = Object.entries(e).filter(([k]) => !skip.has(k)).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
  return `<b>${e.type}</b> ${rest}`.slice(0, 220);
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dt = last === null ? 0 : Math.min(0.1, now - last);
  last = now;
  if (!scene) return;
  const { s, director, tracker } = scene;
  const events = [];
  if (playing) {
    acc += dt * Number($('speed').value);
    let n = Math.min(4000, Math.floor(acc));
    acc -= n;
    while (n-- > 0) { step(s, data); if (s.outbox.length) events.push(...drain(s)); }
  }
  for (const e of events) logLine(describe(e));
  const pos = tracker.update(s, 0, now);
  const tr = s.traveler;
  let feed = scene.feed;
  if (feed === 'auto') {
    feed = director.update(now, {
      travelerRoom: pos.room, eva: evaActive(s), rover: roverActive(s), events, shipMode: s.ship.flight.mode, heat: s.ship.thermal.heat,
      travelerStill: !tr.move && tr.activity && tr.activity.phase === 'perform', interestingRooms: interestingRooms(s),
    });
  }
  const cv = $('view'), ctx = cv.getContext('2d', { willReadFrequently: true });
  renderFeed(ctx, feed, { state: s, data, view: spaceView(s, data), t: now, alpha: 0, pos, tracker, dt }, director);
  // selection: brackets round whatever is under the pointer
  if (selecting && mouse) {
    const p = picks.at(mouse[0], mouse[1]);
    if (p) {
      const c = [111, 211, 181];
      for (const [x, y, w, h] of [[p.x, p.y, 4, 1], [p.x, p.y, 1, 4], [p.x + p.w - 4, p.y, 4, 1], [p.x + p.w - 1, p.y, 1, 4], [p.x, p.y + p.h - 1, 4, 1], [p.x, p.y + p.h - 4, 1, 4], [p.x + p.w - 4, p.y + p.h - 1, 4, 1], [p.x + p.w - 1, p.y + p.h - 4, 1, 4]]) rect(ctx, c, x, y, w, h);
      const i = p.info();
      $('pick').innerHTML = `<b>${i.name}</b><br>${i.sub || ''}${(i.lines || []).map(([k, v]) => `<br>${k}: ${v}`).join('')}`;
    }
  }
  const def = director.feedDef(feed);
  const n = tr.needs;
  const f = s.ship.flight;
  $('clock').textContent = `ship time ${shipHour(s).toFixed(2)} h · day ${Math.floor(s.t / 86400) + 1}`;
  $('status').textContent = `${scene.label} · camera ${feed}${def && def.label ? ` ${def.label}` : ''}${scene.feed === 'auto' ? ' (director)' : ''}\n`
    + `ship ${f.mode}${f.at ? ` at ${f.at}` : ''} · fuel ${s.ship.fuel.tons.toFixed(1)}/${s.ship.fuel.capacity} t · heat ${Math.round(s.ship.thermal.heat * 100)}% · rover ${s.ship.rover ? `${Math.round(s.ship.rover.charge * 100)}%${s.ship.rover.out ? ' out' : ''}` : '—'}\n`
    + `traveler in ${tr.pos.room} · ${activityLabel(tr.activity)} · hunger ${Math.round(n.hunger * 100)}% · thirst ${Math.round(n.thirst * 100)}% · fatigue ${Math.round(n.fatigue * 100)}%`;
}

async function main() {
  [data, cameras] = await Promise.all([loadData(), fetchJson('cameras')]);
  await fetchJson('ship3d').then(setShipModel).catch(() => {});
  const menu = $('menu');
  const group = (title, items, kind) => {
    const h = document.createElement('h2'); h.textContent = title; menu.appendChild(h);
    for (const [key, label] of items) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => open(kind, key, label, b));
      menu.appendChild(b);
    }
  };
  group('Rooms', data.roomIds.map((id) => [id, data.rooms[id].name]), 'room');
  for (const [title, items] of Object.entries(SCENES)) group(title, items, 'scene');
  group('Activities', ACTIVITIES, 'activity');
  // camera picker: the director, or any feed
  const sel = $('feed');
  sel.innerHTML = `<option value="auto">Director (follows the traveler)</option>${cameras.feeds.map((f) => `<option value="${f.id}">${f.id} ${f.label || ''}</option>`).join('')}`;
  sel.addEventListener('change', () => { if (scene) scene.feed = sel.value; });
  $('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; });
  $('stepmin').addEventListener('click', () => { if (scene) for (let i = 0; i < 60; i++) { step(scene.s, data); for (const e of drain(scene.s)) logLine(describe(e)); } });
  $('stephour').addEventListener('click', () => { if (scene) for (let i = 0; i < 3600; i++) { step(scene.s, data); for (const e of drain(scene.s)) logLine(describe(e)); } });
  $('select').addEventListener('click', () => { selecting = !selecting; $('select').textContent = `Select: ${selecting ? 'on' : 'off'}`; });
  addEventListener('keydown', (e) => { if (e.key === 's' || e.key === 'S') $('select').click(); if (e.key === ' ') { e.preventDefault(); $('play').click(); } });
  $('view').addEventListener('mousemove', (e) => { const r = $('view').getBoundingClientRect(); mouse = [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; });
  $('view').addEventListener('mouseleave', () => { mouse = null; });
  document.body.dataset.ready = '1';
  frame();
}

main().catch((e) => { document.body.dataset.error = String(e.stack || e); $('status').textContent = String(e.stack || e); console.error(e); });
