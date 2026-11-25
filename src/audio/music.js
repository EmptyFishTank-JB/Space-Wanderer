// Diegetic music: when the traveler puts on a recording, the in-room speaker
// plays a quiet generative piece (seeded by the track number, so the same
// track always sounds the same). It is scheduled a second ahead on the audio
// clock and routed through a small-speaker filter before the room acoustics.

const SCALES = { minorPent: [0, 3, 5, 7, 10], majorPent: [0, 2, 4, 7, 9], dorian: [0, 2, 3, 5, 7, 9, 10] };

function seeded(n) {
  let s = (n * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export class Speaker {
  constructor(ctx, out) {
    this.ctx = ctx;
    // a modest cabin speaker: no deep bass, soft top, a little saturation
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = 140;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 5200;
    this.shape = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 255) * 2 - 1; curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6); }
    this.shape.curve = curve;
    this.bus = ctx.createGain(); this.bus.gain.value = 0.6;
    this.bus.connect(this.hp).connect(this.lp).connect(this.shape).connect(out);
    this.track = null;
    this.timer = null;
  }

  play(track) {
    if (this.track === track) return;
    this.stop();
    this.track = track;
    const r = seeded(track + 7);
    const keys = [196, 207.65, 220, 233.08, 246.94, 261.63];
    this.root = keys[Math.floor(r() * keys.length)];
    this.scale = Object.values(SCALES)[Math.floor(r() * 3)];
    this.beat = 60 / (56 + Math.floor(r() * 24));
    this.rand = r;
    this.next = this.ctx.currentTime + 0.3;
    this.step = 0;
    this.deg = 0;
    this.timer = setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.track = null;
    this.practising = false;
  }

  /**
   * The traveler practising: one short phrase, repeated, with hesitations and
   * wrong notes that fade as their skill grows. Plucked, close, unamplified.
   */
  practice(skill) {
    if (this.practising) { this.skill = skill; return; }
    this.stop();
    this.practising = true;
    this.track = 'practice';
    this.skill = skill;
    this.root = 220;
    this.scale = SCALES.majorPent;
    this.beat = 60 / 66;
    this.phrase = [0, 2, 4, 3, 2, 0, 1, 2, 4, 5, 4, 2];
    this.pos = 0;
    this.next = this.ctx.currentTime + 0.4;
    this.timer = setInterval(() => this.schedulePractice(), 250);
  }

  schedulePractice() {
    const c = this.ctx;
    while (this.next < c.currentTime + 1.2) {
      const t = this.next;
      const sk = this.skill;
      let deg = this.phrase[this.pos % this.phrase.length];
      if (Math.random() < 0.3 * (1 - sk)) deg += Math.random() < 0.5 ? 1 : -1; // a wrong note
      const vel = 0.07 + 0.04 * Math.random();
      this.voice(t + (Math.random() - 0.5) * 0.12 * (1 - sk), this.note(deg, 1), { type: 'triangle', peak: vel, a: 0.003, d: this.beat * 1.3 });
      this.voice(t, this.note(deg, 2), { type: 'sine', peak: vel * 0.2, a: 0.003, d: this.beat * 0.5 });
      this.pos++;
      // hesitation, and starting the phrase over after a slip
      let gap = this.beat * (1 + (Math.random() < 0.25 * (1 - sk) ? 1.5 : 0));
      if (this.pos % this.phrase.length === 0) gap += this.beat * 2;
      if (Math.random() < 0.08 * (1 - sk)) { this.pos = 0; gap += this.beat * 1.5; }
      this.next += gap;
    }
  }

  note(deg, oct) {
    const n = this.scale.length;
    const o = Math.floor(deg / n);
    const st = this.scale[((deg % n) + n) % n] + 12 * (o + oct);
    return this.root * Math.pow(2, st / 12);
  }

  voice(when, freq, { type = 'sine', peak = 0.1, a = 0.01, d = 1, detune = 0 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + a);
    g.gain.setTargetAtTime(0.0001, when + a, d / 3);
    o.connect(g).connect(this.bus);
    o.start(when);
    o.stop(when + a + d * 2);
  }

  schedule() {
    const c = this.ctx;
    const r = this.rand;
    while (this.next < c.currentTime + 1.2) {
      const t = this.next;
      if (this.step % 16 === 0) {
        // a slow pad chord
        const base = Math.floor(r() * 5);
        for (const [i, dt] of [[0, -6], [2, 5], [4, -3]]) this.voice(t, this.note(base + i, 0), { type: 'triangle', peak: 0.035, a: 1.6, d: this.beat * 14, detune: dt });
        this.voice(t, this.note(base, -1), { type: 'sine', peak: 0.06, a: 0.4, d: this.beat * 10 });
      }
      // a sparse plucked line wandering the scale
      if (r() < 0.55) {
        this.deg = Math.max(-2, Math.min(9, this.deg + Math.floor(r() * 5) - 2));
        this.voice(t, this.note(this.deg, 1), { type: 'sine', peak: 0.07 + r() * 0.03, a: 0.004, d: this.beat * 1.6 });
        this.voice(t, this.note(this.deg, 2), { type: 'sine', peak: 0.012, a: 0.004, d: this.beat * 0.6 });
      }
      this.next += this.beat / 2;
      this.step++;
    }
  }
}
