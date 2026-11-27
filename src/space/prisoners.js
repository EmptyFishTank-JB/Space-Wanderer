// Prisoners. A bounty contract that wants the target alive: the traveler
// shoots out their drive rather than their reactor, fetches a sidearm from
// the armory, brings them across through the airlock and walks them to a
// brig cell. In the brig they sleep, pace and wait; the traveler brings them
// meals and, meal by meal, they talk a little more. At one of the issuing
// faction's stations security takes them off the traveler's hands for the
// reward. If the contract runs out first, any station's security takes them,
// for nothing. Their day comes from the clock, not the sim's RNG.
import { hrng } from './galaxy.js';
import { rand, pick } from '../sim/rng.js';
import { shipHour } from '../sim/clock.js';
import { emit } from '../sim/events.js';
import { clamp } from '../sim/util.js';
import { makePrisoner } from './people.js';

export const CELLS = ['cell_1', 'cell_2'];
const ISSUE = [204, 112, 48]; // brig-issue coveralls
const HOUR = 3600;

export function initPrisoners(state) {
  if (state.space && !state.space.prisoners) state.space.prisoners = [];
}

const list = (state) => (state.space && state.space.prisoners) || [];
export const prisonerIn = (state, st) => list(state).find((p) => p.state === st) || null;
export const heldFor = (state, missionId) => list(state).find((p) => p.missionId === missionId && p.state === 'held') || null;

/** A brig cell nobody is in, and nobody is promised to. */
export function freeCells(state) {
  const sp = state.space;
  const used = list(state).length;
  const promised = (sp.missions || []).filter((m) => m.kind === 'bounty' && m.alive && !m.captured && !m.killed).length;
  return Math.max(0, CELLS.length - used - promised);
}

/** The target's drive shot out: their ship drifts alongside, waiting to be boarded. */
export function takePrisoner(state, data, foe, m) {
  const sp = state.space;
  initPrisoners(state);
  const cell = CELLS.find((c) => !sp.prisoners.some((p) => p.cell === c)) || CELLS[CELLS.length - 1];
  const person = makePrisoner(sp.galaxySeed, foe, m ? m.id : `${foe.name}:${Math.floor(state.t)}`);
  sp.prisoners.push({
    ...person, missionId: m ? m.id : null, faction: m ? m.faction : null, cls: foe.cls, cell, state: 'alongside',
    pos: null, takenT: state.t, lastMealT: state.t, meals: 0, doing: 'waiting in a dead ship', complained: false, ownLook: person.look,
  });
  emit(state, 'prisoner_taken', { who: foe.name, cls: foe.cls, room: 'bridge' });
}

/** The boarding steps, as the traveler's activities finish them. */
export function prisonerAtLock(state, data) {
  const p = prisonerIn(state, 'alongside');
  if (!p) return;
  p.state = 'at_lock';
  p.pos = { room: 'airlock', x: data.rooms.airlock.stations.outer_door - 0.6 };
  p.doing = 'coming across in a suit';
  emit(state, 'prisoner_boarding', { who: p.name, room: 'airlock' });
}

export function prisonerSearched(state) {
  const p = prisonerIn(state, 'at_lock');
  if (!p) return;
  p.state = 'escorted';
  p.doing = 'being walked to the brig';
  p.lastTx = state.traveler.pos.x;
}

export function prisonerLockedUp(state, data) {
  const p = prisonerIn(state, 'escorted');
  if (!p) return;
  p.state = 'held';
  p.pos = { room: 'brig', x: data.rooms.brig.stations[p.cell] - 0.4 };
  p.look = { ...p.look, top: ISSUE, bottom: ISSUE };
  p.doing = 'sitting on the bunk';
  emit(state, 'prisoner_held', { who: p.name, cell: p.cell, room: 'brig' });
}

/** Per second: someone being walked to the brig keeps a step behind the traveler. */
export function stepPrisoners(state, data) {
  const p = prisonerIn(state, 'escorted');
  if (!p) return;
  const tr = state.traveler.pos;
  const dx = tr.x - (p.lastTx ?? tr.x);
  if (Math.abs(dx) > 1e-4) p.dir = Math.sign(dx);
  p.lastTx = tr.x;
  const w = data.rooms[tr.room] ? data.rooms[tr.room].width : 4;
  p.pos = { room: tr.room, x: clamp(tr.x - (p.dir || 1) * 0.9, 0.3, w - 0.3) };
  p.moving = Math.abs(dx) > 1e-4;
}

