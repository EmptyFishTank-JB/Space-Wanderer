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
  const k = { pose: 'stand', facing: tracker.facing, phase: 0, fatigue: n.fatigue, yawn: 0, alpha: 1, x: pos.x * PPM, y: FLOOR };
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
  return k;
}
