// Passengers aboard: each has a cabin and a day of their own (sleep, meals in
// the passenger lounge, time in the galleries looking out, reading at the
// desk, a walk), and walks the ship's passages like the traveler does. Where
// they go is chosen from the clock, never the sim's RNG, so carrying people
// does not change the traveler's own story.
import { planPath } from '../sim/traveler/nav.js';
import { hrng } from './galaxy.js';
import { rand } from '../sim/rng.js';
import { shipHour } from '../sim/clock.js';
import { emit } from '../sim/events.js';

const CABINS = ['cabin_a', 'cabin_b', 'cabin_c'];
const SPEED = 1.0; // m/s, an easy pace

/** Board a mission's passengers into the free cabins. */
export function boardPassengers(state, data, mission, people) {
  const sp = state.space;
  sp.passengers = sp.passengers || [];
  for (const p of people) {
    const cabin = CABINS.find((c) => !sp.passengers.some((q) => q.cabin === c));
    if (!cabin) break;
    sp.passengers.push({ ...p, missionId: mission.id, cabin, pos: { room: cabin, x: data.rooms[cabin].stations.mid }, path: null, seg: 0, segT: 0, doing: 'settling in', goal: null });
    emit(state, 'passenger_board', { who: p.name, going: p.going, cabin, room: cabin });
  }
}

/** Their mission is done: they go ashore. */
export function disembark(state, missionId) {
  const sp = state.space;
  if (!sp.passengers) return;
  for (const p of sp.passengers.filter((q) => q.missionId === missionId)) emit(state, 'passenger_leave', { who: p.name, going: p.going, room: 'airlock' });
  sp.passengers = sp.passengers.filter((q) => q.missionId !== missionId);
}

/** Where a passenger wants to be right now, and what they are doing there. */
function goal(state, data, p, i) {
  const h = shipHour(state);
  const st = data.rooms;
  if (h >= 22.5 || h < 6.8) return { room: p.cabin, x: st[p.cabin].stations.bunk, doing: 'asleep' };
  for (const [a, b] of [[7.3, 8.1], [12.4, 13.2], [18.6, 19.5]]) if (h >= a && h < b) return { room: 'paxlounge', x: st.paxlounge.stations.seats + (i - 1) * 0.6, doing: 'eating in the lounge' };
  // the rest of the day: a fresh choice every half hour or so, from the clock
  const slot = Math.floor(state.t / 1700);
  const u = rand(hrng(state.space.galaxySeed, 'pax-day', p.id, slot));
  if (u < 0.3) return { room: 'gallery_s', x: st.gallery_s.stations.viewport + i * 1.5, doing: 'looking out from the gallery' };
  if (u < 0.45) return { room: 'gallery_p', x: st.gallery_p.stations.viewport - i * 1.5, doing: 'looking out from the port gallery' };
  if (u < 0.7) return { room: p.cabin, x: st[p.cabin].stations.desk, doing: 'reading in their cabin' };
  if (u < 0.88) return { room: 'paxlounge', x: st.paxlounge.stations.seats + (i - 1) * 0.6, doing: 'in the passenger lounge' };
  return { room: 'cross_main', x: st.cross_main.stations.mid + (i - 1) * 3, doing: 'stretching their legs' };
}

/** Move every passenger along. Per slow tick. */
export function tickPassengers(state, data, dt) {
  const sp = state.space;
  if (!sp || !sp.passengers || !sp.passengers.length) return;
  sp.passengers.forEach((p, i) => {
    const g = goal(state, data, p, i);
    const same = p.goal && p.goal.room === g.room && Math.abs(p.goal.x - g.x) < 0.01;
    if (!same) {
      p.goal = { room: g.room, x: g.x };
      p.path = planPath(data.nav, p.pos, p.goal) || [];
      p.seg = 0; p.segT = 0;
    }
    p.doing = g.doing;
    let budget = dt;
    while (budget > 0 && p.path && p.seg < p.path.length) {
      const s = p.path[p.seg];
      if (s.kind === 'walk') {
        const left = s.x1 - p.pos.x;
        const step = Math.min(Math.abs(left), SPEED * budget);
        p.pos = { room: s.room, x: p.pos.x + Math.sign(left) * step };
        budget -= step / SPEED;
        if (Math.abs(s.x1 - p.pos.x) < 1e-6) { p.seg++; p.segT = 0; }
      } else {
        const need = s.seconds - p.segT;
        const use = Math.min(need, budget);
        p.segT += use; budget -= use;
        if (p.segT >= s.seconds - 1e-9) { p.pos = { room: s.to, x: s.x1 }; p.seg++; p.segT = 0; }
      }
    }
    p.moving = !!(p.path && p.seg < p.path.length);
  });
}
