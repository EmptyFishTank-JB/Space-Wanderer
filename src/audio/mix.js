// The acoustic model, as a pure function: given the sim state and where the
// viewer is "listening" (the current camera feed), how loud and how muffled
// every layer of the ship's sound should be. No Web Audio here, so it is
// testable in Node; engine.js applies the result to the audio graph.

const clamp = (x, lo = 0, hi = 1) => (x < lo ? lo : x > hi ? hi : x);

/** Hatch hops between every pair of rooms (bulkheads muffle sound). */
export function roomHops(data) {
  const adj = {};
  for (const h of data.ship.hatches) {
    (adj[h.a] ||= new Set()).add(h.b);
    (adj[h.b] ||= new Set()).add(h.a);
  }
  const hops = {};
  for (const r of data.roomIds) {
    const d = { [r]: 0 };
    const q = [r];
    while (q.length) {
      const u = q.shift();
      for (const v of adj[u] || []) if (d[v] === undefined) { d[v] = d[u] + 1; q.push(v); }
    }
    hops[r] = d;
  }
  return hops;
}

/** Who is listening, from the feed being watched. */
export function listenerFor(feedDef, evaActive) {
  if (!feedDef) return { kind: 'room', room: 'bridge' };
  if (feedDef.eva) return evaActive ? { kind: 'eva' } : { kind: 'static' };
  if (feedDef.exterior) return { kind: 'ext' };
  return { kind: 'room', room: feedDef.room };
}

/** How a source in `room` reaches the listener: gain and low-pass cutoff (Hz). */
export function presence(hops, listener, room) {
  if (listener.kind === 'eva' || listener.kind === 'static') return { g: 0, lp: 200 };
  if (listener.kind === 'ext') return { g: 0.12, lp: 220 }; // hull-conducted, barely there
  const h = (hops[listener.room] || {})[room];
  if (h === 0) return { g: 1, lp: 16000 };
  if (h === 1) return { g: 0.28, lp: 900 };
  if (h === 2) return { g: 0.11, lp: 450 };
  return { g: 0.045, lp: 280 };
}

// structure-borne reactor rumble by compartment (strongest in engineering, deadened in quarters)
const REACTOR = { engineering: 1, workshop: 0.62, corridor_aft: 0.6, lifesupport: 0.55, hydro: 0.45, storage: 0.45, airlock: 0.45, corridor_fore: 0.35, galley: 0.3, bridge: 0.3, lounge: 0.25, quarters: 0.12 };
const VENT = { quarters: 0.35, lounge: 0.6, bridge: 0.75, corridor_fore: 0.9, corridor_aft: 0.9, engineering: 0.7 };
// propulsion, felt through the frame: loudest on the bridge and in engineering
const DRIVE = { bridge: 1, engineering: 0.9, workshop: 0.6, corridor_aft: 0.55, corridor_fore: 0.5, lounge: 0.5, airlock: 0.45, storage: 0.45, lifesupport: 0.45, hydro: 0.45, galley: 0.4, quarters: 0.3 };
// reverb: rough size/character of each space
const REVERB = { quarters: [0.25, 0.08], galley: [0.3, 0.1], lounge: [0.45, 0.14], bridge: [0.5, 0.16], storage: [0.4, 0.14], airlock: [0.45, 0.22], workshop: [0.5, 0.16], lifesupport: [0.55, 0.2], hydro: [0.7, 0.22], engineering: [0.9, 0.28], corridor_fore: [0.85, 0.3], corridor_aft: [0.85, 0.3] };

/**
 * opts: { muted, view (render space view: entryHeat, buffeting, speed), music: {playing, room, track},
 *         evaBody: {atmosphere, tempK}, exertion, fatigue }
 */
