// Utility AI with task inertia.
//
// Decision points: when an activity completes (or nothing is happening).
// Interrupt checks: every `brainEvery` ticks, only urgent categories may
// challenge the current activity, and only if they beat its score plus a
// commitment bonus (larger before `commitUntil`) plus a switching margin.
// That hysteresis is what stops the traveler thrashing between rooms.
//
// Human texture: candidates within a small band of the best are chosen by
// weighted chance, distance costs a little, staying in the same room is
// slightly preferred, and leisure suffers from boredom (recent repetition).
import { ACTIONS } from './actions.js';
import { rand, range, weighted } from '../rng.js';
import { shipHour, missionDay } from '../clock.js';
import { inWindow, HOUR } from '../util.js';
import { emit } from '../events.js';
import { dijkstra, timeTo, planPath } from '../traveler/nav.js';
import { gait, checkCollapse } from '../traveler/physiology.js';
import { perceive } from '../ship/wear.js';

const INTERRUPT_CATEGORIES = new Set(['critical', 'repair', 'need', 'sleep']);
const SWITCH_MARGIN = 0.1;
const CHOICE_BAND = 0.06;

export function actionDef(id) {
  const def = ACTIONS[id];
  if (!def) throw new Error(`unknown action ${id}`);
  return def;
}

function locToPos(data, loc) {
  if (loc.x !== undefined) return { room: loc.room, x: loc.x };
  const x = data.rooms[loc.room].stations[loc.station];
  if (x === undefined) throw new Error(`unknown station ${loc.room}.${loc.station}`);
  return { room: loc.room, x };
}

function gather(state, data, { interruptOnly = false } = {}) {
  const out = [];
  for (const id in ACTIONS) {
    const def = ACTIONS[id];
    if (interruptOnly && !INTERRUPT_CATEGORIES.has(def.category) && id !== 'repair' && id !== 'vent_heat') continue;
    const cs = def.gen(state, data, null);
    for (const c of cs) {
      if (!(c.score > 0)) continue;
      c.id = id;
      c.category = c.category || def.category;
      out.push(c);
    }
  }
  return out;
}

function routineTriggers(state, data, cands) {
  const hr = shipHour(state);
  const h = state.traveler.history;
  const day = missionDay(state);
  for (const [rid, r] of Object.entries(data.routines)) {
    const trig = r.trigger;
    if (!trig) continue;
    if (!inWindow(hr, trig.fromHour, trig.toHour)) continue;
    if (rid === 'evening' && h.eveningDay === day) continue;
    if (trig.everyHours && (state.t - h.lastRoundsT) / HOUR < trig.everyHours) continue;
    cands.push({ id: null, routine: rid, score: trig.score, locs: [{ room: state.traveler.pos.room, x: state.traveler.pos.x }], params: {}, category: 'chore' });
  }
}

/** Pick the nearest location for each candidate and apply distance / inertia / noise. */
function evaluate(state, data, cands) {
  const tr = state.traveler;
  const sp = dijkstra(data.nav, tr.pos, 1);
  const speed = data.traveler.walkSpeed * gait(state);
  for (const c of cands) {
    let best = null;
    let bestT = Infinity;
    for (const loc of c.locs) {
      const pos = locToPos(data, loc);
      const t = timeTo(data.nav, tr.pos, sp, pos, 1) / speed;
      if (t < bestT) { bestT = t; best = { loc, pos }; }
    }
    c.loc = best.loc;
    c.pos = best.pos;
    c.travel = bestT;
    c.eff = c.score - (bestT / 900) * 0.08 + (best.pos.room === tr.pos.room ? 0.04 : 0) + range(state.rng, -0.03, 0.03);
  }
}

function choose(state, cands) {
  let top = -Infinity;
  for (const c of cands) if (c.eff > top) top = c.eff;
  const pool = cands.filter((c) => c.eff >= top - CHOICE_BAND).map((c) => ({ c, w: c.eff - (top - CHOICE_BAND) + 0.01 }));
  return weighted(state.rng, pool).c;
}

function checkCond(state, data, cond) {
  if (!cond) return true;
  const n = state.traveler.needs;
  if (cond.need !== undefined) {
    if (cond.gt !== undefined && !(n[cond.need] > cond.gt)) return false;
    if (cond.lt !== undefined && !(n[cond.need] < cond.lt)) return false;
  }
  if (cond.chance !== undefined && !(rand(state.rng) < cond.chance)) return false;
  if (cond.tidy && !(rand(state.rng) < 0.35 + 0.6 * data.traveler.traits.tidiness)) return false;
  if (cond.sinceHours) {
    const h = (state.t - state.traveler.history[cond.sinceHours.key]) / HOUR;
    if (!(h > cond.sinceHours.gt)) return false;
  }
  return true;
}

