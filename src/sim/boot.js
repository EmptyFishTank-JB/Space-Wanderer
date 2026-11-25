// Boot sequence shared by the browser and Node: restore (or create) the
// traveler, catch up on the time nobody was watching, persist, and hand back
// a state ready for the live runner. Storage backends are injected.
import { createInitialState } from './state.js';
import { catchUp } from './catchup.js';
import { emit, drain } from './events.js';

export async function bootSimulation({ data, snapshots, journal, now = () => Date.now(), seed, onProgress }) {
  let state = snapshots.load();
  if (!state) {
    state = createInitialState(data, { seed: seed ?? `traveler-${now()}` });
    state.wallMs = now();
    emit(state, 'catchup', { mode: 'genesis', seconds: 0 });
    await journal.append(drain(state));
    snapshots.save(state);
    return { state, fresh: true, plan: { simulate: 0, torpor: 0 } };
  }
  const elapsed = Math.max(0, (now() - state.wallMs) / 1000);
  const plan = await catchUp(state, data, elapsed, { onEvents: (evs) => journal.append(evs), onProgress });
  state.wallMs += (plan.simulate + plan.torpor) * 1000;
  if (plan.simulate > 0) {
    emit(state, 'catchup', { mode: 'simulated', seconds: plan.simulate });
    await journal.append(drain(state));
  }
  snapshots.save(state);
  return { state, fresh: false, plan };
}
