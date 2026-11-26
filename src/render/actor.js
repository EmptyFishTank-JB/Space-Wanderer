// Turns the sim's traveler (1 Hz positions, activity ids) into something the
// renderer can animate at 60 fps: interpolated position, walk phase, facing,
// and a pose picked from what they are doing and where.
import { ACTIONS } from '../sim/ai/actions.js';
import { PPM, FLOOR, hash } from './gfx.js';

const CONSOLE_STATIONS = new Set(['helm', 'nav', 'scanner', 'desk']);
const TYPING = new Set(['write_log', 'check_scans', 'nav_review', 'survey_system', 'scan_body', 'plot_route', 'inspect_engineering']);

export class TravelerTracker {
  constructor() {
    this.t = null;
    this.prev = null;
    this.cur = null;
    this.walked = 0;
    this.facing = 1;
    this.roomSince = 0;
  }

  /** Call once per frame with the live state and the runner's sub-second alpha. */
  update(state, alpha, now) {
    const p = state.traveler.pos;
    if (this.t !== state.t) {
      this.prev = this.cur || { room: p.room, x: p.x };
      this.cur = { room: p.room, x: p.x };
      if (this.prev.room !== this.cur.room) { this.prev = { ...this.cur }; this.roomSince = now; }
      this.t = state.t;
    }
    const x = this.prev.room === this.cur.room ? this.prev.x + (this.cur.x - this.prev.x) * alpha : this.cur.x;
    if (this.lastX !== undefined && this.lastRoom === this.cur.room) {
      const dx = x - this.lastX;
      this.walked += Math.abs(dx);
      if (Math.abs(dx) > 1e-4) this.facing = dx > 0 ? 1 : -1;
    }
    this.lastX = x;
    this.lastRoom = this.cur.room;
    return { room: this.cur.room, x };
  }
}

/** Pose, facing and flags for drawing. Returns null if not visible in a room. */
export function travelerPose(state, data, tracker, pos, t) {
  const tr = state.traveler;
  const a = tr.activity;
  const n = tr.needs;
  const k = { pose: 'stand', facing: tracker.facing, phase: 0, fatigue: n.fatigue, yawn: 0, alpha: 1, x: pos.x * PPM, y: FLOOR, outfit: outfitColors(data, tr.outfit) };
  // a yawn every so often when tired
  if (n.fatigue > 0.62) {
    const cyc = Math.floor(t / 37);
    if (hash(cyc, 1, 5) < n.fatigue - 0.4 && t % 37 < 2.6) k.yawn = 1;
  }
  if (tr.move) {
    const seg = tr.move.segs[tr.move.i];
    k.pose = 'walk';
    k.phase = (tracker.walked * PPM) / 9;
    if (seg && seg.kind === 'hatch') {
      k.pose = 'stand_back';
      k.alpha = Math.max(0, 1 - (tr.move.segT / seg.seconds) * 2.2);
    }
    if (t - tracker.roomSince < 1) k.alpha = Math.min(k.alpha, t - tracker.roomSince);
    return k;
  }
  if (!a || a.phase !== 'perform') return k;
  const def = ACTIONS[a.id];
  const station = a.loc && a.loc.station;
  // toilet and shower: the feed pixelates the body (see feed.js)
  k.privacy = a.id === 'use_toilet' || a.id === 'wash';
  const room = pos.room;
  switch (def.posture) {
    case 'lying': {
      k.pose = 'lie';
      if (room === 'quarters') { k.x = data.rooms.quarters.stations.bunk * PPM; k.y = FLOOR - 20; }
      else { k.x = pos.x * PPM; k.y = FLOOR - 18; }
      break;
    }
    case 'torpor': return null;
    case 'sitting':
      if (CONSOLE_STATIONS.has(station)) { k.pose = 'sit_back'; k.typing = TYPING.has(a.id) || a.id === 'jump' || a.id === 'land' || a.id === 'takeoff' || a.id === 'set_course'; }
      else if (station === 'easel') { k.pose = 'sit_back'; }
      else if (station === 'toilet') { k.pose = 'sit_side'; k.facing = 1; }
      else if (a.id === 'tinker') { k.pose = station === 'desk' ? 'sit_back' : 'sit_side'; k.working = true; k.facing = 1; }
      else { k.pose = 'sit_side'; k.eating = a.id === 'eat_meal'; k.facing = 1; }
      break;
    case 'reclining':
      if (station === 'desk') k.pose = 'sit_back';
      else if (room === 'quarters') { k.pose = 'recline'; k.facing = 1; }
      else { k.pose = 'recline'; k.facing = 1; }
      break;
    case 'standing':
      if (a.id === 'gaze_viewport') k.pose = 'stand_back';
      else if (a.id === 'linger') k.pose = hash(Math.floor(a.startT / 10), 2) > 0.5 ? 'stand_back' : 'stand';
      else if (station === 'terminal') { k.pose = 'stand_back'; k.working = true; }
      else { k.pose = 'stand_back'; k.working = true; }
      break;
    case 'kneeling': k.pose = 'kneel'; break;
    case 'crouching': k.pose = 'crouch'; break;
    case 'stretching': k.pose = 'stretch'; break;
    case 'exercising': k.pose = 'exercise'; k.facing = 1; k.x -= 0.6 * PPM; break;
    case 'slumped': k.pose = 'slumped'; break;
    case 'suited': k.pose = 'stand'; k.suited = (a.params.plan && a.params.plan.i >= 1) || a.elapsed > 300; break;
    default: k.pose = 'stand';
  }
  applyBeat(k, a, room, t);
  return k;
}

