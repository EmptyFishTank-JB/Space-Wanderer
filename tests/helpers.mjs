import { loadData } from '../tools/node-data.mjs';
import { createInitialState, step, drain } from '../src/sim/index.js';

export const data = loadData();
export const HOUR = 3600;
export const DAY = 86400;

export function fresh(seed = 'test') {
  return createInitialState(data, { seed });
}

/** Run n ticks, collecting drained events (optionally filtered). */
export function runCollect(state, n, types = null) {
  const out = [];
  for (let i = 0; i < n; i++) {
    step(state, data);
    if (state.outbox.length) for (const e of drain(state)) if (!types || types.includes(e.type)) out.push(e);
  }
  return out;
}

export const clone = (s) => JSON.parse(JSON.stringify(s));

/** Throws if any number in the state is NaN or ±Infinity. */
export function assertFinite(obj, path = 'state') {
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) throw new Error(`${path} is ${obj}`);
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) assertFinite(v, `${path}.${k}`);
  }
}
