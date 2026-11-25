import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, HOUR } from './helpers.mjs';
import { bootSimulation, STATE_VERSION } from '../src/sim/index.js';
import { SnapshotStore, MemoryStorage, SNAPSHOT_KEY, BACKUP_KEY, serialize, deserialize } from '../src/persist/snapshot.js';
import { MemoryJournal } from '../src/persist/journal.js';
import { buildBackup, parseBackup } from '../src/persist/backup.js';

test('boot: fresh traveler, then a 6-hour absence is caught up on reopen', async () => {
  const storage = new MemoryStorage();
  const journal = new MemoryJournal();
  let now = 1_700_000_000_000;
  const clock = () => now;

  const first = await bootSimulation({ data, snapshots: new SnapshotStore(storage), journal, now: clock, seed: 'boot' });
  assert.equal(first.fresh, true);
  assert.equal(first.state.t, 0);

  now += 6 * HOUR * 1000 + 400; // tab closed for six hours
  const second = await bootSimulation({ data, snapshots: new SnapshotStore(storage), journal, now: clock });
  assert.equal(second.fresh, false);
  assert.equal(second.plan.simulate, 6 * HOUR);
  assert.equal(second.state.t, 6 * HOUR);
  assert.equal(second.state.wallMs, 1_700_000_000_000 + 6 * HOUR * 1000);
  const types = new Set((await journal.all()).map((e) => e.type));
  assert.ok(types.has('wake') && types.has('meal'), `journal: ${[...types]}`);
  // the verbose movement chatter is not journaled
  assert.ok(!types.has('hatch_cycle') && !types.has('activity_start'));
});

test('snapshot store keeps a backup slot and falls back to it on corruption', () => {
  const storage = new MemoryStorage();
  const store = new SnapshotStore(storage);
  const fake = { version: 1, t: 1, outbox: [{ x: 1 }], wallMs: 5 };
  store.save({ ...fake, t: 1 });
  store.save({ ...fake, t: 2 });
  assert.equal(store.load().t, 2);
  assert.deepEqual(store.load().outbox, []);
  storage.setItem(SNAPSHOT_KEY, '{"truncated');
  assert.equal(store.load().t, 1);
  storage.removeItem(BACKUP_KEY);
  assert.equal(store.load(), null);
});

test('snapshots refuse foreign or future-version payloads', () => {
  assert.throws(() => deserialize('{"hello":1}'));
  const text = serialize({ version: STATE_VERSION, t: 0, outbox: [] }).replace(`"version":${STATE_VERSION}`, '"version":999');
  assert.throws(() => deserialize(text), /newer/);
});

test('backup export/import round-trips state and journal', () => {
  const state = { version: 1, t: 42, outbox: [], wallMs: 9, traveler: { name: 'x' } };
  const events = [{ id: 1, type: 'meal' }, { id: 2, type: 'wake' }];
  const back = parseBackup(buildBackup(state, events));
  assert.equal(back.state.t, 42);
  assert.deepEqual(back.events, events);
  assert.throws(() => parseBackup('{"format":"nope"}'));
});

// ───────────── full-archive backups (events + systems + memories) ─────────────
import { importVoyage, BACKUP_VERSION } from '../src/persist/backup.js';
import { createInitialState, step, drain } from '../src/sim/index.js';

