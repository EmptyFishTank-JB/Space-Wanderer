// Passengers' small stories. Each passenger comes aboard with something they
// will ask for: a sight on the way (a ringed world, a gas giant from orbit,
// a star skimmed close, a landing somewhere), the tour of the bridge, or help
// with something of theirs that has stopped working. They complain when the
// ship gives them reason to: the heat, the air, the larder, a fight, running
// late. The traveler grants what can be granted and smooths over what can be
// smoothed. At the end there is a farewell at the airlock, warm or curt
// depending on how the trip went, and sometimes a tip or a small gift left
// behind. Everything a passenger does on their own is drawn from the clock
// and the ship's state, never the sim's RNG.
import { hrng } from './galaxy.js';
import { rand, range, pick } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { emit } from '../sim/events.js';
import { currentSystem } from './flight.js';
import { addKeepsake } from './discovery.js';

const HOUR = 3600, DAY = 86400;
const FIX_ITEMS = ['music player', 'reading lamp', 'cabin heater', 'wrist terminal', 'travel kettle', 'hand-held game'];
const GIFTS = ['carved stone', 'tin of tea', 'hand-drawn star chart', 'pressed flower', 'old coin', 'paper book', 'woven bracelet', 'bottle of station gin'];
const WISHES = [
  { kind: 'see', what: 'rings', ask: 'asked if we might pass close to a ringed world on the way', done: 'saw a ringed world up close from the gallery' },
  { kind: 'see', what: 'giant', ask: 'wanted to see a gas giant from orbit, just once', done: 'watched a gas giant turn below the gallery windows' },
  { kind: 'see', what: 'star', ask: 'asked to be told when we skim a star, to watch it from the gallery', done: 'watched us skim a star, face to the glass' },
  { kind: 'see', what: 'surface', ask: 'hoped we would set down somewhere on the way', done: 'stood at a window on another world' },
  { kind: 'tour', ask: 'asked to see the bridge', done: 'had the tour of the bridge and sat in the helm seat' },
  { kind: 'fix', ask: null, done: null },
];
const COMPLAINTS = {
  heat: (p) => `${p.name} said the cabins are like an oven`,
  air: (p) => `${p.name} said the air tastes stale`,
  food: (p) => `${p.name} asked whether we're running short of food`,
  late: (p) => `${p.name} asked, again, whether we'll make it to ${p.going} in time`,
  fight: (p) => `${p.name} said they didn't pay to be shot at`,
  dark: (p) => `${p.name} asked why the lights are down`,
};
const ABOUT = { heat: 'the heat', air: 'the air', food: 'the food stores', late: 'running late', fight: 'the fight', dark: 'the lights' };

/** What this passenger will ask for, when, and what they might leave behind. */
export function makeStory(seed, p, t) {
  const st = hrng(seed, 'pax-story', p.id);
  const w = { ...pick(st, WISHES) };
  if (w.kind === 'fix') { const item = pick(st, FIX_ITEMS); w.what = item; w.ask = `asked for help with a ${item} that stopped working`; w.done = `got their ${item} working again`; }
  return { wish: { ...w, askAt: t + range(st, 2, 16) * HOUR, asked: false, granted: false }, mood: 0.6, complaints: {}, pending: null, hold: null, gift: pick(st, GIFTS), giftChance: rand(st) };
}

export function ensureStories(state) {
  for (const p of (state.space && state.space.passengers) || []) if (!p.story) p.story = makeStory(state.space.galaxySeed, p, state.t);
}

/** A passenger asked to be somewhere for a while (the bridge for the tour, a gallery for a sight). */
export function holdFor(state, data, p) {
  const h = p.story && p.story.hold;
  if (!h) return null;
  if (state.t >= h.until) { p.story.hold = null; return null; }
  return h;
}

function holdAt(state, p, room, x, seconds, doing) { p.story.hold = { room, x, until: state.t + seconds, doing }; }

function mission(state, p) { return (state.space.missions || []).find((m) => m.id === p.missionId) || null; }

/** Whether what they wished to see is in front of the ship right now. */
function sightNow(state, data, what) {
  const f = state.ship.flight;
  if (what === 'star') return f.mode === 'scooping';
  if (what === 'surface') return f.mode === 'landed' && !f.port;
  if (f.mode !== 'orbit' || !f.at) return false;
  const sys = currentSystem(state, data);
  const b = sys && sys.byId[f.at];
  if (!b) return false;
  return what === 'rings' ? !!b.rings : what === 'giant' ? b.type === 'gas_giant' || b.type === 'ice_giant' : false;
}

/** What the ship is giving them to complain about. */
function grievance(state, p) {
  const sh = state.ship, sp = state.space;
  if (sp.lastFightT !== undefined && state.t - sp.lastFightT < HOUR) return 'fight';
  if (sh.thermal.heat > 0.85) return 'heat';
  if (sh.atmo.co2 > 2500) return 'air';
  if (state.power && state.power.mode === 'limp') return 'dark';
  if (sh.food.pantry < 20000) return 'food';
  const m = mission(state, p);
  if (m && m.deadlineT - state.t < 1.5 * DAY && m.to && m.to.starId !== sp.systemId) return 'late';
  return null;
}

