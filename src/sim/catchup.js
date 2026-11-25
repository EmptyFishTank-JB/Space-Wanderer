// Deterministic offline catch-up. When the tab reopens after hours or days,
// the exact same fixed-step loop runs headlessly across the elapsed time, so
// a traveler left alone for a week lived exactly the week they would have
// lived on screen.
//
// Absences longer than config.catchup.maxDays are not simulated tick by
// tick: the excess is booked as a torpor stretch on the mission calendar
// (the in-world longevity model; Phase 2 makes torpor a real traveler
// behaviour). This keeps a tab reopened after a year from stalling.
import { step } from './engine.js';
import { drain, emit } from './events.js';
import { DAY } from './util.js';

export function planCatchup(data, elapsedSeconds) {
  const max = data.config.catchup.maxDays * DAY;
  const e = Math.max(0, Math.floor(elapsedSeconds));
  return { simulate: Math.min(e, max), torpor: Math.max(0, e - max) };
}

function bookTorpor(state, seconds) {
  if (seconds <= 0) return;
  state.calendar.torporSeconds += seconds;
  emit(state, 'catchup', { mode: 'torpor', seconds });
}

/** Synchronous catch-up (tests, Node tools). Returns ticks simulated. */
export function catchUpSync(state, data, elapsedSeconds, { onEvents } = {}) {
  const plan = planCatchup(data, elapsedSeconds);
  const chunk = data.config.catchup.chunkTicks;
  for (let done = 0; done < plan.simulate;) {
    const n = Math.min(chunk, plan.simulate - done);
    for (let i = 0; i < n; i++) step(state, data);
    done += n;
    const evs = drain(state);
    if (onEvents) onEvents(evs);
  }
  bookTorpor(state, plan.torpor);
  if (onEvents) onEvents(drain(state));
  return plan;
}

const defaultYield = () => new Promise((r) => setTimeout(r, 0));

/**
 * Chunked async catch-up that yields between chunks so the page stays
 * responsive. onProgress(fraction) lets a renderer show a quiet fade-in.
 */
export async function catchUp(state, data, elapsedSeconds, { onEvents, onProgress, yieldFn = defaultYield } = {}) {
  const plan = planCatchup(data, elapsedSeconds);
  const chunk = data.config.catchup.chunkTicks;
  let done = 0;
  while (done < plan.simulate) {
    const n = Math.min(chunk, plan.simulate - done);
    for (let i = 0; i < n; i++) step(state, data);
    done += n;
    const evs = drain(state);
    if (onEvents) await onEvents(evs);
    if (onProgress) onProgress(done / plan.simulate);
    await yieldFn();
  }
  bookTorpor(state, plan.torpor);
  if (onEvents) await onEvents(drain(state));
  if (onProgress) onProgress(1);
  return plan;
}