export function computeMix(state, data, hops, listener, opts = {}) {
  const s = state.ship;
  const f = s.flight;
  const room = listener.kind === 'room' ? listener.room : null;
  const P = (r) => presence(hops, listener, r);
  const inside = listener.kind === 'room';
  const out = clamp(s.power.reactorOut / 40);
  const heat = s.thermal.heat;
  const L = {};

  // ── base vessel bed ──
  const rw = inside ? REACTOR[room] ?? 0.4 : listener.kind === 'ext' ? 0.22 : 0;
  L.reactor = { gain: 0.5 * rw * (0.3 + 0.7 * out), freq: 36 + 8 * out + 6 * clamp(heat - 0.4), lp: room === 'quarters' ? 120 : listener.kind === 'ext' ? 110 : 260 };
  L.vent = { gain: inside ? 0.16 * (VENT[room] ?? 0.5) * (s.power.mode === 'limp' ? 0.35 : 1) : 0, lp: 1800 };
  L.hum = { gain: inside ? 0.035 * (0.4 + 0.6 * s.power.lightLevel) : 0, lp: 1200 };
  L.creak = { rate: inside ? 0.018 + 0.03 * clamp(heat - 0.5) : 0, gain: 0.12 }; // bulkhead thermal creaks / minute-ish

  // ── room systems ──
  const ph = P('hydro');
  const flow = ['hydro_pump_1', 'hydro_pump_2'].reduce((a, id) => a + (s.components[id].fault && s.components[id].fault.severity === 'major' ? 0 : 0.5), 0);
  const misting = s.ops.lampOn && !s.hydroDormant && s.trays.some((t) => t.crop && t.water < 0.85);
  const rattle = ['hydro_pump_1', 'hydro_pump_2'].some((id) => s.components[id].fault && s.components[id].fault.severity === 'minor');
  L.water = { gain: 0.16 * flow * ph.g, lp: ph.lp };
  L.mist = { gain: misting ? 0.07 * ph.g : 0, lp: Math.min(ph.lp, 7000) };
  L.lamps = { gain: s.ops.lampOn && !s.hydroDormant ? 0.03 * s.power.lampLevel * ph.g : 0, lp: ph.lp }; // ballast hum
  L.pumpRattle = { rate: rattle ? 2.5 : 0, gain: 0.25 * ph.g, lp: ph.lp };

  const pb = P('bridge');
  L.chirps = { rate: 0.12 * (s.power.mode === 'limp' ? 0.3 : 1), gain: 0.09 * pb.g, lp: pb.lp };
  L.sweep = { gain: 0.035 * pb.g * (s.components.bridge_sensors.fault ? 0.4 : 1), lp: pb.lp };

  const pg = P('galley');
  L.heater = { gain: s.ops.cooking ? 0.1 * pg.g : 0, lp: pg.lp };
  L.kettle = { gain: s.ops.cooking || s.food.mealReady ? 0.045 * pg.g : 0, lp: pg.lp };

  const pw = P('workshop');
  L.fabricator = { gain: s.ops.fabricating ? 0.16 * pw.g : 0, lp: pw.lp };

  const pl = P('lifesupport');
  const lsWorn = ['water_recycler', 'dehumidifier', 'o2_scrubber', 'ogs'].some((id) => s.components[id].fault || s.components[id].wear > 0.65);
  L.pumps = { gain: 0.1 * pl.g, lp: pl.lp, cycle: 0.22 + 0.25 * s.ops.recyclerDuty };
  L.lsRattle = { rate: lsWorn ? 1.2 : 0, gain: 0.18 * pl.g, lp: pl.lp };
  L.bubbles = { gain: 0.04 * s.ops.ogsDuty * pl.g, lp: pl.lp };

  const pe = P('engineering');
  L.ventHiss = { gain: 0.24 * clamp((heat - 0.45) * 2) * pe.g, lp: pe.lp };
  const pf = P('corridor_fore');
  const arcing = s.components.junction_box_fore.fault && s.components.junction_box_fore.fault.id === 'arcing';
  L.arc = { rate: arcing ? 1.4 : 0, gain: 0.22 * pf.g, lp: pf.lp };
  const pa = P('corridor_aft');
  L.buzz = { gain: s.components.corridor_lights_aft.fault ? 0.035 * pa.g : 0, lp: pa.lp };

  // ── propulsion & spaceflight (Elite-flavoured) ──
  const dw = inside ? DRIVE[room] ?? 0.5 : listener.kind === 'ext' ? 1 : 0;
  const dlp = inside ? (room === 'bridge' || room === 'engineering' ? 3000 : 700) : listener.kind === 'ext' ? 1400 : 200;
  const v = f.mode === 'cruise' ? f.v : 0;
    // speed on a log scale: slowing in a gravity well pulls the drive hum's pitch and brightness down
  const open = clamp(Math.log10(1 + v * 100) / 5.3);
  L.cruise = { gain: f.mode === 'cruise' ? (0.07 + 0.13 * open) * dw : 0, pitch: 48 + 60 * open, drag: open, lp: dlp };
  const charge = f.mode === 'charging' ? clamp(1 - f.timer / data.space.drive.chargeSeconds) : 0;
  L.charge = { gain: f.mode === 'charging' ? (0.08 + 0.22 * charge) * dw : 0, pitch: 70 + 520 * charge * charge, lp: Math.max(dlp, 2000) };
  L.hyper = { gain: f.mode === 'hyperspace' ? 0.34 * dw : 0, lp: Math.max(dlp, 2500) };
  const scoop = f.mode === 'scooping';
  L.plasma = { gain: scoop ? (0.1 + 0.3 * clamp((heat - 0.35) * 1.6)) * dw : 0, crackle: scoop ? 3 + 12 * clamp(heat - 0.4) : 0, lp: Math.max(dlp, 1600) };
  L.hullGroan = { rate: scoop && heat > 0.6 ? 0.25 + heat * 0.4 : 0, gain: 0.2 * dw, lp: 400 };
  // diegetic warning chime (ship-wide PA, so it carries through bulkheads)
  L.driveShots = { g: dw, lp: dlp };
  L.chime = { interval: heat > 0.95 ? 1.2 : heat > 0.82 ? 3 : 0, gain: inside ? (room === 'bridge' ? 0.13 : 0.07) : listener.kind === 'ext' ? 0.02 : 0 };
  const vw = opts.view || {};
  const entry = clamp((vw.entryHeat || 0) * 2);
  const buffet = clamp(vw.buffeting || 0);
  L.entry = { gain: (0.25 * entry + 0.2 * buffet) * dw, cutoff: 600 + 3500 * entry, lp: Math.max(dlp, 1200) };
  L.rumble = { gain: 0.3 * buffet * dw, lp: 140 };

  // ── EVA: suit interior ──
  const eva = listener.kind === 'eva';
  const ex = opts.exertion ?? 1.2;
  L.breath = { gain: eva ? 0.22 : 0, rate: 0.22 + 0.05 * ex + 0.1 * (opts.fatigue || 0) };
  L.comms = { gain: eva ? 0.018 : 0 };
  const atmo = opts.evaBody ? opts.evaBody.atmosphere : 'none';
  L.evaWind = { gain: eva ? (atmo === 'thick' ? 0.12 : atmo === 'thin' ? 0.05 : 0) : 0, lp: 380 };
  L.suitHum = { gain: eva ? 0.02 : 0 };

  // ── diegetic music from the in-room speaker ──
  const m = opts.music || {};
  const pm = m.playing ? P(m.room) : { g: 0, lp: 200 };
  L.music = { gain: m.playing ? 0.3 * pm.g : 0, lp: Math.min(pm.lp, 7000) };

  // a dead feed hisses quietly
  L.static = { gain: listener.kind === 'static' ? 0.035 : 0 };

  const rv = inside ? REVERB[room] || [0.4, 0.12] : eva ? [0.08, 0.05] : [0.1, 0];
  return {
    master: opts.muted ? 0 : 0.9,
    layers: L,
    reverb: { size: rv[0], wet: rv[1] },
    traveler: P(state.traveler.pos.room === 'surface' ? 'airlock' : state.traveler.pos.room),
    listener,
  };
}
