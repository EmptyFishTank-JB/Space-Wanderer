// The traveler's mug: a small object with a life of its own. Filled with tea
// or coffee at meals and with water at the sink, carried along while he sits
// and looks or thinks (that's what the sips are), drunk down slowly, cooling
// all the while, and left wherever he last put it down. Draws nothing from
// the RNG, so it never shifts other rolls.
import { shipHour } from '../clock.js';

const CARRY = new Set(['gaze_viewport', 'reflect', 'listen_music', 'read', 'tinker', 'write_log', 'check_scans', 'nav_review', 'plot_route']);
// where it ends up when he puts it down in each room
const REST = { lounge: 'couch', galley: 'table', bridge: 'terminal', quarters: 'desk', workshop: 'bench' };
const ROOM_K = 21; // cabin air, °C

export function ensureMug(state) {
  const tr = state.traveler;
  if (!tr.mug) tr.mug = { contents: 'empty', fill: 0, tempC: ROOM_K, room: 'galley', station: 'table', carried: false };
  return tr.mug;
}

export function fillMug(state, contents, fill, tempC) {
  const m = ensureMug(state);
  Object.assign(m, { contents, fill, tempC, carried: false });
  const room = state.traveler.pos.room;
  if (REST[room]) { m.room = room; m.station = REST[room]; }
}

/** After a meal: a hot drink. Coffee before noon, tea after. */
export function mealDrink(state) {
  fillMug(state, shipHour(state) < 12 ? 'coffee' : 'tea', 1, 78);
}

/** Every slow tick: carry it, sip it, let it cool. */
export function updateMug(state, dt) {
  const m = ensureMug(state);
  const tr = state.traveler;
  const a = tr.activity;
  const performing = a && a.phase === 'perform' && !tr.move;
  const room = tr.pos.room;
  m.carried = !!(performing && CARRY.has(a.id) && REST[room] && m.fill > 0);
  if (m.carried) {
    m.room = room;
    m.station = REST[room];
    m.fill = Math.max(0, m.fill - (0.35 * dt) / 3600); // about three hours to finish a mug, sip by sip
    if (m.fill === 0) m.contents = 'empty';
  }
  // Newton cooling toward cabin air: a hot mug is lukewarm in about half an hour
  m.tempC = ROOM_K + (m.tempC - ROOM_K) * Math.exp(-dt / 1500);
}
