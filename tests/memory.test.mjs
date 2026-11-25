import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, clone, DAY, HOUR } from './helpers.mjs';
import { emit } from '../src/sim/events.js';
import { STATE_VERSION } from '../src/sim/index.js';
import { writeLog } from '../src/memory/logwriter.js';
import { lintLog } from '../src/memory/lint.js';
import { captionFor } from '../src/memory/captions.js';
import { MEMORY_CAP } from '../src/memory/observe.js';
import { MemoryJournal } from '../src/persist/journal.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';
import { buildLogFacts } from '../src/sim/ai/logfacts.js';
import { seedRng, rand } from '../src/sim/rng.js';

const SPEC_FIELDS = ['timestamp', 'mission_year', 'system_id', 'star_class', 'event_type', 'emotional_weight', 'summary', 'callback_count'];

test('notable moments become weighted memories with the spec fields', () => {
  const s = fresh('mem');
  emit(s, 'discovery', { kind: 'life', system: 'Ivra 2211', body: 'Ivra 2211 c', bodyId: 'p2', bodyType: 'rocky' });
  emit(s, 'touchdown', { body: 'Ivra 2211 c', bodyType: 'rocky', gravity: 0.4, tempK: 230, first: true });
  emit(s, 'meal', { kcal: 800, quality: 0.5 }); // ordinary: not a memory
  const recs = s.memory.records;
  assert.equal(recs.length, 2);
  for (const f of SPEC_FIELDS) assert.ok(f in recs[0], `missing ${f}`);
  assert.equal(recs[0].event_type, 'discovery_life');
  assert.ok(recs[0].emotional_weight > recs[1].emotional_weight);
  assert.equal(recs[0].star_class, s.space.starClass);
  assert.ok(s.outbox.some((e) => e.type === 'memory_formed' && e.record.id === recs[0].id));
});

test('near-duplicate memories merge; the working set is capped by forgetting the faintest', () => {
  const s = fresh('cap');
  emit(s, 'awe', { subject: 'body', id: 'p1', name: 'Wren 4417 b' });
  emit(s, 'awe', { subject: 'body', id: 'p1', name: 'Wren 4417 b' });
  assert.equal(s.memory.records.length, 1);
  emit(s, 'discovery', { kind: 'life', system: 'X', body: 'X b', bodyType: 'rocky' });
  for (let i = 0; i < MEMORY_CAP + 20; i++) { s.t += 3 * DAY; emit(s, 'awe', { subject: 'body', id: `p${i}`, name: `Body ${i}` }); }
  assert.equal(s.memory.records.length, MEMORY_CAP);
  assert.ok(s.memory.records.some((r) => r.event_type === 'discovery_life'), 'the heaviest memory was forgotten');
});

test('the journal keeps memories in IndexedDB-shaped storage and tracks callbacks', async () => {
  const s = fresh('journal');
  const j = new MemoryJournal();
  emit(s, 'discovery', { kind: 'anomaly', system: 'Esk 1', body: 'Esk 1 b', anomaly: 'crystalline_spires' });
  const rec = s.memory.records[0];
  await j.append(s.outbox.splice(0));
  emit(s, 'memory_recalled', { memoryId: rec.id, callback_count: 3, via: 'log' });
  await j.append(s.outbox.splice(0));
  const [m] = await j.memories();
  assert.equal(m.id, rec.id);
  assert.equal(m.callback_count, 3);
});

function collectLogs(seed, days) {
  const s = fresh(seed);
  const logs = runCollect(s, days * DAY, ['log_entry', 'memory_recalled', 'book_finished', 'reflection']);
  return { s, logs: logs.filter((e) => e.type === 'log_entry'), evs: logs };
}

