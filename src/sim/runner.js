// Live 1:1 real-time runner. Keeps the sim locked to the wall clock:
// `state.wallMs` is the wall time that corresponds to `state.t`. Each pump
// advances however many whole seconds have elapsed. Small gaps (normal
// frames, throttled background tabs) are stepped inline; large gaps (laptop
// sleep, a long-hidden tab) go through the chunked catch-up path. No DOM:
// the clock and scheduler are injected so Node can drive it too.
import { step } from './engine.js';
import { drain } from './events.js';
import { catchUp } from './catchup.js';

export class LiveRunner {
  constructor({ state, data, now = () => Date.now(), onEvents = null, inlineLimit = 900, intervalMs = 250, yieldFn }) {
    this.state = state;
    this.data = data;
    this.now = now;
    this.onEvents = onEvents;
    this.inlineLimit = inlineLimit;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.catchingUp = null;
    this.yieldFn = yieldFn;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.pump(), this.intervalMs);
    this.pump();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Advance the sim to the current wall time. Returns ticks run inline. */
  pump() {
    if (this.catchingUp) return 0;
    const s = this.state;
    const now = this.now();
    const due = Math.floor((now - s.wallMs) / 1000);
    if (due < 0) {
      // Wall clock moved backwards (manual change / NTP). Never rewind the sim.
      if (due < -5) s.wallMs = now;
      return 0;
    }
    if (due > this.inlineLimit) {
      // wallMs advances with each simulated chunk, so an autosave mid-catch-up is a consistent checkpoint
      const opts = { onEvents: this.onEvents, advanceWall: true };
      if (this.yieldFn) opts.yieldFn = this.yieldFn;
      this.catchingUp = catchUp(s, this.data, due, opts).finally(() => { this.catchingUp = null; });
      return 0;
    }
    for (let i = 0; i < due; i++) step(s, this.data);
    s.wallMs += due * 1000;
    const evs = drain(s);
    if (evs.length && this.onEvents) this.onEvents(evs);
    return due;
  }

  /** Fraction of the current second elapsed — for render interpolation (Phase 3). */
  alpha() {
    return Math.min(1, Math.max(0, (this.now() - this.state.wallMs) / 1000));
  }
}
