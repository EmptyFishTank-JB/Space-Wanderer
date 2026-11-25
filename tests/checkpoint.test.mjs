import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, clone, DAY, HOUR } from './helpers.mjs';
import { bootSimulation, LiveRunner } from '../src/sim/index.js';
import { SnapshotStore, MemoryStorage, SNAPSHOT_KEY, serialize, deserialize } from '../src/persist/snapshot.js';
import { MemoryJournal } from '../src/persist/journal.js';

const T0 = 1_700_000_000_000;
const withCatchup = (o) => ({ ...data, config: { ...data.config, catchup: { ...data.config.catchup, ...o } } });

// State minus the boot's informational 'catchup' summaries (they describe the boot, not the voyage).
function voyage(s) {
  const c = clone(s);
  delete c.outbox;
  c.journal.recent = c.journal.recent.filter((e) => e.type !== 'catchup');
  return JSON.stringify(c);
}
async function archive(j) {
  const a = await j.exportArchive();
  a.events = a.events.filter((e) => e.type !== 'catchup');
  return JSON.stringify(a);
}

/** A saved voyage at T0, as storage text plus its journal. */
async function savedVoyage(seed) {
  const storage = new MemoryStorage();
  const journal = new MemoryJournal();
  await bootSimulation({ data, snapshots: new SnapshotStore(storage, data), journal, now: () => T0, seed });
  return { text: storage.getItem(SNAPSHOT_KEY), journal: await journal.exportArchive() };
}

async function restore(saved) {
  const storage = new MemoryStorage();
  storage.setItem(SNAPSHOT_KEY, saved.text);
  const journal = new MemoryJournal();
  await journal.importArchive(clone(saved.journal));
  return { storage, journal };
}

class Closed extends Error {}

/**
 * Reopen after `gapMs`. If `closeAtChunk` is set, the "tab closes" at that
 * yield: whatever was last checkpointed is all that survives; then it reopens
 * at the same moment and finishes.
 */
async function reopen(saved, d, gapMs, { closeAtChunk = null, checkpointEvery = 1 } = {}) {
  const { storage, journal } = await restore(saved);
  const now = () => T0 + gapMs;
  if (closeAtChunk !== null) {
    let chunks = 0;
    const yieldFn = async () => { if (++chunks === closeAtChunk) throw new Closed(); };
    await assert.rejects(bootSimulation({ data: d, snapshots: new SnapshotStore(storage, d), journal, now, checkpointEvery, yieldFn }), Closed);
  }
  const r = await bootSimulation({ data: d, snapshots: new SnapshotStore(storage, d), journal, now });
  return { state: r.state, journal, storage };
}

test('a catch-up interrupted at a yield point resumes the same history (multi-chunk gap)', async () => {
  const saved = await savedVoyage('ckpt-a');
  const d = withCatchup({ chunkTicks: 2000 });
  const gap = 5 * HOUR * 1000;
  const whole = await reopen(saved, d, gap);
  const cut = await reopen(saved, d, gap, { closeAtChunk: 3 });
  assert.equal(cut.state.t, whole.state.t, 'resumed run simulated a different number of ticks');
  assert.equal(cut.state.wallMs, whole.state.wallMs);
  assert.equal(voyage(cut.state), voyage(whole.state));
  assert.equal(await archive(cut.journal), await archive(whole.journal));
});

test('…and when the gap exceeds the cap (torpor booked once, not twice)', async () => {
  const saved = await savedVoyage('ckpt-b');
  const d = withCatchup({ chunkTicks: 20000, maxDays: 1 });
  const gap = 3.5 * DAY * 1000;
  const whole = await reopen(saved, d, gap);
  const cut = await reopen(saved, d, gap, { closeAtChunk: 2 });
  assert.equal(whole.state.calendar.torporSeconds, 2 * DAY);
  assert.equal(cut.state.calendar.torporSeconds, whole.state.calendar.torporSeconds);
  assert.equal(voyage(cut.state), voyage(whole.state));
  assert.equal(await archive(cut.journal), await archive(whole.journal));
});

test('the journal running ahead of the checkpoint is replayed idempotently', async () => {
  const saved = await savedVoyage('ckpt-c');
  const d = withCatchup({ chunkTicks: 1500 });
  const gap = 4 * HOUR * 1000;
  const whole = await reopen(saved, d, gap);
  // checkpoints every 3 chunks, closes at chunk 5: the journal holds two chunks the snapshot does not
  const cut = await reopen(saved, d, gap, { closeAtChunk: 5, checkpointEvery: 3 });
  assert.equal(voyage(cut.state), voyage(whole.state));
  assert.equal(await archive(cut.journal), await archive(whole.journal));
});

test('an autosave during the live runner\'s async catch-up is a consistent checkpoint', async () => {
  const s0 = fresh('runner-ckpt');
  s0.wallMs = T0;
  const d = withCatchup({ chunkTicks: 1000 });
  const now = () => T0 + 6000 * 1000;
  // uninterrupted
  const a = deserialize(serialize(s0), d);
  const ra = new LiveRunner({ state: a, data: d, now, inlineLimit: 100, yieldFn: () => Promise.resolve() });
  ra.pump();
  await ra.catchingUp;
  ra.pump();
  // autosave at the third yield, then the tab dies; reopen from that save
  const b = deserialize(serialize(s0), d);
  let saved = null;
  let n = 0;
  const rb = new LiveRunner({ state: b, data: d, now, inlineLimit: 100, yieldFn: async () => { if (++n === 3) { saved = serialize(b); throw new Closed(); } } });
  rb.pump();
  await assert.rejects(rb.catchingUp, Closed);
  const c = deserialize(saved, d);
  assert.ok(c.t > s0.t && c.t < a.t, 'checkpoint should be part-way');
  assert.equal(c.wallMs - T0, (c.t - s0.t) * 1000, 'checkpoint pairs sim time with its wall-clock moment');
  const rc = new LiveRunner({ state: c, data: d, now, inlineLimit: 100, yieldFn: () => Promise.resolve() });
  rc.pump();
  await rc.catchingUp;
  rc.pump();
  assert.equal(c.t, a.t, `resume double-counted: ${c.t} vs ${a.t}`);
  assert.equal(voyage(c), voyage(a));
});
