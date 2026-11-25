// What can be selected in the current frame, and where (framebuffer pixels).
// The feed renderers add entries while they draw; the selection UI reads
// them. Each entry: { id, x, y, w, h, info: () => ({ name, sub, lines }) }.
// Floors and bare walls never register.
import { PPM, FLOOR, CEIL } from './gfx.js';
import { viewSubject } from '../space/view.js';
import { activityLabel } from '../ui/telemetry-model.js';

let list = [];
export const picks = {
  begin() { list = []; },
  add(p) { if (p.w > 0 && p.h > 0) list.push(p); },
  all() { return list; },
  /** Smallest entry under a framebuffer point. */
  at(x, y) {
    let best = null;
    for (const p of list) if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h && (!best || p.w * p.h < best.w * best.h)) best = p;
    return best;
  },
  byId(id) { return list.find((p) => p.id === id) || null; },
};

const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// how big each kind of thing is drawn (u = metres along the room; box in px relative to the floor)
const SIZE = {
  shelf: [22, 84, 12], locker: [20, 70, 70], torpor_pod: [22, 74, 74], toilet: [12, 22, 22], bunk: [50, 32, 32], sink: [18, 64, 64], desk: [26, 44, 44],
  couch: [44, 30, 30], easel: [16, 40, 40], speaker: [12, 36, 36], exercise: [26, 30, 30], viewport: null, pantry: [26, 80, 30], stove: [24, 40, 40],
  counter: [30, 40, 40], table: [24, 30, 30], helm: [22, 40, 40], nav: [22, 40, 40], scanner: [22, 40, 40], terminal: [22, 50, 50], junction_box: [14, 70, 18],
  light_panel: [14, 70, 18], seedbank: [18, 36, 36], algae: [22, 50, 50], pump_1: [16, 22, 22], pump_2: [16, 22, 22], shelves: [40, 70, 70], crates: [30, 26, 26],
  inner_door: null, outer_door: [24, 64, 64], suit_rack: [20, 64, 64], bench: [30, 34, 34], fabricator: [24, 46, 46], lathe: [24, 34, 34],
  recycler: [26, 50, 50], ogs: [22, 60, 60], scrubber: [22, 60, 60], dehumidifier: [22, 50, 50], scoop_manifold: [24, 60, 60], console: [20, 44, 44],
  reactor: [36, 80, 80], vents: [30, 60, 60], drive: [30, 70, 70],
};
const NAMES = {
  shelf: 'Keepsake shelf', locker: 'Clothes locker', torpor_pod: 'Torpor pod', toilet: 'Toilet', bunk: 'Bunk', sink: 'Basin', desk: 'Desk', couch: 'Couch', easel: 'Easel',
  speaker: 'Speaker', exercise: 'Exercise corner', pantry: 'Pantry', stove: 'Stove', counter: 'Counter', table: 'Table', helm: 'Helm', nav: 'Navigation console',
  scanner: 'Scanner console', terminal: 'Terminal', junction_box: 'Junction box', light_panel: 'Light panel', seedbank: 'Seed bank', algae: 'Algae tank',
  shelves: 'Shelving', crates: 'Crates', outer_door: 'Outer door', suit_rack: 'Suit rack', bench: 'Workbench', fabricator: 'Fabricator', lathe: 'Lathe',
};