/** Per slow tick, per passenger: ask, notice, complain. */
export function tickStory(state, data, p) {
  const s = p.story;
  if (!s) return;
  const awake = p.doing !== 'asleep';
  const w = s.wish;
  if (!w.asked && awake && state.t >= w.askAt) {
    w.asked = true;
    emit(state, 'passenger_request', { who: p.name, kind: w.kind, what: w.what || null, line: `${p.name} ${w.ask}.`, room: p.pos.room });
  }
  // a sight on the way: they go to a gallery window and stay a while
  if (w.asked && !w.granted && w.kind === 'see' && sightNow(state, data, w.what)) grant(state, p, 'gallery');
  // complaints: each kind once in a while, only while awake (a fight wakes everyone)
  const why = grievance(state, p);
  if (why && (awake || why === 'fight') && state.t - (s.complaints[why] ?? -Infinity) > 2 * DAY) {
    s.complaints[why] = state.t;
    s.pending = why;
    s.mood = clamp(s.mood - (why === 'fight' ? 0.2 : 0.12));
    state.traveler.needs.stress = clamp(state.traveler.needs.stress + 0.02);
    emit(state, 'passenger_complaint', { who: p.name, about: ABOUT[why], kind: why, line: `${COMPLAINTS[why](p)}.`, room: p.pos.room });
  }
}

/** Their wish comes true. */
export function grant(state, p, where = null) {
  const s = p.story, w = s.wish;
  if (w.granted) return;
  w.granted = true;
  s.mood = clamp(s.mood + (w.kind === 'tour' ? 0.3 : 0.25));
  if (where === 'gallery') holdAt(state, p, 'gallery_s', 8 + Math.floor(rand(hrng(state.space.galaxySeed, 'pax-gallery', p.id)) * 6), 45 * 60, 'watching from the gallery, rapt');
  emit(state, 'passenger_wish', { who: p.name, kind: w.kind, line: `${p.name} ${w.done}.`, room: where === 'gallery' ? 'gallery_s' : p.pos.room });
}

/** The traveler meets them on the bridge for the tour. */
export function startTour(state, data, p) { holdAt(state, p, 'bridge', data.rooms.bridge.stations.viewport + 1.2, 50 * 60, 'being shown the bridge'); }
export function endTour(state, p) { if (p.story.hold && p.story.hold.room === 'bridge') p.story.hold = null; grant(state, p); }

/** The traveler sits down with them over a complaint. */
export function startReassure(state, p) { holdAt(state, p, p.pos.room, p.pos.x, 30 * 60, 'talking with the traveler'); }
export function reassure(state, p) {
  const s = p.story;
  if (!s.pending) return;
  const about = ABOUT[s.pending];
  s.pending = null;
  s.hold = null;
  s.mood = clamp(s.mood + 0.08);
  state.traveler.needs.solitude = clamp(state.traveler.needs.solitude - 0.04);
  emit(state, 'passenger_reassured', { who: p.name, about, line: `Talked ${p.name} round about ${about}.`, room: p.pos.room });
}

/** At the airlock: goodbye. Warm, polite or curt, by how the trip went; a tip and sometimes a gift when it went well. */
export function farewell(state, p, { fare = 0, late = false, station = null } = {}) {
  const s = p.story || { mood: 0.6, wish: { asked: false, granted: false } };
  let mood = s.mood + (s.wish.granted ? 0.1 : s.wish.asked ? -0.1 : 0) - (s.pending ? 0.08 : 0) - (late ? 0.35 : 0);
  mood = clamp(mood);
  const tone = mood > 0.72 ? 'warm' : mood > 0.4 ? 'polite' : 'curt';
  let tip = 0, gift = null;
  if (tone === 'warm') {
    tip = Math.round((fare * 0.12) / 10) * 10;
    state.space.credits += tip;
    state.space.stats.earned = (state.space.stats.earned || 0) + tip;
    if (s.giftChance !== undefined && s.giftChance < 0.5) { gift = s.gift; addKeepsake(state, { kind: 'gift', label: `${gift} — from ${p.name}` }); }
  }
  const line = tone === 'warm' ? `${p.name} hugged the traveler at the airlock${gift ? ` and left a ${gift} on the bunk` : ''}.`
    : tone === 'polite' ? (late ? `${p.name} said it was later than they'd hoped, but shook hands at the airlock.` : `${p.name} shook hands at the airlock and wished the ship well.`)
      : late ? `${p.name} said they'd missed what they came for, and left without looking back.` : `${p.name} left without looking back.`;
  emit(state, 'passenger_farewell', { who: p.name, tone, tip, gift, late, line, station, mood: Math.round(mood * 100) / 100, room: 'airlock' });
}
