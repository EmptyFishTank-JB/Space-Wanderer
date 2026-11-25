export const HOUR = 3600;
export const DAY = 86400;

export const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Linear 0..1 response between lo and hi. */
export const ramp = (x, lo, hi) => clamp((x - lo) / (hi - lo));
/** Smoothstep response between lo and hi (utility curve). */
export const smooth = (x, lo, hi) => {
  const t = ramp(x, lo, hi);
  return t * t * (3 - 2 * t);
};
/** Convert a per-hour rate to the amount for dt seconds. */
export const ph = (ratePerHour, dt) => (ratePerHour * dt) / HOUR;
/** Convert a per-day rate to the amount for dt seconds. */
export const pd = (ratePerDay, dt) => (ratePerDay * dt) / DAY;
/** Move x toward target by at most `step`. */
export const approach = (x, target, step) =>
  x < target ? Math.min(target, x + step) : Math.max(target, x - step);
/** True if hour h lies in [a, b) on a 24h clock (wrapping allowed). */
export const inWindow = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
/** Hours from a to b going forward on a 24h clock. */
export const hoursAfter = (h, a) => ((h - a) % 24 + 24) % 24;
export const round = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