// Activities where the body is otherwise still: they get small beats so he never looks frozen.
const STILL = new Set(['gaze_viewport', 'reflect', 'listen_music', 'linger', 'stroll']);
const MUG_ROOMS = new Set(['lounge', 'galley', 'bridge', 'quarters']);
// what is in his hand when he turns something over: a photo, a book, a datapad, a leaf, a tool tag...
const HELD = { quarters: [200, 180, 140], lounge: [150, 60, 50], bridge: [80, 140, 170], galley: [210, 200, 170], hydro: [90, 170, 90], workshop: [170, 170, 180], engineering: [170, 170, 180] };

/**
 * Idle beats, chosen from the clock (deterministic, no sim state): every ~14 s
 * he may turn from the glass, put a hand to his chin, sip from a mug, turn
 * something over in his hand or shift his weight; mid-chore he sometimes
 * stops to think for a moment.
 */
function applyBeat(k, a, room, t) {
  const cyc = Math.floor((t + hash(Math.floor(a.startT), 3, 9) * 14) / 14);
  const h = hash(cyc, 5, 21);
  if (STILL.has(a.id)) {
    if (k.pose === 'stand_back') {
      if (h < 0.4) { k.pose = 'stand'; k.facing = h < 0.2 ? 1 : -1; k.beat = h < 0.12 ? 'chin' : h < 0.24 ? 'sip' : h < 0.32 ? 'hold' : null; }
    } else if (k.pose === 'stand' || k.pose === 'sit_side') {
      k.beat = h < 0.25 ? 'chin' : h < 0.45 ? 'sip' : h < 0.55 ? 'hold' : null;
    }
    if (h > 0.9 && k.pose.startsWith('stand')) k.x += h > 0.95 ? 1 : -1; // weight shift
  } else if (k.working && h < 0.08) {
    k.working = false;
    k.beat = 'chin'; // stops mid-task to think something over
  }
  if (k.beat === 'sip' && !MUG_ROOMS.has(room)) k.beat = 'chin';
  if (k.beat === 'hold') k.item = HELD[room] || [200, 180, 120];
}

/** Sprite colors for today's clothes (ids from data/traveler.json's wardrobe). */
export function outfitColors(data, outfit) {
  const w = data.traveler && data.traveler.wardrobe;
  if (!w || !outfit) return null;
  const top = w.tops.find((t) => t.id === outfit.top);
  const bottom = w.bottoms.find((b) => b.id === outfit.bottom);
  const shoes = w.shoes.find((b) => b.id === outfit.shoes);
  return { top: top && top.color, bottom: bottom && bottom.color, shoes: shoes && shoes.color, shorts: !!(bottom && bottom.shorts) };
}