/** What someone in a cell is doing: asleep at night, otherwise a fresh choice every forty minutes or so. */
function cellDay(state, data, p) {
  const h = shipHour(state);
  const c = data.rooms.brig.stations[p.cell];
  if (h >= 22.8 || h < 6.5) return { x: c - 0.4, doing: 'asleep' };
  const u = rand(hrng(state.space.galaxySeed, 'cell-day', p.id, Math.floor(state.t / 2400)));
  if (u < 0.4) return { x: c - 0.4, doing: 'sitting on the bunk' };
  if (u < 0.65) return { x: c, doing: 'pacing the cell' };
  if (u < 0.85) return { x: c + 0.5, doing: 'at the bars' };
  return { x: c - 0.4, doing: 'lying on the bunk, awake' };
}

/** Per slow tick: the brig's day, and a word if a meal is late. */
export function tickPrisoners(state, data) {
  for (const p of list(state)) {
    if (p.state !== 'held') continue;
    const g = cellDay(state, data, p);
    p.doing = g.doing;
    p.pos = { room: 'brig', x: g.x };
    const since = (state.t - p.lastMealT) / HOUR;
    if (since > 14 && !p.complained && g.doing !== 'asleep') {
      p.complained = true;
      state.traveler.needs.stress = clamp(state.traveler.needs.stress + 0.03);
      emit(state, 'prisoner_hungry', { who: p.name, hours: Math.round(since), room: 'brig' });
    }
  }
}

const TALK = {
  sullen: ['ate without a word and pushed the tray back', 'turned to the wall', 'said nothing, but ate it all'],
  defiant: ['said the bounty was a lie', 'said friends would be waiting at the station', 'wanted to know who paid for this'],
  talkative: ['talked about the run that went wrong', 'asked where we were', 'wanted to know about the ship'],
  wry: ['asked if dinner came with a view', 'rated the cell two stars', 'asked for the wine list'],
  quiet: ['said thank you, quietly', 'asked how many days', 'asked what the station was like'],
};
const OPENING_UP = ['told how they got into it: a debt, then another', 'talked about a sister on a station two sectors over', 'said the gunship was never theirs, only the debt on it', 'said they used to haul water, before'];

/** A meal through the hatch, and whatever they have to say. Remembered like any conversation. */
export function feedPrisoner(state, data, p) {
  const sp = state.space;
  state.ship.food.pantry = Math.max(0, state.ship.food.pantry - 750);
  p.lastMealT = state.t;
  p.complained = false;
  p.meals = (p.meals || 0) + 1;
  sp.people = sp.people || {};
  const rec = sp.people[p.id] || (sp.people[p.id] = { name: p.name, role: 'prisoner', home: null, met: 0, rapport: 0, topics: [], lastT: null });
  const st = hrng(sp.galaxySeed, 'cell-talk', p.id, p.meals);
  rec.met++; rec.lastT = state.t;
  rec.rapport = clamp(rec.rapport + (p.manner === 'sullen' ? 0.04 : p.manner === 'defiant' ? 0.03 : 0.07));
  // after a few meals, most of them say something real
  const opens = rec.rapport > 0.25 && !rec.topics.length && rand(st) < 0.6;
  const said = opens ? pick(st, OPENING_UP) : pick(st, TALK[p.manner] || TALK.quiet);
  if (opens) rec.topics.push(said);
  state.traveler.needs.solitude = clamp(state.traveler.needs.solitude - 0.02 - (opens ? 0.04 : 0));
  emit(state, 'prisoner_fed', { who: p.name, line: `${p.name} ${said}.`, opened: opens, meals: p.meals, room: 'brig' });
  return said;
}

/** At a station of the faction that wanted them: security takes the prisoner, and the contract pays. */
export function handOver(state, stn, m) {
  const sp = state.space;
  const p = heldFor(state, m.id);
  if (!p) return null;
  sp.prisoners = sp.prisoners.filter((x) => x !== p);
  emit(state, 'prisoner_handover', { who: p.name, station: stn.name, faction: stn.faction, paid: m.reward, days: Math.round(((state.t - p.takenT) / 86400) * 10) / 10, room: 'airlock' });
  return p;
}

/** Prisoners whose contract ran out: any station's security takes them, for nothing. */
export function handOverStrays(state, stn) {
  const sp = state.space;
  const strays = list(state).filter((p) => p.state === 'held' && !(p.missionId && (sp.missions || []).some((m) => m.id === p.missionId)));
  for (const p of strays) {
    sp.prisoners = sp.prisoners.filter((x) => x !== p);
    emit(state, 'prisoner_handover', { who: p.name, station: stn.name, faction: stn.faction, paid: 0, days: Math.round(((state.t - p.takenT) / 86400) * 10) / 10, room: 'airlock' });
  }
  return strays;
}
