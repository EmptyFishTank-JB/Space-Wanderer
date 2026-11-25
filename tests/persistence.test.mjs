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
