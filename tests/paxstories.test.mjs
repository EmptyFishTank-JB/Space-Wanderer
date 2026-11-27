// Passengers' small stories: a request, complaints when the ship gives them
// cause, and a farewell at the airlock that depends on how the trip went.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { step, drain } from '../src/sim/index.js';
import { boardPassengers, disembark, disembarkStrays, tickPassengers } from '../src/space/passengers.js';
import { makePassenger } from '../src/space/people.js';
import { tickStory, makeStory } from '../src/space/paxstories.js';
import { expireMissions } from '../src/space/ports.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';
import { neighbors } from '../src/space/galaxy.js';

function aboard(seed, n = 1, wish = null) {
  const s = fresh(seed);
  runCollect(s, 2 * HOUR); // up and about
  const dest = neighbors(s.space.galaxySeed, s.space.pos, 120, data.space).find((c) => c.id !== s.space.systemId);
  const m = { id: `m-${seed}`, kind: 'passenger', passengers: n, reward: 3000, faction: 'meridian', title: 'Passengers', to: { starId: dest.id, system: 'Halden 2210' }, deadlineT: s.t + 9 * DAY, acceptedT: s.t };
  s.space.missions = [m];
  boardPassengers(s, data, m, Array.from({ length: n }, (_, i) => makePassenger(s.space.galaxySeed, m.id, i, 'Okafor Station', 'Halden 2210')));
  if (wish) for (const p of s.space.passengers) Object.assign(p.story.wish, wish, { askAt: s.t });
  return { s, m };
}

function runUntil(s, pred, max) {
  const evs = [];
  for (let i = 0; i < max; i++) { step(s, data); if (s.outbox.length) evs.push(...drain(s)); if (pred(s, evs)) break; }
  return evs;
}

test('every passenger comes aboard with something to ask, and asks it within the day', () => {
  const { s } = aboard('ask', 3);
  for (const p of s.space.passengers) assert.ok(p.story && p.story.wish.ask && p.story.wish.askAt > s.t);
  const evs = runCollect(s, DAY);
  const asks = evs.filter((e) => e.type === 'passenger_request');
  assert.equal(asks.length, 3);
  assert.ok(asks.every((e) => e.line.length > 20));
  assert.deepEqual(makeStory('g', { id: 'x' }, 0), makeStory('g', { id: 'x' }, 0), 'stories are drawn from the seed');
});

test('the tour: the traveler meets them on the bridge and shows them round', () => {
  const { s } = aboard('tour', 1, { kind: 'tour', ask: 'asked to see the bridge', done: 'had the tour of the bridge' });
  const p = s.space.passengers[0];
  const mood = p.story.mood;
  const evs = runUntil(s, () => p.story.wish.granted, DAY);
  assert.ok(p.story.wish.granted, 'no tour within a day');
  assert.ok(evs.some((e) => e.type === 'passenger_wish' && e.kind === 'tour'));
  assert.ok(p.story.mood > mood);
  const t = aboard('tour2', 1, { kind: 'tour', ask: 'asked to see the bridge', done: 'had the tour' });
  const q = t.s.space.passengers[0];
  let together = false;
  for (let i = 0; i < DAY && !q.story.wish.granted; i++) {
    step(t.s, data); drain(t.s);
    const a = t.s.traveler.activity;
    if (a && a.id === 'give_tour' && a.phase === 'perform' && q.pos.room === 'bridge' && t.s.traveler.pos.room === 'bridge') together = true;
  }
  assert.ok(together, 'never on the bridge together');
});

test('something of theirs stopped working: fixed at the desk in their cabin, for a spare part', () => {
  const { s } = aboard('fix', 1, { kind: 'fix', what: 'reading lamp', ask: 'asked for help with a reading lamp that stopped working', done: 'got their reading lamp working again' });
  const p = s.space.passengers[0];
  const parts = s.ship.inventory.parts;
  let atDesk = false;
  for (let i = 0; i < DAY && !p.story.wish.granted; i++) {
    step(s, data); drain(s);
    const a = s.traveler.activity;
    if (a && a.id === 'fix_for_passenger' && a.phase === 'perform' && s.traveler.pos.room === p.cabin) atDesk = true;
  }
  assert.ok(p.story.wish.granted && atDesk);
  assert.ok(s.ship.inventory.parts <= parts);
});

