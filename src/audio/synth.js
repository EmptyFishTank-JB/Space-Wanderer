// Procedural sound sources. No samples: everything is noise, oscillators,
// filters and envelopes. One-shot recipes take (ctx, out, when, opts).

export function noiseBuffer(ctx, kind = 'white', seconds = 4) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * 0.5;
    else if (kind === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02; // brown
      d[i] = last * 3.5;
    }
  }
  // crossfade the loop seam
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[n - fade + i] = d[n - fade + i] * (1 - k) + d[i] * k;
  }
  return buf;
}

/** Synthetic room impulse response: decaying noise, darker for bigger spaces. */
export function impulse(ctx, seconds, damp = 0.5) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      lp = lp + (Math.random() * 2 - 1 - lp) * (1 - damp * t);
      d[i] = lp * Math.pow(1 - t, 3) * (i < ctx.sampleRate * 0.004 ? i / (ctx.sampleRate * 0.004) : 1);
    }
  }
  return buf;
}

export function loop(ctx, buffer) {
  const s = ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.loopStart = Math.random() * (buffer.duration - 0.5);
  s.start(0, s.loopStart);
  return s;
}

export function osc(ctx, type, freq) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start();
  return o;
}

export function filter(ctx, type, freq, Q = 0.7) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}

export function gain(ctx, v = 0) {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

/** Envelope a gain node: attack, hold, exponential-ish release. */
function env(g, when, peak, a, d) {
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(peak, when + a);
  g.gain.setTargetAtTime(0.0001, when + a, d / 4);
}

let shared = null;
function buffers(ctx) {
  if (!shared || shared.ctx !== ctx) shared = { ctx, white: noiseBuffer(ctx, 'white', 2), pink: noiseBuffer(ctx, 'pink', 2), brown: noiseBuffer(ctx, 'brown', 2) };
  return shared;
}

function burst(ctx, out, when, { kind = 'white', type = 'bandpass', freq = 1000, Q = 1, peak = 0.5, a = 0.002, d = 0.08, glideTo = null, rate = 1 }) {
  const s = ctx.createBufferSource();
  s.buffer = buffers(ctx)[kind];
  s.playbackRate.value = rate;
  const f = filter(ctx, type, freq, Q);
  if (glideTo) f.frequency.exponentialRampToValueAtTime(glideTo, when + a + d);
  const g = gain(ctx, 0);
  env(g, when, peak, a, d);
  s.connect(f).connect(g).connect(out);
  s.start(when, Math.random() * 1.5);
  s.stop(when + a + d * 2 + 0.05);
}

function tone(ctx, out, when, { type = 'sine', freq = 440, peak = 0.2, a = 0.005, d = 0.3, glideTo = null }) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, when + a + d);
  const g = gain(ctx, 0);
  env(g, when, peak, a, d);
  o.connect(g).connect(out);
  o.start(when);
  o.stop(when + a + d * 2 + 0.05);
}