function nextRoutineCandidate(state, data) {
  const r = state.traveler.routine;
  const steps = data.routines[r.id].steps;
  while (r.i < steps.length) {
    const step = steps[r.i++];
    if (!checkCond(state, data, step.if)) continue;
    let id = step.action;
    if (step.choose) {
      const opts = step.choose.map((a) => {
        const last = state.traveler.history.recent[a];
        const bored = last === undefined ? 0 : Math.exp(-(state.t - last) / HOUR / 12);
        return { a, w: (data.traveler.hobbies[a] ?? 0.5) * (1 - 0.8 * bored) };
      });
      id = weighted(state.rng, opts).a;
    }
    const def = actionDef(id);
    const cs = def.gen(state, data, { routine: true }).filter((c) => c.score > 0);
    if (!cs.length) continue;
    cs.sort((a, b) => b.score - a.score);
    const c = cs[0];
    c.id = id;
    c.category = c.category || def.category;
    c.score = Math.max(c.score, 0.4);
    c.fromRoutine = r.id;
    evaluate(state, data, [c]);
    return c;
  }
  return null;
}

function startRoutine(state, rid) {
  const h = state.traveler.history;
  state.traveler.routine = { id: rid, i: 0, startT: state.t };
  if (rid === 'evening') h.eveningDay = missionDay(state);
  if (rid === 'rounds') h.lastRoundsT = state.t;
  emit(state, 'routine_start', { routine: rid });
}

function startActivity(state, data, c) {
  const tr = state.traveler;
  const def = actionDef(c.id);
  if (c.startsRoutine && !tr.routine) tr.routine = { id: c.startsRoutine, i: 1, startT: state.t };
  tr.activity = {
    id: c.id, params: c.params || {}, loc: c.loc, phase: 'travel', startT: state.t, performT: null,
    duration: 0, elapsed: 0, score: c.score, category: c.category || def.category,
    commitUntil: state.t + 120, routine: c.fromRoutine || null,
  };
  const segs = planPath(data.nav, tr.pos, c.pos, 1);
  if (segs && segs.length) {
    tr.move = { segs, i: 0, segT: 0, target: c.pos };
    emit(state, 'walk_start', { to: c.pos.room, x: c.pos.x, activity: c.id });
  } else {
    beginPerform(state, data);
  }
}

function beginPerform(state, data) {
  const tr = state.traveler;
  const a = tr.activity;
  const def = actionDef(a.id);
  a.phase = 'perform';
  a.performT = state.t;
  a.elapsed = 0;
  if (def.start) def.start(state, data, a);
  a.duration = def.duration ? def.duration(state, data, a) : 300;
  const span = a.duration >= 0 ? a.duration : 8 * HOUR;
  a.commitUntil = state.t + Math.min(span, def.minCommit ?? 900);
  emit(state, 'activity_start', {
    activity: a.id, room: tr.pos.room, x: tr.pos.x, station: a.loc && a.loc.station, posture: def.posture,
    duration: a.duration, params: a.params, routine: a.routine,
  });
}

function finishActivity(state, data) {
  const tr = state.traveler;
  const a = tr.activity;
  const def = actionDef(a.id);
  if (def.complete) def.complete(state, data, a);
  tr.history.recent[a.id] = state.t;
  emit(state, 'activity_end', { activity: a.id, room: tr.pos.room, seconds: Math.round(a.elapsed) });
  tr.activity = null;
}

function interruptActivity(state, data, reason) {
  const tr = state.traveler;
  const a = tr.activity;
  const def = actionDef(a.id);
  if (a.phase === 'perform' && def.interrupt) def.interrupt(state, data, a);
  emit(state, 'activity_interrupted', { activity: a.id, reason, room: tr.pos.room });
  tr.activity = null;
  tr.move = null;
  tr.routine = null;
}

export function decide(state, data) {
  const tr = state.traveler;
  if (checkCollapse(state)) {
    tr.routine = null;
    startActivity(state, data, { id: 'doze', score: 1, params: {}, loc: { room: tr.pos.room, x: tr.pos.x }, pos: { ...tr.pos }, category: 'sleep' });
    return;
  }
  if (tr.routine) {
    const c = nextRoutineCandidate(state, data);
    if (c) {
      // A routine step still yields to anything clearly more pressing.
      const urgent = gather(state, data, { interruptOnly: true }).filter((u) => u.score > c.score + 0.2);
      if (!urgent.length) { startActivity(state, data, c); return; }
      tr.routine = null;
    } else {
      emit(state, 'routine_end', { routine: tr.routine.id });
      tr.routine = null;
    }
  }
  const cands = gather(state, data);
  routineTriggers(state, data, cands);
  if (!cands.length) return;
  evaluate(state, data, cands);
  const c = choose(state, cands);
  if (c.routine) {
    startRoutine(state, c.routine);
    const step = nextRoutineCandidate(state, data);
    if (step) startActivity(state, data, step);
    else tr.routine = null;
    return;
  }
  startActivity(state, data, c);
}