test('a sight on the way: when it comes, they go to the gallery window and stay a while', () => {
  const { s } = aboard('sight', 1, { kind: 'see', what: 'star', ask: 'asked to be told when we skim a star', done: 'watched us skim a star' });
  const p = s.space.passengers[0];
  p.story.wish.asked = true;
  p.doing = 'reading in their cabin';
  const mode = s.ship.flight.mode;
  s.ship.flight.mode = 'scooping';
  tickStory(s, data, p);
  s.ship.flight.mode = mode;
  assert.ok(p.story.wish.granted);
  assert.equal(p.story.hold.room, 'gallery_s');
  assert.ok(drain(s).some((e) => e.type === 'passenger_wish'));
  for (let i = 0; i < 60; i++) tickPassengers(s, data, 10);
  assert.equal(p.pos.room, 'gallery_s', 'walked to the gallery to watch');
});

test('a complaint: the ship too hot, a word from the passenger, and the traveler hears them out', () => {
  const { s } = aboard('hot', 1);
  const p = s.space.passengers[0];
  p.story.wish.askAt = s.t + 9 * DAY; // nothing else on their mind
  s.ship.thermal.heat = 0.9;
  p.doing = 'in the passenger lounge';
  const mood = p.story.mood;
  tickStory(s, data, p);
  const c = drain(s).find((e) => e.type === 'passenger_complaint');
  assert.ok(c && c.kind === 'heat' && c.line.includes('oven'));
  assert.equal(p.story.pending, 'heat');
  assert.ok(p.story.mood < mood);
  tickStory(s, data, p);
  assert.ok(!drain(s).some((e) => e.type === 'passenger_complaint'), 'one complaint, not one a tick');
  s.ship.thermal.heat = 0.3;
  const evs = runUntil(s, () => !p.story.pending, DAY);
  assert.ok(evs.some((e) => e.type === 'passenger_reassured' && e.who === p.name));
});

test('the farewell: warm with a tip and maybe a gift, polite, or curt', () => {
  const { s, m } = aboard('bye', 3);
  const [a, b, c] = s.space.passengers;
  a.story.mood = 0.9; a.story.wish.granted = true; a.story.wish.asked = true; a.story.giftChance = 0.1;
  b.story.mood = 0.6; b.story.wish.asked = false;
  c.story.mood = 0.2;
  const credits = s.space.credits, keep = s.traveler.keepsakes.length;
  disembark(s, m.id, { fare: 1000, station: 'Okafor Station' });
  const byes = drain(s).filter((e) => e.type === 'passenger_farewell');
  assert.deepEqual(byes.map((e) => e.tone), ['warm', 'polite', 'curt']);
  assert.equal(byes[0].tip, 120);
  assert.equal(s.space.credits, credits + 120);
  assert.equal(byes[0].gift, a.story.gift);
  assert.equal(s.traveler.keepsakes.length, keep + 1);
  assert.ok(s.traveler.keepsakes.at(-1).label.includes(a.name));
  assert.equal(s.space.passengers.length, 0);
});

test('a passage that ran out of time: they ride on to the next port and leave there, unhappy', () => {
  const { s, m } = aboard('late', 2);
  m.deadlineT = s.t - 1;
  expireMissions(s);
  assert.equal(s.space.missions.length, 0);
  assert.equal(s.space.passengers.length, 2, 'not put off in the middle of nowhere');
  drain(s);
  assert.equal(disembarkStrays(s, 'Okafor Station'), 1);
  const byes = drain(s).filter((e) => e.type === 'passenger_farewell');
  assert.equal(byes.length, 2);
  assert.ok(byes.every((e) => e.late && e.tone !== 'warm'));
  assert.equal(s.space.passengers.length, 0);
});

test('stories never touch the sim RNG, and an older save gains them', () => {
  const { s } = aboard('rng', 3);
  const before = JSON.stringify(s.rng);
  for (let i = 0; i < 400; i++) { s.t += 10; tickPassengers(s, data, 10); }
  assert.equal(JSON.stringify(s.rng), before);
  for (const p of s.space.passengers) delete p.story;
  const up = deserialize(serialize(s).replace(/"version":\d+/, '"version":11'), data);
  assert.ok(up.space.passengers.every((p) => p.story && p.story.wish));
});