test('a voyage writes grounded logs: concrete, varied, never cliché', () => {
  const all = [];
  for (const seed of ['log-a', 'log-b', 'log-c']) all.push(...collectLogs(seed, 25).logs);
  assert.ok(all.length >= 60, `${all.length} logs`);
  const openings = new Set();
  for (const e of all) {
    assert.deepEqual(lintLog(e.text), [], `entry #${e.entry}: ${e.text}`);
    const n = e.text.split(/(?<=[.?])\s+/).length;
    assert.ok(n >= 2 && n <= 10, `entry #${e.entry} has ${n} sentences`);
    assert.ok(e.header && /^Y\d+ D\d{3} \d\d:\d\d/.test(e.header), e.header);
    openings.add(e.text.split(' ').slice(0, 3).join(' '));
  }
  assert.ok(openings.size > all.length * 0.3, `openings too samey: ${openings.size}/${all.length}`);
});

test('fuzzed fact sets never produce a cliché, an exclamation or a run-on', () => {
  const s = fresh('fuzz');
  const st = seedRng('fuzz');
  const r = () => rand(st);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const base = buildLogFacts(s, data);
  for (let i = 0; i < 400; i++) {
    const f = clone(base);
    f.repairs = r() < 0.5 ? [{ component: pick(data.componentIds), fault: pick(['bearing_rattle', 'filter_clog', 'arcing', 'flicker', 'manifold_leak', 'coil_harmonic']), juryRig: r() < 0.2 }] : [];
    f.harvests = r() < 0.4 ? [{ crop: pick(data.cropIds), kg: r() * 20 }] : [];
    f.algaeHeavyMeals = Math.floor(r() * 3);
    f.pantryDays = Math.floor(r() * 60);
    f.mistakes = r() < 0.1 ? 1 : 0;
    f.hobbies = { play_instrument: r() < 0.5 ? 1 : 0, listen_music: 1, play_solitaire: 1 };
    f.skills = { instrument: r(), sketch: r(), chess: r() };
    f.books = r() < 0.2 ? ['Notes on Soil'] : [];
    f.mood = { wonder: r(), weariness: r(), stress: r(), solitude: r() };
    f.daysSinceNovelty = r() * 10;
    f.voyage = {
      ...f.voyage,
      arrivals: r() < 0.6 ? [{ system: 'Wren 4417', label: pick(['red dwarf', 'white dwarf', 'neutron star']), ly: 30, via: 'jump' }] : [],
      discoveries: r() < 0.5 ? [{ kind: pick(['life', 'anomaly', 'bio_signal', 'star', 'body']), body: 'Wren 4417 c', bodyType: pick(['earth_like', 'water_world', 'gas_giant']), rings: r() < 0.5, label: 'white dwarf', system: 'Wren 4417', first: r() < 0.5 }] : [],
      scoops: r() < 0.5 ? [{ tons: r() * 25, peakHeat: 0.5 + r() * 0.6, reason: pick(['full', 'overheat', 'time']) }] : [],
      evas: r() < 0.3 ? [{ body: 'Wren 4417 c', walkedM: 800 + r() * 3000, features: ['geyser', 'outcrop'], samples: { ore: r() * 5, ice: r() * 10, bio: 0 } }] : [],
      landings: r() < 0.3 ? [{ body: 'Wren 4417 c', gravity: 0.4, tempK: 200, first: true }] : [],
      awe: r() < 0.3 ? ['body'] : [],
      torpor: r() < 0.1 ? { years: 12.3, ly: 410 } : null,
      atBody: r() < 0.5 ? { name: 'Wren 4417 c', type: pick(['gas_giant', 'icy', 'earth_like', 'rocky']), rings: r() < 0.5, atmosphere: pick(['none', 'thin', 'thick']), beauty: r() } : null,
      starClass: pick(['M', 'K', 'G', 'D']),
    };
    const log = writeLog({ state: s, data, facts: f, entry: 5000 + i });
    assert.deepEqual(lintLog(log.text), [], log.text);
    assert.ok(!log.text.includes('undefined') && !log.text.includes('NaN') && !log.text.includes('null'), log.text);
    assert.ok(!/\b(\w+) \1\b/i.test(log.text.replace(/\b(\d+)\b/g, '')), `doubled word: ${log.text}`);
    if (f.voyage.torpor) assert.ok(/years/.test(log.text), 'torpor entry must say how long');
  }
});