function maybeInterrupt(state, data) {
  const tr = state.traveler;
  const a = tr.activity;
  if (tr.move && tr.move.segs[tr.move.i].kind === 'hatch') return; // finish cycling the hatch first
  const def = actionDef(a.id);
  if (def.uninterruptible && a.phase === 'perform') return; // EVA, torpor: they manage their own exits
  // a major fault half-fixed is not left for bed: the repair holds against ordinary needs (alarms still cut in)
  const comp = a.id === 'repair' && a.params && state.ship.components[a.params.component];
  const fixingMajor = !!(comp && comp.fault && comp.fault.severity === 'major');
  const hold = a.score + (state.t < a.commitUntil ? 0.25 : 0.12) + (def.category === 'sleep' ? 0.3 : 0) + (fixingMajor && state.traveler.needs.fatigue < 0.97 ? 0.3 : 0);
  let best = null;
  for (const c of gather(state, data, { interruptOnly: true })) {
    if (c.id === a.id && sameTarget(c.params, a.params)) continue;
    if (!best || c.score > best.score) best = c;
  }
  // Alarms cut through task inertia (and sleep) — a chime wakes anyone.
  const effHold = best && best.category === 'critical' && def.category !== 'critical' ? Math.min(hold, 0.7) : hold;
  if (best && best.score > effHold + SWITCH_MARGIN) {
    interruptActivity(state, data, best.id);
    evaluate(state, data, [best]);
    startActivity(state, data, best);
  }
}

function sameTarget(p, q) {
  return p.component === q.component && p.tray === q.tray && p.room === q.room;
}

function advanceMove(state, data, dt) {
  const tr = state.traveler;
  let remaining = dt;
  while (remaining > 1e-9 && tr.move) {
    const mv = tr.move;
    const seg = mv.segs[mv.i];
    if (seg.kind === 'walk') {
      const speed = data.traveler.walkSpeed * gait(state);
      const dist = Math.abs(seg.x1 - tr.pos.x);
      const stepD = speed * remaining;
      if (stepD >= dist) {
        tr.pos.x = seg.x1;
        remaining -= dist / speed;
        nextSeg(tr);
      } else {
        tr.pos.x += Math.sign(seg.x1 - tr.pos.x) * stepD;
        remaining = 0;
      }
    } else {
      if (mv.segT === 0) emit(state, 'hatch_cycle', { hatch: seg.hatch, from: seg.from, to: seg.to });
      const need = seg.seconds - mv.segT;
      if (remaining >= need) {
        remaining -= need;
        tr.pos = { room: seg.to, x: seg.x1 };
        emit(state, 'room_enter', { room: seg.to, from: seg.from, hatch: seg.hatch });
        perceive(state, data, seg.to);
        nextSeg(tr);
      } else {
        mv.segT += remaining;
        remaining = 0;
      }
    }
  }
}

function nextSeg(tr) {
  tr.move.i++;
  tr.move.segT = 0;
  if (tr.move.i >= tr.move.segs.length) tr.move = null;
}

/** Per-tick traveler update (dt = 1 s). */
export function tickTraveler(state, data, dt) {
  const tr = state.traveler;
  const brainTick = state.tick % data.config.brainEvery === 0;
  if (tr.move) {
    advanceMove(state, data, dt);
    if (tr.move) {
      if (brainTick && tr.activity) maybeInterrupt(state, data);
      return;
    }
  }
  const a = tr.activity;
  if (!a) { decide(state, data); return; }
  if (a.phase === 'travel') { beginPerform(state, data); return; }
  a.elapsed += dt;
  const def = actionDef(a.id);
  if (def.fastTick) def.fastTick(state, data, a, dt);
  const finished = a.duration >= 0
    ? a.elapsed >= a.duration
    : state.tick % data.config.slowEvery === 0 && def.done(state, data, a);
  if (finished) {
    finishActivity(state, data);
    decide(state, data);
  } else if (brainTick) {
    maybeInterrupt(state, data);
  }
}

/** Exertion of whatever the traveler is doing (drives metabolism). */
export function currentExertion(state) {
  const tr = state.traveler;
  if (tr.move) return 1.1;
  if (!tr.activity || tr.activity.phase !== 'perform') return 0.8;
  return actionDef(tr.activity.id).exertion;
}

export function isAsleep(state) {
  const a = state.traveler.activity;
  return !!a && a.phase === 'perform' && !state.traveler.move && actionDef(a.id).category === 'sleep';
}
