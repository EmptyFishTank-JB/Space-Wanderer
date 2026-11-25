// Deterministic offline catch-up. When the tab reopens after hours or days,
// the exact same fixed-step loop runs headlessly across the elapsed time, so
// a traveler left alone for a week lived exactly the week they would have
// lived on screen.
//
// Absences longer than config.catchup.maxDays are not simulated tick by
// tick: the excess is booked as a torpor stretch on the mission calendar
// (the in-world longevity model). It is booked FIRST and in whole days, so
// the ship's clock keeps its rhythm and the most recent stretch, the one the
// viewer returns to, is the part that is lived tick by tick.
//
// Checkpoint consistency: with `advanceWall`, `state.wallMs` moves forward
// together with every simulated chunk (and with the torpor booking). A
// snapshot taken at any yield point therefore pairs simulated time with the
// wall-clock moment it corresponds to, and resuming from it continues the
// same history instead of replaying the gap a second time.
import { step } from './engine.js';
import { drain, emit } from './events.js';
import { DAY } from './util.js';

export function planCatchup(data, elapsedSeconds) {
  const max = data.config.catchup.maxDays * DAY;
  const e = Math.max(0, Math.floor(elapsedSeconds));
  const torpor = e > max ? Math.floor((e - max) / DAY) * DAY : 0;
  return { simulate: e - torpor, torpor };
}

function bookTorpor(state, seconds, advanceWall) {
  if (seconds <= 0) return;
  state.calendar.torporSeconds += seconds;
  if (advanceWall && state.wallMs != null) state.wallMs += seconds * 1000;
  emit(state, 'catchup', { mode: 'torpor', seconds });
}

function runChunk(state, data, n, advanceWall) {
  for (let i = 0; i < n; i++) step(state, data);
  if (advanceWall && state.wallMs != null) state.wallMs += n * 1000;
}

/** Synchronous catch-up (tests, Node tools). Returns the plan. */
export function catchUpSync(state, data, elapsedSeconds, { onEvents, advanceWall = false } = {}) {
  const plan = planCatchup(data, elapsedSeconds);
  const chunk = data.config.catchup.chunkTicks;
  bookTorpor(state, plan.torpor, advanceWall);
  if (onEvents) onEvents(drain(state));
  for (let done = 0; done < plan.simulate;) {
    const n = Math.min(chunk, plan.simulate - done);
    runChunk(state, data, n, advanceWall);
    done += n;
    const evs = drain(state);
    if (onEvents) onEvents(evs);
  }
  return plan;
}

const defaultYield = () => new Promise((r) => setTimeout(r, 0));

/**
 * Chunked async catch-up that yields between chunks so the page stays
 * responsive. Each chunk's events are delivered (and awaited) before the
 * checkpoint hook runs and before yielding, so the journal is never behind a
 * saved checkpoint. If it is ahead (the page closed after a journal write but
 * before the next save), resuming regenerates the same events with the same
 * ids, and the journal stores them idempotently.
 */
export async function catchUp(state, data, elapsedSeconds, { onEvents, onProgress, onCheckpoint, yieldFn = defaultYield, advanceWall = false } = {}) {
  const plan = planCatchup(data, elapsedSeconds);
  const chunk = data.config.catchup.chunkTicks;
  bookTorpor(state, plan.torpor, advanceWall);
  if (onEvents) await onEvents(drain(state));
  let done = 0;
  let chunks = 0;
  while (done < plan.simulate) {
    const n = Math.min(chunk, plan.simulate - done);
    runChunk(state, data, n, advanceWall);
    done += n;
    chunks++;
    const evs = drain(state);
    if (onEvents) await onEvents(evs);
    if (onCheckpoint) await onCheckpoint(state, chunks);
    if (onProgress) onProgress(done / plan.simulate);
    await yieldFn();
  }
  if (onProgress) onProgress(1);
  return plan;
}