test('logs are deterministic: the same traveler writes the same words, live or caught up', () => {
  const a = collectLogs('det-log', 6).logs.map((e) => e.text);
  const b = collectLogs('det-log', 6).logs.map((e) => e.text);
  assert.ok(a.length >= 4);
  assert.deepEqual(a, b);
});

test('logs mention what actually happened (repairs and harvests by name)', () => {
  const s = fresh('concrete');
  const f = buildLogFacts(s, data);
  f.repairs = [{ component: 'hydro_pump_2', fault: 'bearing_rattle', juryRig: false }];
  f.harvests = [{ crop: 'tomato', kg: 9.4 }];
  f.voyage = { ...f.voyage, arrivals: [], discoveries: [], scoops: [], awe: [] };
  let named = 0;
  for (let e = 0; e < 20; e++) {
    const t = writeLog({ state: s, data, facts: f, entry: e }).text;
    if (/hydroponic pump 2/i.test(t) && /tomatoes/.test(t)) named++;
  }
  assert.ok(named >= 10, `only ${named}/20 entries named both`);
});

test('callbacks and reflection bring old memories back, and count it', () => {
  const { s, logs, evs } = collectLogs('callbacks', 40);
  const cb = logs.filter((e) => e.callback);
  assert.ok(cb.length >= 2, `only ${cb.length} callbacks in ${logs.length} logs`);
  assert.ok(evs.some((e) => e.type === 'reflection'), 'never reflected on a memory');
  assert.ok(s.memory.records.some((r) => r.callback_count > 0));
  assert.ok(s.memory.logs.length > 0 && s.memory.logs.length <= 20);
});

test('living details: books get finished, skills improve, sketches are of remembered things', () => {
  const s = fresh('hobbies');
  const skills0 = { ...s.traveler.skills };
  const evs = runCollect(s, 45 * DAY, ['book_finished']);
  assert.ok(evs.length >= 1, 'never finished a book');
  assert.ok(data.traveler.library.some((b) => b.title === evs[0].title));
  const sk = s.traveler.skills;
  assert.ok(sk.instrument > skills0.instrument || sk.sketch > skills0.sketch, 'no practice paid off');
  for (const sketch of s.traveler.sketchesOf) assert.ok(typeof sketch.subject === 'string' && sketch.subject.length > 3);
});

test('captions show only while an entry is being typed, in that room', () => {
  const s = fresh('caption');
  for (let i = 0; i < 4 * DAY; i++) {
    runCollect(s, 30);
    const a = s.traveler.activity;
    if (a && a.id === 'write_log' && a.phase === 'perform' && a.elapsed > a.duration * 0.6) break;
  }
  const a = s.traveler.activity;
  assert.equal(a.id, 'write_log');
  const room = s.traveler.pos.room;
  const c = captionFor(s, room);
  assert.ok(c && c.text.length > 0, 'no caption while writing');
  assert.ok(a.params.text.includes(c.text), 'caption is not from the entry');
  const other = room === 'bridge' ? 'galley' : 'bridge';
  assert.equal(captionFor(s, other), null, 'caption leaked into another room');
  runCollect(s, Math.ceil(a.duration));
  assert.equal(captionFor(s, room), null, 'caption outlived the writing');
});

test('Phase 2–4 (v2) snapshots upgrade with an empty memory', () => {
  const s = fresh('v2');
  runCollect(s, 2 * HOUR);
  const v2 = clone(s);
  delete v2.memory;
  delete v2.traveler.skills;
  delete v2.traveler.library;
  delete v2.traveler.sketchesOf;
  delete v2.space.systemName;
  delete v2.space.starClass;
  const text = serialize(v2).replace(`"version":${STATE_VERSION}`, '"version":2');
  const up = deserialize(text, data);
  assert.equal(up.version, STATE_VERSION);
  assert.deepEqual(up.memory.records, []);
  assert.ok(up.space.systemName && up.space.starClass);
  runCollect(up, DAY);
});
