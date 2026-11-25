// Choosing a memory to come back to — for a log callback or a quiet moment
// of reflection. Heavier memories surface more; recent repetition, and
// memories already brought up many times, are less likely; anything echoing
// today (same kind of world, same kind of event) is more likely.

export function recallCandidates(state, { tags = [], minAgeDays = 3, minWeight = 0, now = state.t } = {}) {
  const mem = state.memory;
  if (!mem || !mem.records.length) return [];
  const out = [];
  for (const r of mem.records) {
    const ageD = (now - r.t) / 86400;
    if (ageD < minAgeDays || r.emotional_weight < minWeight) continue;
    const sinceRecall = r.last_recalled_t === null ? Infinity : (now - r.last_recalled_t) / 86400;
    if (sinceRecall < 5) continue;
    const echo = r.tags.some((t) => tags.includes(t)) ? 2.2 : 1;
    const w = r.emotional_weight * echo * (1 / (1 + 0.35 * r.callback_count)) * (0.6 + 0.4 / (1 + ageD / 400));
    out.push({ r, w });
  }
  return out;
}

/** Weighted pick with a supplied uniform random number (deterministic callers pass their own). */
export function pickMemory(state, u, opts) {
  const c = recallCandidates(state, opts);
  if (!c.length) return null;
  const total = c.reduce((s, x) => s + x.w, 0);
  let x = u * total;
  for (const k of c) { x -= k.w; if (x <= 0) return k.r; }
  return c[c.length - 1].r;
}

export function markRecalled(state, rec) {
  rec.callback_count += 1;
  rec.last_recalled_t = state.t;
}