// ───────────────────────── recipes ─────────────────────────
export const SFX = {
  footstep(ctx, out, when, { material = 'deck_plate', k = 1 } = {}) {
    const v = 0.7 + Math.random() * 0.3;
    switch (material) {
      case 'grating':
        burst(ctx, out, when, { freq: 2600, Q: 2, peak: 0.35 * k * v, d: 0.05 });
        tone(ctx, out, when, { freq: 820 + Math.random() * 120, peak: 0.05 * k, d: 0.12 });
        tone(ctx, out, when, { freq: 120, peak: 0.12 * k, d: 0.05 });
        break;
      case 'damp_deck':
        burst(ctx, out, when, { type: 'lowpass', freq: 1400, peak: 0.3 * k * v, d: 0.07 });
        burst(ctx, out, when + 0.01, { freq: 5000, Q: 1, peak: 0.06 * k, d: 0.04 });
        break;
      case 'padded': case 'carpet':
        burst(ctx, out, when, { kind: 'pink', type: 'lowpass', freq: 380, peak: 0.45 * k * v, d: 0.07 });
        break;
      case 'tile':
        burst(ctx, out, when, { freq: 3200, Q: 3, peak: 0.25 * k * v, d: 0.03 });
        tone(ctx, out, when, { freq: 140, peak: 0.08 * k, d: 0.04 });
        break;
      case 'regolith':
        for (let i = 0; i < 5; i++) burst(ctx, out, when + i * 0.012 + Math.random() * 0.01, { type: 'lowpass', freq: 900 + Math.random() * 500, peak: 0.12 * k * v, d: 0.03 });
        tone(ctx, out, when, { freq: 70, peak: 0.15 * k, d: 0.08 });
        break;
      default: // deck_plate
        burst(ctx, out, when, { freq: 1300, Q: 1.2, peak: 0.3 * k * v, d: 0.05 });
        tone(ctx, out, when, { freq: 110, peak: 0.14 * k, d: 0.06 });
    }
  },
  hatch(ctx, out, when, { k = 1 } = {}) {
    tone(ctx, out, when, { freq: 65, peak: 0.25 * k, d: 0.18 }); // latch clunk
    burst(ctx, out, when + 0.08, { type: 'highpass', freq: 1800, peak: 0.18 * k, a: 0.05, d: 0.55 }); // pneumatic hiss
    tone(ctx, out, when + 2.2, { freq: 58, peak: 0.22 * k, d: 0.2 }); // seal
    burst(ctx, out, when + 2.2, { type: 'lowpass', freq: 500, peak: 0.12 * k, d: 0.1 });
  },
  chime(ctx, out, when, { k = 1, low = false } = {}) {
    tone(ctx, out, when, { freq: low ? 660 : 880, peak: 0.16 * k, a: 0.01, d: 0.5 });
    tone(ctx, out, when + 0.28, { freq: low ? 523 : 660, peak: 0.16 * k, a: 0.01, d: 0.7 });
  },
  click(ctx, out, when, { k = 1, freq = 2400 } = {}) { burst(ctx, out, when, { freq, Q: 4, peak: 0.25 * k, d: 0.012 }); },
  chirp(ctx, out, when, { k = 1 } = {}) {
    const f = [1320, 1760, 1980, 2640][Math.floor(Math.random() * 4)];
    tone(ctx, out, when, { freq: f, peak: 0.08 * k, d: 0.06 });
    if (Math.random() < 0.4) tone(ctx, out, when + 0.09, { freq: f * 1.25, peak: 0.06 * k, d: 0.05 });
  },
  type(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { freq: 3600 + Math.random() * 900, Q: 5, peak: 0.12 * k, d: 0.01 }); },
  utensil(ctx, out, when, { k = 1 } = {}) {
    tone(ctx, out, when, { freq: 2900 + Math.random() * 600, peak: 0.05 * k, d: 0.08 });
    tone(ctx, out, when, { freq: 4700, peak: 0.03 * k, d: 0.05 });
  },
  clank(ctx, out, when, { k = 1 } = {}) {
    for (const [f, a] of [[430, 0.12], [1170, 0.08], [2210, 0.05], [3390, 0.03]]) tone(ctx, out, when, { freq: f * (0.97 + Math.random() * 0.06), peak: a * k, d: 0.35 });
    burst(ctx, out, when, { freq: 2000, Q: 1, peak: 0.12 * k, d: 0.02 });
  },
  splash(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { freq: 1100 + Math.random() * 600, Q: 0.8, peak: 0.12 * k, a: 0.05, d: 0.5 }); },
  sigh(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { kind: 'pink', freq: 520, Q: 1.4, glideTo: 300, peak: 0.12 * k, a: 0.25, d: 1.1 }); },
  creak(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { kind: 'pink', freq: 320 + Math.random() * 200, Q: 9, glideTo: 170, peak: 0.25 * k, a: 0.1, d: 0.9 }); },
  groan(ctx, out, when, { k = 1 } = {}) { tone(ctx, out, when, { type: 'sawtooth', freq: 55, glideTo: 38, peak: 0.08 * k, a: 0.3, d: 1.4 }); },
  pop(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { freq: 600 + Math.random() * 900, Q: 6, peak: 0.12 * k, d: 0.02 }); },
  crackle(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { freq: 1800 + Math.random() * 3000, Q: 0.7, peak: 0.25 * k * Math.random(), d: 0.008 + Math.random() * 0.02 }); },
  rattle(ctx, out, when, { k = 1 } = {}) { for (let i = 0; i < 8; i++) burst(ctx, out, when + i * 0.028, { freq: 1500 + Math.random() * 400, Q: 3, peak: 0.12 * k, d: 0.012 }); },
  thump(ctx, out, when, { k = 1 } = {}) {
    tone(ctx, out, when, { freq: 55, glideTo: 35, peak: 0.45 * k, d: 0.5 });
    burst(ctx, out, when, { kind: 'brown', type: 'lowpass', freq: 250, peak: 0.5 * k, d: 0.6 });
  },
  whoosh(ctx, out, when, { k = 1, d = 2.5 } = {}) {
    burst(ctx, out, when, { kind: 'pink', type: 'lowpass', freq: 200, glideTo: 4000, peak: 0.3 * k, a: d * 0.4, d: d * 0.6 });
    tone(ctx, out, when, { type: 'sawtooth', freq: 40, glideTo: 30, peak: 0.12 * k, a: 0.2, d });
  },
  depressurize(ctx, out, when, { k = 1, inward = false } = {}) {
    burst(ctx, out, when, { type: 'highpass', freq: inward ? 900 : 1600, glideTo: inward ? 2500 : 400, peak: 0.22 * k, a: 0.3, d: 3 });
  },
  rowStroke(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { kind: 'pink', freq: 600, Q: 1, glideTo: 1500, peak: 0.1 * k, a: 0.25, d: 0.6 }); },
  podHiss(ctx, out, when, { k = 1 } = {}) { burst(ctx, out, when, { type: 'highpass', freq: 3000, glideTo: 900, peak: 0.15 * k, a: 0.4, d: 4 }); },
};
