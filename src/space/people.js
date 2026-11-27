// People: the bartender, the regulars and the clerk at each station, and the
// passengers who ride along. Each has a name, a face, a manner and a home;
// who they are comes from the galaxy seed, so the same faces are there on the
// next visit. What passes between them and the traveler is kept in the state:
// how often they've met, how well they get on, and what they talked about,
// so a conversation can pick up where the last one left off.
import { hrng } from './galaxy.js';
import { rand, range, int, pick } from '../sim/rng.js';
import { clamp } from '../sim/util.js';
import { emit } from '../sim/events.js';

const FIRST = ['Mara', 'Tomas', 'Ines', 'Kofi', 'Yara', 'Bram', 'Sena', 'Ilya', 'Nadia', 'Oren', 'Lucia', 'Dev', 'Hana', 'Pavel', 'Amara', 'Joss', 'Rhea', 'Teo', 'Wren', 'Idris', 'Saoirse', 'Kenji', 'Zofia', 'Malik', 'Esme', 'Rafe', 'Lin', 'Odile', 'Caspian', 'Tove'];
const LAST = ['Achterberg', 'Okonkwo', 'Varga', 'Silva', 'Lindgren', 'Haddad', 'Mori', 'Petrov', 'Quinlan', 'Abara', 'Doyle', 'Reyes', 'Nakashima', 'Falk', 'Ibsen', 'Mensah', 'Castell', 'Brook', 'Yilmaz', 'Duarte'];
const SKINS = [[236, 196, 164], [214, 170, 136], [190, 140, 104], [160, 112, 80], [124, 84, 58], [92, 62, 44]];
const HAIRS = [[30, 24, 20], [64, 46, 38], [120, 80, 50], [190, 150, 90], [150, 150, 150], [210, 200, 190], [140, 50, 40]];
const TOPS = [[170, 60, 60], [60, 110, 170], [200, 170, 70], [90, 150, 100], [140, 90, 160], [210, 210, 210], [60, 60, 70], [190, 110, 60], [90, 130, 140]];
const BOTTOMS = [[50, 52, 60], [70, 60, 50], [40, 60, 90], [90, 90, 96], [30, 30, 34], [110, 96, 70]];
const MANNERS = ['warm', 'gruff', 'curious', 'quiet', 'wry'];
const TRADES = { bartender: 'runs the bar', regular: 'a regular at the bar', clerk: 'keeps the mission board', passenger: 'passenger' };
const JOBS = ['a dock engineer', 'a hauler pilot', 'a hydroponics tech', 'a surveyor between contracts', 'a medic off shift', 'a cargo broker', 'a retired miner', 'a comms officer', 'a xenobiologist', 'a station archivist'];

function makePerson(seed, id, role, home) {
  const st = hrng(seed, 'person', id);
  return {
    id, role, home,
    name: `${pick(st, FIRST)} ${pick(st, LAST)}`,
    manner: pick(st, MANNERS),
    job: role === 'regular' ? pick(st, JOBS) : TRADES[role],
    age: int(st, 22, 71),
    look: { skin: pick(st, SKINS), hair: pick(st, HAIRS), top: pick(st, TOPS), bottom: pick(st, BOTTOMS), shoes: [40, 36, 32] },
  };
}

/** The people who work and drink at a station: a bartender, a clerk, and a handful of regulars. */
export function peopleAt(seed, station) {
  const home = station.name;
  const out = [makePerson(seed, `${station.id}:bartender`, 'bartender', home), makePerson(seed, `${station.id}:clerk`, 'clerk', home)];
  const st = hrng(seed, 'regulars', station.id);
  const n = int(st, 3, 5);
  for (let i = 0; i < n; i++) out.push(makePerson(seed, `${station.id}:regular:${i}`, 'regular', home));
  return out;
}

/** Which regulars are in tonight (it changes day to day; the bartender is always there). */
export function atTheBar(seed, station, day) {
  const all = peopleAt(seed, station);
  return all.filter((p) => p.role === 'bartender' || (p.role === 'regular' && rand(hrng(seed, 'in-tonight', p.id, day)) < 0.55));
}

/** A passenger: someone going home, or going somewhere new. */
export function makePassenger(seed, missionId, i, from, to) {
  const p = makePerson(seed, `pax:${missionId}:${i}`, 'passenger', from);
  p.going = to;
  return p;
}

// ───────── conversation ─────────
function recentNews(state) {
  const sp = state.space;
  const recs = (state.memory && state.memory.records) || [];
  const r = [...recs].reverse().find((x) => x.tags && (x.tags.includes('body') || x.tags.includes('eva') || x.tags.includes('rover') || x.tags.includes('star') || x.tags.includes('rings') || x.tags.includes('mission')));
  if (r) return r.subject;
  const d = sp.discoveries && sp.discoveries[sp.discoveries.length - 1];
  return d ? d.label || d.body : null;
}

const OPEN = {
  warm: ['came over smiling', 'poured something without being asked'],
  gruff: ['nodded once', 'looked up from the counter'],
  curious: ['wanted to know where the ship had been', 'asked about the route in'],
  quiet: ['made room at the end of the bar', 'listened more than talked'],
  wry: ['raised a glass to the long way round', 'asked if the ship still had all its pieces'],
};

/**
 * Talk with someone. Remembers it on both sides: their rapport and what was
 * said, and a 'conversation' event for the journal and memories.
 */
export function converse(state, person, place) {
  const sp = state.space;
  sp.people = sp.people || {};
  const rec = sp.people[person.id] || (sp.people[person.id] = { name: person.name, role: person.role, home: person.home, met: 0, rapport: 0.1, topics: [], lastT: null });
  const st = hrng(sp.galaxySeed, 'talk', person.id, rec.met, Math.floor(state.t / 3600));
  const news = recentNews(state);
  let line;
  if (rec.met === 0) {
    line = `${person.name} ${pick(st, OPEN[person.manner])}: ${person.job}${person.role === 'passenger' ? `, going to ${person.going}` : `, from ${person.home}`}.`;
  } else {
    const last = rec.topics[rec.topics.length - 1];
    const days = rec.lastT === null ? 0 : Math.round((state.t - rec.lastT) / 86400);
    line = last
      ? `${person.name} remembered ${last}${days > 1 ? `, ${days} days on` : ''}${person.manner === 'wry' ? ', and asked if it was worth it' : person.manner === 'curious' ? ', and wanted the rest of the story' : ''}.`
      : `${person.name} knew the face from last time.`;
  }
  const topic = news && !rec.topics.includes(news) ? news : null;
  if (topic) { rec.topics.push(topic); if (rec.topics.length > 6) rec.topics.shift(); line += ` Talked about ${topic}.`; }
  rec.met++;
  rec.lastT = state.t;
  rec.rapport = clamp(rec.rapport + 0.08 + (person.manner === 'warm' ? 0.04 : person.manner === 'gruff' ? -0.02 : 0));
  state.traveler.needs.solitude = clamp(state.traveler.needs.solitude - 0.06 - 0.05 * rec.rapport);
  emit(state, 'conversation', { who: person.name, role: person.role, person: person.id, place, met: rec.met, rapport: Math.round(rec.rapport * 100) / 100, topic, line, room: place === 'ship' ? 'paxlounge' : 'port' });
  return line;
}
