// People and passengers: the same faces at a station from visit to visit,
// conversations that remember, and passengers living their days aboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, DAY, HOUR } from './helpers.mjs';
import { neighbors } from '../src/space/galaxy.js';
import { stationIn } from '../src/space/ports.js';
import { peopleAt, atTheBar, converse, makePassenger } from '../src/space/people.js';
import { boardPassengers, disembark } from '../src/space/passengers.js';
import { shipHour } from '../src/sim/clock.js';

function aStation(s) {
  for (const c of neighbors(s.space.galaxySeed, s.space.pos, 120, data.space)) { const stn = stationIn(s.space.galaxySeed, c.id, data.space); if (stn) return stn; }
  throw new Error('no station');
}

test('a station has the same people on every visit, and some of them are in tonight', () => {
  const s = fresh('people');
  const stn = aStation(s);
  const a = peopleAt(s.space.galaxySeed, stn), b = peopleAt(s.space.galaxySeed, stn);
  assert.deepEqual(a.map((p) => p.name), b.map((p) => p.name));
  assert.ok(a.some((p) => p.role === 'bartender') && a.some((p) => p.role === 'clerk') && a.filter((p) => p.role === 'regular').length >= 3);
  const tonight = atTheBar(s.space.galaxySeed, stn, 10);
  assert.ok(tonight.some((p) => p.role === 'bartender'));
  for (const p of a) assert.ok(p.look.skin && p.look.hair && p.look.top, `${p.name} has a face and clothes`);
});

test('a conversation is remembered: rapport grows and the next one picks up the thread', () => {
  const s = fresh('talk');
  const stn = aStation(s);
  const barkeep = peopleAt(s.space.galaxySeed, stn).find((p) => p.role === 'bartender');
  s.memory.records.push({ id: 999, subject: 'the rings of Vessel 4', tags: ['body', 'rings'], w: 0.5, v: 0.7, t: s.t });
  const first = converse(s, barkeep, stn.name);
  assert.ok(first.includes(barkeep.name));
  const r1 = s.space.people[barkeep.id];
  assert.equal(r1.met, 1);
  assert.deepEqual(r1.topics, ['the rings of Vessel 4']);
  s.t += 3 * DAY;
  const again = converse(s, barkeep, stn.name);
  assert.ok(again.includes('remembered the rings of Vessel 4'), again);
  assert.equal(s.space.people[barkeep.id].met, 2);
  assert.ok(s.space.people[barkeep.id].rapport > r1.rapport - 1e-9);
});

test('passengers live their days aboard: cabins at night, the lounge at meals, the galleries; and they talk', () => {
  const s = fresh('pax');
  const m = { id: 'm-pax', passengers: 2, to: { system: 'Halden 2210' } };
  boardPassengers(s, data, m, [0, 1].map((i) => makePassenger(s.space.galaxySeed, m.id, i, 'Okafor Station', 'Halden 2210')));
  assert.equal(s.space.passengers.length, 2);
  assert.notEqual(s.space.passengers[0].cabin, s.space.passengers[1].cabin);
  const rooms = new Set();
  let asleepInCabin = false, eatingInLounge = false;
  const evs = [];
  for (let i = 0; i < 2 * DAY; i += 10) {
    evs.push(...runCollect(s, 10));
    for (const p of s.space.passengers) {
      rooms.add(p.pos.room);
      const h = shipHour(s);
      if ((h > 23 || h < 5) && p.doing === 'asleep' && p.pos.room === p.cabin) asleepInCabin = true;
      if (p.doing === 'eating in the lounge' && p.pos.room === 'paxlounge') eatingInLounge = true;
    }
  }
  assert.ok(rooms.size >= 3, `passengers only used ${[...rooms].join(', ')}`);
  assert.ok(asleepInCabin && eatingInLounge);
  assert.ok(evs.some((e) => e.type === 'conversation' && e.place === 'ship'), 'the traveler never talked with them');
  disembark(s, m.id);
  assert.equal(s.space.passengers.length, 0);
});
