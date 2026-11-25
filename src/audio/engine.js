// Web Audio engine. Builds a graph of continuous procedural layers and
// one-shot buses, then each frame applies the pure mix (mix.js) for whatever
// camera the viewer is watching. Reads the sim; never writes it.
import { computeMix, roomHops, listenerFor } from './mix.js';
import { noiseBuffer, impulse, loop, osc, filter, gain, SFX } from './synth.js';
import { Speaker } from './music.js';
import { travelerPose } from '../render/actor.js';
import { evaActive } from '../render/eva.js';

const TC = 0.12; // parameter smoothing time constant (s)
const TYPING = new Set(['write_log', 'check_scans', 'nav_review', 'survey_system', 'scan_body', 'plot_route', 'inspect_engineering', 'inspect_lifesupport']);
const WATERY = new Set(['wash', 'drink_water', 'wash_dishes', 'tend_trays', 'tend_algae']);

export class AudioEngine {
  constructor({ data, cameras }) {
    this.data = data;
    this.cameras = cameras;
    this.hops = roomHops(data);
    this.ctx = null;
    this.muted = false;
    this.events = [];
    this.lastStep = null;
    this.lastEvaStep = null;
    this.yawning = false;
    this.lastMix = null;
  }

  get enabled() { return !!this.ctx && this.ctx.state === 'running'; }

  /** Must be called from a user gesture (browser autoplay rules). */
  async enable() {
    if (!this.ctx) this.build();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    return this.enabled;
  }

  setMuted(m) { this.muted = !!m; }

  push(events) { for (const e of events) this.events.push(e); if (this.events.length > 300) this.events.splice(0, this.events.length - 300); }