async function voyageWithArchive(seed, days) {
  const s = createInitialState(data, { seed });
  s.wallMs = 1;
  const j = new MemoryJournal();
  for (let i = 0; i < days * 86400; i++) { step(s, data); if (s.outbox.length) await j.append(drain(s)); }
  return { s, j };
}
const sortById = (xs) => [...xs].sort((a, b) => (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
async function sameArchive(a, b) {
  const x = await a.exportArchive();
  const y = await b.exportArchive();
  for (const k of ['events', 'systems', 'memories']) assert.deepEqual(sortById(y[k]), sortById(x[k]), `${k} differ`);
}

test('backup round-trips the whole voyage archive into an empty browser', async () => {
  const { s, j } = await voyageWithArchive('backup-src', 3);
  // a memory that only the archive still holds (aged out of the snapshot's working set), and one that has been recalled
  await j.append([{ id: 1e9, type: 'memory_formed', record: { id: 99999, t: 5, event_type: 'awe', emotional_weight: 0.3, subject: 'an old view', summary: 'Old.', tags: ['awe'], callback_count: 0 } }]);
  await j.append([{ id: 1e9 + 1, type: 'memory_recalled', memoryId: 99999, callback_count: 4, t: 9 }]);
  const src = await j.exportArchive();
  assert.ok(src.systems.length > 0 && src.memories.length > 0 && src.events.some((e) => e.type === 'log_entry'), 'source voyage too thin to test');
  const text = buildBackup(s, src);
  assert.equal(JSON.parse(text).version, BACKUP_VERSION);
  const storage = new MemoryStorage();
  const dest = new MemoryJournal();
  const r = await importVoyage({ text, data, snapshots: new SnapshotStore(storage, data), journal: dest });
  assert.equal(r.partial, false);
  await sameArchive(j, dest);
  const m = (await dest.exportArchive()).memories.find((x) => x.id === 99999);
  assert.equal(m.callback_count, 4);
  assert.equal(new SnapshotStore(storage, data).load().t, s.t);
});

test('importing over a different voyage replaces it completely (no leftover records)', async () => {
  const a = await voyageWithArchive('voyage-a', 2);
  const b = await voyageWithArchive('voyage-b', 2);
  const storage = new MemoryStorage();
  const store = new SnapshotStore(storage, data);
  store.save(b.s);
  store.save(b.s); // fill the backup slot with voyage B too
  await importVoyage({ text: buildBackup(a.s, await a.j.exportArchive()), data, snapshots: store, journal: b.j });
  await sameArchive(a.j, b.j);
  assert.equal(store.load().seed, a.s.seed);
  storage.setItem(SNAPSHOT_KEY, '{"corrupt');
  assert.equal(store.load().seed, a.s.seed, 'the fallback slot must not resurrect the old voyage');
});

test('a failed import leaves the current voyage usable', async () => {
  const a = await voyageWithArchive('fail-a', 1);
  const b = await voyageWithArchive('fail-b', 1);
  const text = buildBackup(a.s, await a.j.exportArchive());
  const before = JSON.stringify(await b.j.exportArchive());
  // 1. the journal transaction fails: nothing changes
  const storage1 = new MemoryStorage();
  const store1 = new SnapshotStore(storage1, data);
  store1.save(b.s);
  const broken = Object.assign(Object.create(Object.getPrototypeOf(b.j)), b.j, { importArchive: async () => { throw new Error('quota'); } });
  await assert.rejects(importVoyage({ text, data, snapshots: store1, journal: broken }), /quota/);
  assert.equal(store1.load().seed, b.s.seed);
  assert.equal(JSON.stringify(await b.j.exportArchive()), before);
  // 2. the snapshot write fails after the journal swapped: the journal is rolled back
  const storage2 = new MemoryStorage();
  const store2 = new SnapshotStore(storage2, data);
  store2.save(b.s);
  store2.replace = () => { throw new Error('storage full'); };
  await assert.rejects(importVoyage({ text, data, snapshots: store2, journal: b.j }), /storage full/);
  assert.equal(JSON.stringify(await b.j.exportArchive()), before, 'journal not rolled back');
  assert.equal(store2.load().seed, b.s.seed);
  // 3. a malformed file touches nothing
  await assert.rejects(importVoyage({ text: '{"format":"deep-space-terrarium/backup","version":2,"snapshot":"x"}', data, snapshots: store2, journal: b.j }));
  assert.equal(JSON.stringify(await b.j.exportArchive()), before);
});

test('older (v1) backups still import, rebuilding what they can and saying so', async () => {
  const { s, j } = await voyageWithArchive('legacy', 2);
  const events = (await j.exportArchive()).events;
  const v1 = JSON.stringify({ format: 'deep-space-terrarium/backup', exportedAtMs: 1, snapshot: serialize(s), events });
  const dest = new MemoryJournal();
  const r = await importVoyage({ text: v1, data, snapshots: new SnapshotStore(new MemoryStorage(), data), journal: dest });
  assert.equal(r.partial, true);
  const got = await dest.exportArchive();
  assert.equal(got.events.length, events.length);
  assert.ok(got.systems.length > 0 && got.systems.every((x) => x.partial), 'systems not rebuilt from arrivals');
  assert.equal(got.memories.length, s.memory.records.length, 'working-set memories not carried over');
});