function stationInfo(state, data, room, name) {
  const lines = [];
  let title = NAMES[name] || cap(name.replace(/_/g, ' '));
  const comps = data.componentIds.filter((id) => data.components[id].room === room && data.components[id].station === name);
  for (const id of comps) {
    const c = state.ship.components[id];
    title = cap(data.components[id].name);
    lines.push(['Wear', `${pct(c.wear)}${c.known ? '' : ' (not yet inspected)'}`]);
    lines.push(['Status', c.fault ? `${c.fault.severity} fault${c.fault.kind ? `: ${c.fault.kind.replace(/_/g, ' ')}` : ''}` : c.patched ? 'patched, holding' : 'nominal']);
    if (c.runHours) lines.push(['Run time', `${Math.round(c.runHours)} h`]);
  }
  const tray = /^tray_(\d+)$/.exec(name);
  if (tray) {
    const t = state.ship.trays[Number(tray[1])];
    title = `Grow tray ${Number(tray[1]) + 1}`;
    if (!t || !t.crop) lines.push(['Crop', 'empty']);
    else {
      lines.push(['Crop', t.dead ? `${t.crop} (dead)` : t.crop]);
      if (!t.dead) lines.push(['Growth', pct(t.growth)], ['Health', pct(t.health)], ['Water', pct(t.water)]);
    }
  }
  const sh = state.ship;
  const tr = state.traveler;
  if (name === 'shelf') lines.push(['Keepsakes', `${(tr.keepsakes || []).length}`], ...(tr.keepsakes || []).slice(-3).reverse().map((k) => ['', k.label]));
  if (name === 'locker' && tr.outfit) {
    const w = data.traveler.wardrobe;
    const nm = (list, id) => (list.find((x) => x.id === id) || { name: id }).name;
    if (w) lines.push(['Wearing', `${nm(w.tops, tr.outfit.top)}, ${nm(w.bottoms, tr.outfit.bottom)}, ${nm(w.shoes, tr.outfit.shoes)}`], ['Laundry', `${tr.history.laundry || 0} days' worth`]);
  }
  if (name === 'seedbank' && sh.seeds) lines.push(['Seeds', Object.entries(sh.seeds).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ') || 'empty']);
  if (name === 'algae' && sh.algae) lines.push(['Culture', sh.algae.health !== undefined ? `health ${pct(sh.algae.health)}` : 'growing']);
  const act = tr.activity && tr.activity.phase === 'perform' && tr.pos.room === room ? tr.activity : null;
  const lib = tr.library, books = data.traveler.library;
  const book = lib && books && books.length ? books[lib.book % books.length] : null;
  if ((name === 'couch' || name === 'bunk') && act && act.id === 'read' && book) lines.push(['Reading', `${book.title}, page ${lib.page} of ${book.pages}`]);
  if (name === 'desk' && book) lines.push(['On the desk', `${book.title} (page ${lib.page} of ${book.pages})`], ['Books read', String(lib.finished || 0)]);
  if (name === 'speaker') lines.push(['Playing', act && act.id === 'listen_music' ? 'music, softly' : 'nothing']);
  if (name === 'easel') lines.push(['Status', act && act.id === 'sketch' ? 'a sketch in progress' : 'covered, a sketch half done']);
  if (name === 'torpor_pod') lines.push(['Status', tr.activity && tr.activity.id === 'enter_torpor' ? 'occupied' : 'empty, ready']);
  if (name === 'toilet') lines.push(['Status', tr.activity && tr.activity.id === 'use_toilet' && tr.activity.phase === 'perform' ? 'occupied (screen out)' : 'free']);
  if (name === 'helm' || name === 'nav') lines.push(['Flight', sh.flight.mode]);
  if (name === 'shelves' || name === 'crates') lines.push(...Object.entries(sh.inventory || {}).slice(0, 5).map(([k, v]) => [cap(k), String(typeof v === 'number' ? Math.round(v * 10) / 10 : v)]));
  return { name: title, sub: data.rooms[room].name, lines };
}

/** Register everything selectable in a room feed. `M(u)` maps metres along the room to framebuffer x. */
export function registerRoomPicks(rc, k) {
  const { state, data, room, M } = rc;
  const st = data.rooms[room].stations;
  for (const [name, u] of Object.entries(st)) {
    if (name === 'mid') continue;
    const sz = SIZE[name] ?? (/^tray_/.test(name) ? [14, 34, 34] : [18, 44, 44]);
    if (!sz) continue;
    const [w, top, h] = sz;
    picks.add({ id: `st:${room}:${name}`, x: M(u) - w / 2, y: FLOOR - top, w, h, info: () => stationInfo(state, data, room, name) });
  }
  for (const e of data.nav.endpoints) {
    if (e.room !== room) continue;
    const other = data.nav.endpoints[e.other].room;
    picks.add({ id: `door:${e.hatch}:${room}`, x: M(e.x) - 11, y: FLOOR - 58, w: 22, h: 58, info: () => ({ name: `Door to ${data.rooms[other].name}`, sub: data.rooms[room].name, lines: [['Hatch', e.hatch.replace(/^h_/, '')], ['Cycle', 'pressure door, a few seconds']] }) });
  }
  rc.lamps.forEach((l, i) => picks.add({ id: `lamp:${room}:${i}`, x: l.x - 9, y: CEIL - 4, w: 18, h: 6, info: () => ({ name: 'Ceiling light', sub: data.rooms[room].name, lines: [['Level', pct(state.ship.power.lightLevel ?? 1)], ['Power', state.ship.power.mode]] }) }));
  rc.windows.forEach((win, i) => picks.add({ id: `win:${room}:${i}`, x: win.x0, y: win.y0, w: win.x1 - win.x0, h: win.y1 - win.y0, info: () => {
    const v = viewSubject(state, data);
    return { name: 'Window', sub: data.rooms[room].name, lines: [['Outside', v.name ? `${v.name} (${v.kind})` : v.kind], ['Interest', pct(v.interest)]] };
  } }));
  if (k) {
    const tr = state.traveler;
    picks.add({ id: 'traveler', x: k.x + rc.ox - 8, y: k.y - 40, w: 16, h: 40, info: () => {
      const a = tr.activity;
      const w = data.traveler.wardrobe;
      const nm = (list, id) => (list && (list.find((x) => x.id === id) || {}).name) || id;
      const lines = [['Doing', activityLabel(a)], ['Hunger', pct(tr.needs.hunger)], ['Fatigue', pct(tr.needs.fatigue)], ['Mood', `wonder ${pct(tr.mood.wonder)}, weariness ${pct(tr.mood.weariness)}`]];
      if (tr.outfit && w) lines.push(['Wearing', `${nm(w.tops, tr.outfit.top)}, ${nm(w.bottoms, tr.outfit.bottom)}`]);
      if (tr.mug && tr.mug.carried) lines.push(['In hand', `mug of ${tr.mug.contents}, ${Math.round(tr.mug.tempC)} °C`]);
      return { name: 'The traveler', sub: data.rooms[tr.pos.room] ? data.rooms[tr.pos.room].name : '', lines };
    } });
  }
}

/** The mug, wherever it was left (when carried it is in his hand, so the traveler's own entry covers it). */
export function registerMugPick(rc) {
  const m = rc.state.traveler.mug;
  if (!m || m.carried || m.room !== rc.room) return null;
  const u = rc.data.rooms[rc.room].stations[m.station];
  if (u === undefined) return null;
  const x = rc.M(u) + 6, y = FLOOR - (m.station === 'couch' ? 16 : 32);
  picks.add({ id: 'mug', x: x - 3, y: y - 5, w: 7, h: 7, info: () => ({
    name: 'Mug', sub: rc.data.rooms[rc.room].name,
    lines: [['Contents', m.contents === 'empty' ? 'empty' : `${m.contents}, ${Math.round(m.fill * 100)}% full`], ['Temperature', `${Math.round(m.tempC)} °C${m.tempC > 55 ? ', hot' : m.tempC > 35 ? ', warm' : ''}`]],
  }) });
  return { x, y };
}

/** Stars and worlds in a space view (exterior camera, or through a window when drawn full-frame). */
export function registerSkyPick(o, x, y, r, sys) {
  const R = Math.max(5, r);
  const info = o.kind === 'star'
    ? () => ({ name: o.star.label ? cap(o.star.label) : 'Star', sub: sys ? sys.name : '', lines: [['Type', o.star.type || o.star.cls || ''], ['Temperature', o.star.tempK ? `${o.star.tempK} K` : '—'], ['Distance', `${Math.round(o.dist)} Ls`]] })
    : () => ({ name: o.body.name, sub: o.body.type.replace(/_/g, ' '), lines: [['Gravity', `${o.body.gravity.toFixed(2)} g`], ['Surface', `${o.body.tempK} K`], ['Atmosphere', o.body.atmosphere], ['Signals', [o.body.signals.bio ? `bio ${o.body.signals.bio}` : '', o.body.signals.geo ? `geo ${o.body.signals.geo}` : '', o.body.signals.anomaly ? 'anomaly' : ''].filter(Boolean).join(', ') || 'none'], ['Distance', `${Math.round(o.dist)} Ls`]] });
  picks.add({ id: `sky:${o.id}`, x: x - R, y: y - R, w: 2 * R, h: 2 * R, info });
}