  build() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.N = { white: noiseBuffer(ctx, 'white'), pink: noiseBuffer(ctx, 'pink'), brown: noiseBuffer(ctx, 'brown') };
    this.master = gain(ctx, 0);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(comp).connect(this.analyser).connect(ctx.destination);
    this.dry = gain(ctx, 1);
    this.dry.connect(this.master);
    this.verb = ctx.createConvolver();
    this.verbSize = 0.5;
    this.verb.buffer = impulse(ctx, 0.5 * 2, 0.6);
    this.wet = gain(ctx, 0.1);
    this.send = gain(ctx, 1);
    this.send.connect(this.verb).connect(this.wet).connect(this.master);
    this.L = {};
    this.buildLayers();
    this.speaker = new Speaker(ctx, this.L.music.amp);
  }

  /** A layer: sources → amp → presence low-pass → dry (+ reverb send). Shots enter at `shot`. */
  layer(name, sendAmt = 1) {
    const c = this.ctx;
    const amp = gain(c, 0);
    const shot = gain(c, 0);
    const lp = filter(c, 'lowpass', 16000, 0.5);
    amp.connect(lp);
    shot.connect(lp);
    lp.connect(this.dry);
    if (sendAmt > 0) { const s = gain(c, sendAmt); lp.connect(s).connect(this.send); }
    const L = { amp, shot, lp, p: {} };
    this.L[name] = L;
    return L;
  }

  buildLayers() {
    const c = this.ctx;
    const N = this.N;
    const src = (buf, ...chain) => { let n = loop(c, buf); for (const f of chain) n = n.connect(f); return n; };
    let L;
    // ── vessel bed ──
    L = this.layer('reactor', 0.4);
    L.p.o1 = osc(c, 'sine', 38); L.p.o2 = osc(c, 'sine', 76);
    { const g1 = gain(c, 0.7), g2 = gain(c, 0.22); L.p.o1.connect(g1).connect(L.amp); L.p.o2.connect(g2).connect(L.amp); }
    src(N.brown, filter(c, 'lowpass', 90), gain(c, 0.9)).connect(L.amp);
    L = this.layer('vent'); src(N.pink, filter(c, 'bandpass', 650, 0.5)).connect(L.amp);
    L = this.layer('hum');
    for (const [f, a] of [[60, 0.6], [120, 0.3], [180, 0.12]]) osc(c, 'sine', f).connect(gain(c, a)).connect(L.amp);
    // ── room systems ──
    L = this.layer('water'); src(N.brown, filter(c, 'bandpass', 420, 0.9)).connect(L.amp);
    L = this.layer('mist'); src(N.white, filter(c, 'highpass', 4500)).connect(L.amp);
    L = this.layer('lamps'); osc(c, 'sawtooth', 120).connect(filter(c, 'lowpass', 500)).connect(L.amp);
    L = this.layer('sweep'); L.p.o = osc(c, 'sine', 1000); L.p.o.connect(L.amp);
    L = this.layer('heater'); src(N.pink, filter(c, 'lowpass', 260)).connect(L.amp); osc(c, 'sine', 50).connect(gain(c, 0.4)).connect(L.amp);
    L = this.layer('kettle'); src(N.white, filter(c, 'bandpass', 5200, 2)).connect(L.amp);
    L = this.layer('fabricator'); L.p.f = filter(c, 'bandpass', 900, 1);
    osc(c, 'sawtooth', 165).connect(L.p.f); osc(c, 'sawtooth', 247).connect(L.p.f); L.p.f.connect(gain(c, 0.4)).connect(L.amp);
    L = this.layer('pumps'); src(N.brown, filter(c, 'bandpass', 190, 1.5)).connect(L.amp);
    L = this.layer('ventHiss'); src(N.white, filter(c, 'highpass', 1800)).connect(L.amp);
    L = this.layer('buzz'); osc(c, 'sawtooth', 120).connect(filter(c, 'bandpass', 2400, 2)).connect(L.amp);
    // ── propulsion ──
    L = this.layer('cruise', 0.25); L.p.f = filter(c, 'lowpass', 900, 1.2);
    L.p.o = [osc(c, 'sawtooth', 50), osc(c, 'sawtooth', 75), osc(c, 'sawtooth', 100.5)];
    for (const [i, o] of L.p.o.entries()) o.connect(gain(c, [0.5, 0.25, 0.15][i])).connect(L.p.f);
    L.p.f.connect(L.amp);
    L = this.layer('charge', 0.3); L.p.o = osc(c, 'sawtooth', 80); L.p.f = filter(c, 'bandpass', 240, 4);
    L.p.o.connect(L.p.f).connect(L.amp); src(N.white, filter(c, 'bandpass', 3000, 2), gain(c, 0.3)).connect(L.amp);
    L = this.layer('hyper', 0.3); L.p.f = filter(c, 'bandpass', 800, 0.8);
    src(N.brown, filter(c, 'lowpass', 900)).connect(L.amp); src(N.white, L.p.f, gain(c, 0.5)).connect(L.amp);
    L = this.layer('plasma', 0.3); src(N.pink, filter(c, 'lowpass', 700)).connect(L.amp); src(N.brown, filter(c, 'lowpass', 120)).connect(L.amp);
    L = this.layer('entry', 0.2); L.p.f = filter(c, 'bandpass', 1200, 0.6); src(N.white, L.p.f).connect(L.amp);
    L = this.layer('rumble', 0.1); src(N.brown, filter(c, 'lowpass', 90), gain(c, 1.4)).connect(L.amp);
    // ── EVA suit interior ──
    L = this.layer('breath', 0.05); src(N.pink, filter(c, 'bandpass', 1000, 0.7)).connect(L.amp);
    L = this.layer('comms', 0); src(N.white, filter(c, 'bandpass', 2600, 3)).connect(L.amp);
    L = this.layer('evaWind', 0); src(N.pink, filter(c, 'lowpass', 380)).connect(L.amp);
    L = this.layer('suitHum', 0); osc(c, 'sine', 92).connect(L.amp); osc(c, 'sine', 184).connect(gain(c, 0.3)).connect(L.amp);
    L = this.layer('static', 0); src(N.white).connect(L.amp);
    // ── music (speaker feeds amp directly) ──
    this.layer('music', 0.8);
    // ── shot-only buses ──
    for (const n of ['foley', 'suit', 'pa', 'drive', 'chirps', 'pumpRattle', 'lsRattle', 'arc', 'hullGroan', 'crackle', 'bubbles', 'creak', 'airlock']) this.layer(n, n === 'suit' || n === 'pa' ? 0.1 : 0.8);
  }

  set(param, v, now) { param.setTargetAtTime(v, now, TC); }

  /** Per-frame update from the renderer. */
  update(fr) {
    if (!this.ctx) return;
    const c = this.ctx;
    const now = c.currentTime;
    const { state, data } = fr;
    const eva = evaActive(state);
    const listener = listenerFor(fr.feedDef, eva);
    const a = state.traveler.activity;
    const performing = a && a.phase === 'perform' && !state.traveler.move;
    const musicOn = performing && a.id === 'listen_music';
    if (musicOn && !this.speaker.track) this.speaker.play(this.musicTrack ?? 0);
    if (!musicOn && this.speaker.track !== null) this.speaker.stop();
    const plan = eva ? a.params.plan : null;
    const sys = fr.view && fr.view.sys;
    const mix = computeMix(state, data, this.hops, listener, {
      muted: this.muted, view: fr.view, exertion: state.traveler.exertion, fatigue: state.traveler.needs.fatigue,
      music: { playing: musicOn, room: this.musicRoom || state.traveler.pos.room },
      evaBody: plan && sys ? sys.byId[plan.body] : null,
    });
    this.lastMix = mix;
    this.set(this.master.gain, mix.master, now);
    this.set(this.wet.gain, mix.reverb.wet, now);
    if (Math.abs(mix.reverb.size - this.verbSize) > 0.2) { this.verbSize = mix.reverb.size; this.verb.buffer = impulse(c, 0.3 + mix.reverb.size * 1.8, 0.6); }

    const L = this.L;
    const M = mix.layers;
    const t = fr.t;
    const apply = (name, g, lp) => { this.set(L[name].amp.gain, Math.max(0, g), now); if (lp) this.set(L[name].lp.frequency, lp, now); };
    apply('reactor', M.reactor.gain, M.reactor.lp);
    this.set(L.reactor.p.o1.frequency, M.reactor.freq, now); this.set(L.reactor.p.o2.frequency, M.reactor.freq * 2.003, now);
    apply('vent', M.vent.gain, M.vent.lp);
    apply('hum', M.hum.gain, M.hum.lp);
    apply('water', M.water.gain * (0.8 + 0.2 * Math.sin(t * 0.7)), M.water.lp);
    apply('mist', (t % 9) < 2.5 ? M.mist.gain : 0, M.mist.lp);
    apply('lamps', M.lamps.gain, M.lamps.lp);
    const sweepPh = (t * 0.25) % 1;
    apply('sweep', M.sweep.gain * (sweepPh < 0.3 ? Math.sin((sweepPh / 0.3) * Math.PI) : 0), M.sweep.lp);
    this.set(L.sweep.p.o.frequency, 700 + 900 * sweepPh, now);
    apply('heater', M.heater.gain, M.heater.lp);
    apply('kettle', M.kettle.gain, M.kettle.lp);
    apply('fabricator', M.fabricator.gain, M.fabricator.lp);
    this.set(L.fabricator.p.f.frequency, 700 + 400 * Math.sin(t * 1.3), now);
    apply('pumps', M.pumps.gain * (0.35 + 0.65 * Math.max(0, Math.sin(2 * Math.PI * t * M.pumps.cycle)) ** 2), M.pumps.lp);
    apply('ventHiss', M.ventHiss.gain, M.ventHiss.lp);
    apply('buzz', M.buzz.gain * (Math.random() < 0.8 ? 1 : 0.1), M.buzz.lp);
    apply('cruise', M.cruise.gain, M.cruise.lp);
    const pitch = M.cruise.pitch * (0.85 + 0.15 * M.cruise.drag); // gravitational drag pulls the pitch down
    L.cruise.p.o.forEach((o, i) => this.set(o.frequency, pitch * [1, 1.5, 2.01][i], now));
    this.set(L.cruise.p.f.frequency, 300 + 1500 * M.cruise.drag, now);
    apply('charge', M.charge.gain, M.charge.lp);
    this.set(L.charge.p.o.frequency, M.charge.pitch, now); this.set(L.charge.p.f.frequency, M.charge.pitch * 3, now);
    apply('hyper', M.hyper.gain, M.hyper.lp);
    this.set(L.hyper.p.f.frequency, 500 + 2500 * (0.5 + 0.5 * Math.sin(t * 0.9)), now);
    apply('plasma', M.plasma.gain, M.plasma.lp);
    apply('entry', M.entry.gain, M.entry.lp);
    this.set(L.entry.p.f.frequency, M.entry.cutoff, now);
    apply('rumble', M.rumble.gain, M.rumble.lp);
    // suit breathing: inhale, pause, exhale
    const bp = (t * M.breath.rate) % 1;
    const breath = bp < 0.35 ? Math.sin((bp / 0.35) * Math.PI) * 0.8 : bp > 0.45 && bp < 0.9 ? Math.sin(((bp - 0.45) / 0.45) * Math.PI) : 0;
    apply('breath', M.breath.gain * breath);
    apply('comms', M.comms.gain * (Math.random() < 0.92 ? 1 : 3));
    apply('evaWind', M.evaWind.gain * (0.7 + 0.3 * Math.sin(t * 0.4) * Math.sin(t * 0.13)), M.evaWind.lp);
    apply('suitHum', M.suitHum.gain);
    apply('static', M.static.gain);
    apply('music', M.music.gain, M.music.lp);

    // shot buses: gain/low-pass follow their source's presence
    const shot = (name, g, lp) => { this.set(L[name].shot.gain, Math.max(0, g), now); if (lp) this.set(L[name].lp.frequency, lp, now); };
    shot('foley', listener.kind === 'eva' ? 0 : mix.traveler.g, mix.traveler.lp);
    shot('suit', listener.kind === 'eva' ? 1 : 0, 1400);
    shot('pa', M.chime.gain > 0 ? M.chime.gain / 0.13 : listener.kind === 'eva' ? 0.5 : 0.6, listener.kind === 'eva' ? 2500 : 9000);
    shot('drive', M.driveShots.g, M.driveShots.lp);
    shot('chirps', M.chirps.gain / 0.09, M.chirps.lp);
    shot('pumpRattle', M.pumpRattle.gain / 0.25, M.pumpRattle.lp);
    shot('lsRattle', M.lsRattle.gain / 0.18, M.lsRattle.lp);
    shot('arc', M.arc.gain / 0.22, M.arc.lp);
    shot('hullGroan', listener.kind === 'eva' ? 0 : 1, M.hullGroan.lp);
    shot('crackle', M.plasma.gain > 0 ? 1 : 0, M.plasma.lp);
    shot('bubbles', M.bubbles.gain > 0 ? M.bubbles.gain / 0.04 : 0, M.bubbles.lp);
    shot('creak', listener.kind === 'room' ? 1 : 0, 2500);
    const pAir = listener.kind === 'room' ? (this.hops[listener.room] || {}).airlock : 9;
    shot('airlock', listener.kind === 'eva' ? 0.6 : pAir === 0 ? 1 : pAir === 1 ? 0.25 : 0.05, pAir === 0 ? 12000 : 700);

    if (!this.enabled || mix.master === 0) { this.events = []; return; }
    this.oneShots(fr, mix, listener, performing, a, plan);
  }

  fire(bus, recipe, opts = {}, delay = 0) {
    SFX[recipe](this.ctx, this.L[bus].shot, this.ctx.currentTime + 0.02 + delay, opts);
  }

  oneShots(fr, mix, listener, performing, a, plan) {
    const dt = Math.min(0.1, fr.dt || 0.016);
    const M = mix.layers;
    const chance = (rate) => Math.random() < rate * dt;
    const { state, data } = fr;
    // ambient intermittents
    if (chance(M.chirps.rate)) this.fire('chirps', Math.random() < 0.3 ? 'click' : 'chirp');
    if (chance(M.pumpRattle.rate * 0.4)) this.fire('pumpRattle', 'rattle');
    if (chance(M.lsRattle.rate * 0.3)) this.fire('lsRattle', 'rattle');
    if (chance(M.arc.rate)) { this.fire('arc', 'crackle'); this.fire('arc', 'pop', {}, 0.03); }
    if (chance(M.hullGroan.rate)) this.fire('hullGroan', 'groan');
    if (chance(M.plasma.crackle)) this.fire('crackle', 'crackle', { k: 0.6 });
    if (chance(M.bubbles.gain > 0 ? 6 : 0)) this.fire('bubbles', 'pop', { k: 0.4 });
    if (chance(M.creak.rate)) this.fire('creak', 'creak', { k: 0.5 });
    if (M.chime.interval > 0 && fr.t - (this.lastChime || 0) > M.chime.interval) { this.lastChime = fr.t; this.fire('pa', 'chime', { k: 0.8 }); }

    // traveler foley, from what they are visibly doing
    const pos = fr.pos;
    const room = pos.room;
    if (state.traveler.move && fr.tracker && room !== 'surface') {
      const step = Math.floor(fr.tracker.walked / 0.72);
      if (this.lastStep !== null && step > this.lastStep) this.fire('foley', 'footstep', { material: data.rooms[room].floor, k: 0.8 });
      this.lastStep = step;
    } else if (fr.tracker) this.lastStep = Math.floor(fr.tracker.walked / 0.72);
    if (plan) {
      const s = Math.floor(plan.x / 0.8);
      if (this.lastEvaStep !== null && s !== this.lastEvaStep) this.fire('suit', 'footstep', { material: 'regolith', k: 0.9 });
      this.lastEvaStep = s;
    } else this.lastEvaStep = null;
    if (performing) {
      if (TYPING.has(a.id) && Math.sin(fr.t * 0.9) > -0.3 && chance(7)) this.fire('foley', 'type');
      if ((a.id === 'repair' || a.id === 'maintain') && chance(0.7)) this.fire('foley', Math.random() < 0.7 ? 'clank' : 'click', { k: 0.8 });
      if ((a.id === 'eat_meal' || a.id === 'snack') && chance(0.5)) this.fire('foley', 'utensil');
      if (a.id === 'cook_meal' && chance(0.3)) this.fire('foley', Math.random() < 0.5 ? 'utensil' : 'click', { freq: 1800 });
      if (WATERY.has(a.id) && chance(0.7)) this.fire('foley', 'splash');
      if (a.id === 'exercise' && chance(0.35)) this.fire('foley', 'rowStroke');
    }
    if (fr.tracker && room !== 'surface') {
      const k = travelerPose(state, data, fr.tracker, pos, fr.t);
      const y = !!(k && k.yawn);
      if (y && !this.yawning) this.fire('foley', 'sigh');
      this.yawning = y;
    }

    // sim events
    for (const e of this.events) {
      switch (e.type) {
        case 'hatch_cycle': this.fire('foley', 'hatch'); break;
        case 'activity_start': if (e.posture === 'sitting' || e.posture === 'reclining') this.fire('foley', 'creak', { k: 0.25 }); break;
        case 'alarm': this.fire('pa', 'chime', { k: 1, low: true }); this.fire('pa', 'chime', { k: 1, low: true }, 1.4); break;
        case 'repair': this.fire('foley', 'clank'); this.fire('foley', 'click', {}, 0.4); break;
        case 'meal_prepared': this.fire('foley', 'utensil'); break;
        case 'hyperspace_enter': this.fire('drive', 'whoosh', { k: 0.7, d: 1.6 }); break;
        case 'hyperspace_exit': this.fire('drive', 'whoosh', { k: 1, d: 3 }); this.fire('drive', 'thump', { k: 0.4 }, 0.8); break;
        case 'touchdown': this.fire('drive', 'thump'); this.fire('foley', 'creak', { k: 0.4 }, 0.5); break;
        case 'liftoff': this.fire('drive', 'whoosh', { k: 0.8, d: 4 }); break;
        case 'eva_phase':
          if (e.phase === 'cycle_out') { this.fire('airlock', 'depressurize'); this.fire('airlock', 'chime', { k: 0.3 }); }
          if (e.phase === 'cycle_in') { this.fire('airlock', 'depressurize', { inward: true }); this.fire('airlock', 'chime', { k: 0.3 }); }
          break;
        case 'torpor_start': this.fire('foley', 'podHiss'); break;
        case 'music_start': this.musicTrack = e.track; this.musicRoom = e.room; this.speaker.stop(); break;
        case 'music_stop': this.speaker.stop(); break;
        default: break;
      }
    }
    this.events = [];
  }

  /** RMS level at the output (dev/QA). */
  level() {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (const v of buf) s += v * v;
    return Math.sqrt(s / buf.length);
  }
}
