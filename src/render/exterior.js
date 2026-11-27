// The hull cameras. Each exterior feed in data/cameras.json names a mount from
// the ship's 3D layout (data/ship3d.json): dorsal (on the mast), bow (a tine
// tip, looking back at the ship), scoop (the scoop fairing's lip), stern (the
// deckhouse's aft face), port / stbd (the deck edges aft) and ventral (under
// the bow, looking aft along the belly). The sky or the ground is drawn for
// the camera's own yaw and pitch; the hull in front of it carries the story:
// radiators glowing under thermal load, the scoop drinking plasma, shield
// shimmer in a corona, frost after a void crossing, gear down on the ground.
import { W, H, mix, mul, rect, px, glow, hash, line, clamp01, css } from './gfx.js';
import { drawSpaceScene } from './celestial.js';
import { drawSurfaceScene } from './terrain.js';
import { picks } from './picks.js';
import { shipModel, renderShip, camAngles } from './hull3d.js';

const HULL = [96, 100, 108];
const DARK = [40, 42, 48];
const GLASS = [90, 150, 170];
const LIT = [255, 214, 150];

/** Fill a polygon (screen points), snapped to whole pixels. */
function poly(ctx, c, pts, a = 1) {
  ctx.fillStyle = css(c, a);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(Math.round(x), Math.round(y)) : ctx.moveTo(Math.round(x), Math.round(y))));
  ctx.closePath();
  ctx.fill();
}
const additive = (ctx, fn) => { ctx.globalCompositeOperation = 'lighter'; fn(); ctx.globalCompositeOperation = 'source-over'; };
const gearDown = (f) => ['landed', 'descent', 'ascent'].includes(f.mode);

export function renderExteriorFeed(ctx, m, def = {}) {
  const { state, view, t } = m;
  const mount = typeof def.exterior === 'string' ? def.exterior : 'dorsal';
  // the real ship, seen from the camera's own mount, whenever the 3D layout is loaded
  const model = shipModel();
  const cam = model && mount !== 'bay' ? model.cams[def.label] : null;
  const ang = cam ? camAngles(cam) : null;
  const yaw = ang ? ang.yaw : def.yaw ?? 0, pitch = ang ? ang.pitch : def.pitch ?? -0.08;
  if (view.scene === 'surface') {
    const sp = cam ? pitch : view.altitudeKm > 0 ? pitch - 0.05 : pitch + 0.12;
    drawSurfaceScene(ctx, { body: view.body, sys: view.sys, t, altitudeKm: view.altitudeKm, yaw: cam ? yaw : 0.25 + yaw, pitch: sp, entryHeat: view.entryHeat, buffeting: view.buffeting });
  } else {
    drawSpaceScene(ctx, view, t, { yaw, pitch, pick: m.pickHull !== false });
  }
  const shake = view.buffeting ? Math.round(Math.sin(t * 31) * 2 * view.buffeting) : 0;
  const k = { state, view, t, shake, sh: state.ship, heat: state.ship.thermal.heat, wear: state.ship.components.hull_plating.wear };
  if (cam) {
    const f = state.ship.flight, a = state.traveler.activity;
    const plan = a && a.id === 'rover_outing' && a.params.plan;
    const shot = shake ? { at: [cam.at[0], cam.at[1], cam.at[2] + shake * 0.05], look: cam.look } : cam;
    const boxes = renderShip(ctx, shot, {
      heat: k.heat, wear: k.wear, landed: f.mode === 'landed', gearDown: ['landed', 'descent', 'ascent'].includes(f.mode),
      drive: view.scene === 'hyperspace' ? 1 : Math.max(view.charging || 0, view.speed > 0.0005 ? 0.8 : 0),
      shut: ['cruise', 'hyperspace', 'charging', 'scooping'].includes(f.mode), lit: (state.ship.power.lightLevel ?? 1) > 0.2,
      roverOut: !!(state.ship.rover && state.ship.rover.out), roverX: plan ? plan.x : 0, beacon: Math.sin(t * 2.4) > 0.6,
    });
    if (mount === 'scoop' && view.mode === 'scooping') MOUNTS_FX.plasma(ctx, k);
    overlays(ctx, k, mount);
    if (m.pickHull !== false) registerModelPicks(boxes, k, def);
    return;
  }
  (MOUNTS[mount] || MOUNTS.dorsal)(ctx, k);
  overlays(ctx, k, mount);
  if (m.pickHull !== false) registerHullPicks(mount, k, def);
}

const MOUNTS_FX = {
  // plasma streaming into the scoop intake, over the drawn ship
  plasma(ctx, k) {
    additive(ctx, () => {
      for (let i = 0; i < 90; i++) {
        const sx = hash(i, 1, 5) * W, sy = 30 + hash(i, 2, 5) * 80;
        const u = (k.t * 1.4 + hash(i, 3, 5)) % 1;
        px(ctx, mix([255, 150, 60], [255, 240, 200], hash(i, 4, 5)), sx + (W / 2 - sx) * u, sy + (H - 24 - sy) * u, 0.6 * (1 - u * 0.5));
      }
      glow(ctx, [255, 150, 70], W / 2, H - 24, 90, 0.3);
    });
  },
};

/** Selection on the rendered ship: every part that shows, with live details where the sim has them. */
function registerModelPicks(boxes, k, def) {
  const sh = k.sh, f = sh.flight, sub = `${def.label || 'Hull camera'} · ${def.mount || ''}`;
  const first = (txt) => (txt || '').split(/(?<=\.)\s/)[0];
  for (const b of boxes) {
    const { part } = b;
    const ref = part.ref || {};
    let lines;
    if (part.kind === 'hull') lines = [['Plating', condition(sh, 'hull_plating')], ['Scorch and wear', pctv(sh.components.hull_plating.wear)]];
    else if (part.kind === 'window') lines = [['Shutter', ['cruise', 'hyperspace', 'charging', 'scooping'].includes(f.mode) ? 'closed' : 'open'], ['Lights', ref.backs && !ref.backs.startsWith('mod:') ? ref.backs.replace(/_/g, ' ') : 'sensors']];
    else if (ref.role === 'thermal') lines = [['Heat', pctv(k.heat)], ['Vents', condition(sh, 'thermal_vents')], ['State', k.heat > 0.6 ? 'glowing, dumping heat' : k.heat > 0.4 ? 'warm' : 'cool']];
    else if (/^(nozzle_|engine_|rim_)/.test(ref.id || '')) lines = [['Drive', DRIVE[f.mode] || f.mode], ['FSD coil', condition(sh, 'drive_coil')]];
    else if (ref.id === 'scoop') lines = [['Scoop', f.mode === 'scooping' ? 'open, drinking plasma' : 'closed'], ['Manifold', condition(sh, 'scoop_manifold')], ['Fuel', `${sh.fuel.tons.toFixed(1)} of ${sh.fuel.capacity} t`]];
    else if (/^gear_/.test(ref.id || '')) lines = [['Gear', f.mode === 'landed' ? 'down and locked, on the ground' : 'down']];
    else if (/^sensor_|nav_sensors|^ant_|^probe_|mast/.test(ref.id || '')) lines = [['Sensors', condition(sh, 'bridge_sensors')], ['About', first(ref.info)]];
    else if (ref.role === 'weapon') lines = [['State', 'stowed'], ['About', first(ref.info)]];
    else if (b.id === 'rover') lines = [['Out', `${((sh.rover && k.state.traveler.activity && k.state.traveler.activity.params.plan ? k.state.traveler.activity.params.plan.x : 0) / 1000).toFixed(1)} km`], ['Battery', pctv(sh.rover ? sh.rover.charge : 1)]];
    else lines = ref.info ? [['About', first(ref.info)]] : [];
    picks.add({ id: `hull3d:${b.id}`, x: b.x, y: b.y, w: b.w, h: b.h, info: () => ({ name: part.name, sub, lines }) });
  }
}

// ───────── selection: the hull parts each camera shows ─────────
const pctv = (v) => `${Math.round(clamp01(v) * 100)}%`;
function condition(sh, id) {
  const c = sh.components[id];
  if (!c) return '—';
  return `${pctv(1 - c.wear)}${c.fault ? `, ${c.fault.severity} fault` : ''}`;
}
const DRIVE = { cruise: 'supercruise', charging: 'charging the frame shift drive', hyperspace: 'in hyperspace', scooping: 'skimming the star', orbit: 'holding orbit', landed: 'shut down, on the ground', descent: 'descending', ascent: 'climbing out', void: 'coasting, cold', idle: 'idle' };

function registerHullPicks(mount, k, def) {
  const sh = k.sh, f = sh.flight, sub = `${def.label || 'Hull camera'} · ${def.mount || mount}`;
  const add = (id, x, y, w, h, name, lines) => picks.add({ id: `hull:${mount}:${id}`, x, y, w, h, info: () => ({ name, sub, lines: typeof lines === 'function' ? lines() : lines }) });
  const plating = () => [['Plating', condition(sh, 'hull_plating')], ['Scorch and wear', pctv(sh.components.hull_plating.wear)]];
  const radiators = () => [['Heat', pctv(k.heat)], ['Vents', condition(sh, 'thermal_vents')], ['State', k.heat > 0.6 ? 'glowing, dumping heat' : k.heat > 0.4 ? 'warm' : 'cool']];
  const drive = () => [['Drive', DRIVE[f.mode] || f.mode], ['FSD coil', condition(sh, 'drive_coil')]];
  const sensors = () => [['Array', condition(sh, 'bridge_sensors')], ['Baseline', 'about 25 m, tine to tine']];
  const gear = () => [['Gear', ['landed', 'descent', 'ascent'].includes(f.mode) ? (f.mode === 'landed' ? 'down and locked, on the ground' : 'down') : 'stowed in the belly']];
  const shutters = [['Shutters', 'armored; closed for supercruise, hyperspace and scooping']];
  if (mount === 'dorsal') {
    add('deck', 0, 104, W, H - 120, 'Top deck', plating);
    add('sky_p', W / 2 - 90, 112, 60, 46, 'Port gallery skylight', shutters);
    add('sky_s', W / 2 + 30, 112, 60, 46, 'Starboard gallery skylight', shutters);
    add('turrets', W / 2 - 22, 104, 44, 6, 'Medium hardpoints', [['Mounts', 'two gimballed pulse lasers, forward deck'], ['State', 'stowed']]);
    add('roof', 10, H - 16, W - 20, 16, 'Deckhouse roof', plating);
    add('beacon', W / 2 - 5, H - 8, 10, 8, 'Nav beacon', [['Blink', 'every 2.6 s, on the mast head']]);
  } else if (mount === 'bow') {
    add('face', 60, 92, 190, 16, 'Bow face, between the tines', plating);
    add('bowwin', 96, 96, 120, 6, 'Bow sensor window', [['Behind it', 'star trackers, forward lidar, collision radar'], ...shutters]);
    add('deckhouse', 128, 81, 68, 11, 'Deckhouse', [['Inside', 'the living deck']]);
    add('tower', 148, 66, 28, 15, 'Bridge tower', [['Inside', 'the bridge'], ['Glazing', 'raked canopy, shuttered in flight']]);
    add('tine', 190, 93, W - 190, H - 93, 'Starboard tine', sensors);
    add('boom', 270, H - 72, W - 270, 50, 'Magnetometer boom and whip antenna', [['Boom', 'holds the magnetometer clear of the ship\'s own fields']]);
  } else if (mount === 'scoop') {
    add('intake', 50, H - 30, W - 100, 14, 'Fuel scoop intake', () => [['Scoop', f.mode === 'scooping' ? 'open, drinking plasma' : 'closed'], ['Manifold', condition(sh, 'scoop_manifold')], ['Fuel', `${sh.fuel.tons.toFixed(1)} of ${sh.fuel.capacity} t`]]);
    add('belly', 0, 0, W, 30, 'Forward belly', plating);
  } else if (mount === 'stern') {
    for (const [s2, side] of [[-1, 'Port'], [1, 'Starboard']]) {
      const cx = W / 2 + s2 * 92;
      add(`rad_${side}`, cx - 44, 73, 88, H - 83, `${side} radiators`, radiators);
      add(`bank_${side}`, cx - 31, 66, 62, 6, `${side} main thruster`, drive);
    }
    add('inboard', W / 2 - 34, 80, 68, H - 110, 'Inboard engines', drive);
    add('dish', 62, H - 38, 32, 18, 'Comms dish', [['Steered by', 'the comms room'], ['Parked', 'facing up and aft']]);
  } else if (mount === 'port' || mount === 'stbd') {
    const X = (x) => (mount === 'port' ? x : W - x);
    const lo = Math.min(X(-10), X(150)), hi = Math.max(X(-10), X(150));
    add('edge', lo, 84, hi - lo, H - 120, `${mount === 'port' ? 'Port' : 'Starboard'} deck edge`, plating);
    add('wing', lo, H - 60, hi - lo, 60, `${mount === 'port' ? 'Port' : 'Starboard'} wing and gallery windows`, [['Behind them', `the ${mount === 'port' ? 'port' : 'starboard'} gallery`], ...shutters]);
    add('lifeboat', Math.min(X(120), X(172)), 78, 52, 12, 'Lifeboat housing', [['Boat', 'seats four, launches sideways'], ['Boarded from', 'a ladder in the gallery below']]);
  } else if (mount === 'ventral') {
    add('belly', 0, 0, W, 70, 'Belly', plating);
    add('turrets', W / 2 - 64, 46, 128, 12, 'Large hardpoints', [['Mounts', 'two gimballed, ventral'], ['State', 'stowed']]);
    add('gear', 0, 20, W, H - 20, 'Landing gear', gear);
  }
}

/** Weathering specks over a region. */
function weather(ctx, k, x0, y0, x1, y1, n = 120) {
  for (let i = 0; i < n * k.wear; i++) px(ctx, [40, 34, 30], x0 + hash(i, 1, 41) * (x1 - x0), y0 + hash(i, 2, 41) * (y1 - y0), 0.55);
}

/** A polygon shaded top to bottom (far to near). */
function shaded(ctx, pts, y0, y1, far, near) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, css(far)); g.addColorStop(1, css(near));
  ctx.fillStyle = g;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(Math.round(x), Math.round(y)) : ctx.moveTo(Math.round(x), Math.round(y))));
  ctx.closePath();
  ctx.fill();
}

/** Radiator panel (a quad: far-left, far-right, near-right, near-left), finned, glowing with heat. */
function radiator(ctx, k, pts) {
  poly(ctx, [52, 54, 60], pts);
  const [a, b, c, d] = pts;
  for (let i = 1; i < 8; i++) { const u = i / 8; line(ctx, [78, 80, 88], a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, d[0] + (c[0] - d[0]) * u, d[1] + (c[1] - d[1]) * u, 0.9); }
  const g = clamp01((k.heat - 0.4) * 1.8);
  if (g > 0) poly(ctx, mix([140, 40, 20], [255, 170, 70], g), pts, 0.35 + 0.55 * g);
}

const MOUNTS = {
  // on the mast above the bridge, looking forward and down the length of the deck
  dorsal(ctx, k) {
    const top = 104 + k.shake;
    // the long top deck, narrowing toward the forked bow
    shaded(ctx, [[W / 2 - 34, top], [W / 2 + 34, top], [W + 60, H], [-60, H]], top, H, mul(HULL, 0.55), mul(HULL, 0.95));
    // the gap between the tines at the far end
    poly(ctx, [8, 9, 12], [[W / 2 - 9, top], [W / 2 + 9, top], [W / 2 + 4, top + 4], [W / 2 - 4, top + 4]]);
    // panel seams converging forward
    for (let i = -4; i <= 4; i++) line(ctx, mul(HULL, 0.45), W / 2 + i * 7, top, W / 2 + i * 70, H, 0.5);
    // gallery skylights and the medium turrets
    for (const s of [-1, 1]) {
      poly(ctx, GLASS, [[W / 2 + s * 20, top + 8], [W / 2 + s * 24, top + 8], [W / 2 + s * 92, H - 22], [W / 2 + s * 76, H - 22]], 0.7);
      rect(ctx, [150, 70, 76], W / 2 + s * 17 - 2, top + 3, 4, 2);
    }
    // the deckhouse roof below the camera, the tower edge at the bottom of frame
    poly(ctx, mul(HULL, 0.8), [[40, H - 16], [W - 40, H - 16], [W - 10, H], [10, H]]);
    rect(ctx, [210, 220, 230], 44, H - 16, W - 88, 1, 0.25);
    weather(ctx, k, 0, top, W, H);
    // beacon on the mast head, just in frame
    if (Math.sin(k.t * 2.4) > 0.6) { px(ctx, [255, 70, 50], W / 2, H - 3); additive(ctx, () => glow(ctx, [255, 60, 40], W / 2, H - 3, 6, 0.6)); }
  },

  // on the starboard tine tip, looking back along the tine at the ship
  bow(ctx, k) {
    const hz = 92 + k.shake; // the deck's edge-on line
    // the main hull's flat bow face between the tines, with its sensor window
    poly(ctx, mul(HULL, 0.5), [[60, hz], [250, hz], [244, hz + 16], [66, hz + 16]]);
    rect(ctx, GLASS, 96, hz + 5, 120, 4, 0.8);
    // the top deck edge-on, and the deckhouse and tower rising from it
    rect(ctx, mul(HULL, 0.75), 20, hz - 2, 280, 2);
    poly(ctx, mul(HULL, 0.6), [[128, hz - 2], [196, hz - 2], [190, hz - 11], [134, hz - 11]]);
    poly(ctx, mul(HULL, 0.55), [[148, hz - 11], [176, hz - 11], [172, hz - 18], [152, hz - 18]]);
    rect(ctx, GLASS, 152, hz - 17, 20, 2, 0.8);
    rect(ctx, mul(HULL, 0.5), 161, hz - 26, 1, 8);
    // the port tine, far across the gap
    poly(ctx, mul(HULL, 0.55), [[18, hz + 2], [60, hz], [60, hz + 7], [18, hz + 8]]);
    // this tine, running from under the camera toward the ship
    poly(ctx, mul(HULL, 0.82), [[250, hz + 1], [262, hz + 1], [W + 20, H], [190, H]]);
    poly(ctx, mul(HULL, 0.6), [[262, hz + 1], [270, hz + 6], [W + 20, H - 30], [W + 20, H]]);
    rect(ctx, GLASS, 236, hz + 30, 30, 3, 0.7); // its sensor window
    weather(ctx, k, 190, hz, W, H, 60);
    // the magnetometer boom and the whip antenna standing off the tine
    line(ctx, mul(HULL, 0.7), 286, H - 36, W, H - 44, 0.9);
    line(ctx, mul(HULL, 0.7), 270, H - 20, W, H - 70, 0.8);
    // the drive glow beyond the ship in supercruise and hyperspace
    if (k.view.speed > 0.0005 || k.view.scene === 'hyperspace' || k.view.charging > 0) additive(ctx, () => glow(ctx, [110, 150, 255], 160, hz - 4, 70, 0.2 + 0.3 * (k.view.charging || 0)));
  },

  // on the lip of the scoop fairing under the bow, looking forward past the intake
  scoop(ctx, k) {
    const scooping = k.view.mode === 'scooping';
    // the belly overhead, a dark ceiling across the top of the frame
    poly(ctx, [30, 32, 38], [[0, 0], [W, 0], [W, 22 + k.shake], [0, 34 + k.shake]]);
    for (let i = 0; i < 6; i++) line(ctx, [44, 46, 54], i * 64, 0, i * 64 + 30, 30, 0.7);
    // the intake mouth across the bottom, ribbed
    poly(ctx, mul(HULL, 0.55), [[0, H - 30], [W, H - 30], [W, H], [0, H]]);
    rect(ctx, [16, 16, 20], 50, H - 30, W - 100, 14);
    for (let x = 54; x < W - 50; x += 8) rect(ctx, mul(HULL, 0.4), x, H - 30, 2, 14);
    rect(ctx, mul(HULL, 0.8), 0, H - 31, W, 1);
    weather(ctx, k, 0, H - 30, W, H, 50);
    if (scooping) {
      // plasma streaming into the intake
      additive(ctx, () => {
        for (let i = 0; i < 90; i++) {
          const sx = hash(i, 1, 5) * W, sy = 30 + hash(i, 2, 5) * 80;
          const u = (k.t * 1.4 + hash(i, 3, 5)) % 1;
          const x = sx + (W / 2 - sx) * u, y = sy + (H - 24 - sy) * u;
          px(ctx, mix([255, 150, 60], [255, 240, 200], hash(i, 4, 5)), x, y, 0.6 * (1 - u * 0.5));
        }
        glow(ctx, [255, 150, 70], W / 2, H - 24, 90, 0.3);
      });
    }
  },

  // on the deckhouse's aft face, looking aft and down over the radiators to the engines
  stern(ctx, k) {
    const y0 = 76 + k.shake;
    // the aft deck, widening toward the camera
    shaded(ctx, [[60, y0], [260, y0], [W + 40, H], [-40, H]], y0, H, mul(HULL, 0.45), mul(HULL, 0.8));
    // the two thruster housings rising either side, radiators flush on top
    for (const s of [-1, 1]) {
      const cx = W / 2 + s * 92;
      shaded(ctx, [[cx - 30, y0 - 6], [cx + 30, y0 - 6], [cx + 58, H], [cx - 58, H]], y0, H, mul(HULL, 0.55), mul(HULL, 0.9));
      radiator(ctx, k, [[cx - 24, y0 - 3], [cx + 24, y0 - 3], [cx + 44, H - 10], [cx - 44, H - 10]]);
      // the shroud round the nozzle bank at the far end, with the bells' rims just showing
      rect(ctx, mul(HULL, 0.4), cx - 31, y0 - 10, 62, 4);
      for (let i = 0; i < 4; i++) rect(ctx, [120, 120, 170], cx - 24 + i * 14, y0 - 9, 8, 1);
    }
    // the inboard engine housing on the centerline
    poly(ctx, mul(HULL, 0.66), [[W / 2 - 22, y0 + 4], [W / 2 + 22, y0 + 4], [W / 2 + 34, H - 30], [W / 2 - 34, H - 30]]);
    // the comms dish and a utility mount near the camera
    poly(ctx, [150, 154, 160], [[64, H - 30], [86, H - 36], [92, H - 26], [70, H - 20]]);
    rect(ctx, [160, 110, 60], 236, H - 22, 6, 4);
    weather(ctx, k, 0, y0, W, H);
    const g = clamp01((k.heat - 0.4) * 1.8);
    if (g > 0) additive(ctx, () => { glow(ctx, [255, 110, 40], W / 2 - 92, y0 + 40, 70, 0.18 * g); glow(ctx, [255, 110, 40], W / 2 + 92, y0 + 40, 70, 0.18 * g); });
    if (k.view.speed > 0.0005 || k.view.scene === 'hyperspace' || k.view.charging > 0) {
      additive(ctx, () => { for (const s of [-1, 0, 1]) glow(ctx, [110, 150, 255], W / 2 + s * 92, y0 - 12, s ? 40 : 26, 0.3 + 0.3 * (k.view.charging || 0)); });
    }
  },

  // on the deck edge aft, looking forward along the side of the ship
  port(ctx, k) { side(ctx, k, 1); },
  stbd(ctx, k) { side(ctx, k, -1); },

  // in the rover bay's ceiling corner, looking down across the platform
  bay(ctx, k) {
    const f = k.sh.flight, rover = k.sh.rover || { out: false };
    const lowered = f.mode === 'landed' && rover.out;
    const fy = 92 + k.shake; // where the far wall meets the floor
    // back wall, side walls in perspective, the floor
    rect(ctx, [58, 60, 66], 0, 0, W, fy);
    for (let x = 16; x < W; x += 40) rect(ctx, [50, 52, 58], x, 8, 2, fy - 8);
    poly(ctx, [46, 48, 54], [[0, 0], [40, 18], [40, fy], [0, H]]);
    poly(ctx, [46, 48, 54], [[W, 0], [W - 40, 18], [W - 40, fy], [W, H]]);
    rect(ctx, [200, 160, 60], 40, fy - 3, W - 80, 2); // hazard stripe along the far wall
    // the floor, with the platform in it
    const plat = [[96, fy + 6], [W - 96, fy + 6], [W - 56, H - 12], [56, H - 12]];
    const floor = [[40, fy], [W - 40, fy], [W, H], [0, H]];
    if (lowered) {
      // the platform is down on the ground: the floor has an opening, and the surface shows through it
      ctx.fillStyle = css([70, 72, 78]);
      ctx.beginPath();
      for (const ring of [floor, plat]) ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.fill('evenodd');
      for (const [x0, y0] of plat) rect(ctx, [200, 160, 60], x0 - 1, y0 - 1, 3, 3);
      for (const xs of [0.3, 0.7]) { const x = plat[0][0] + (plat[1][0] - plat[0][0]) * xs; rect(ctx, [120, 124, 132], x - 1, fy + 6, 2, H - fy - 18); } // the screw jacks
    } else {
      poly(ctx, [70, 72, 78], floor);
      poly(ctx, [86, 88, 96], plat);
      for (let i = 1; i < 6; i++) { const u = i / 6; line(ctx, [70, 72, 78], 96 + (56 - 96) * u, fy + 6 + (H - 18 - fy) * u, W - 96 + (96 - 56) * u, fy + 6 + (H - 18 - fy) * u, 0.6); }
      if (!rover.out) drawRover(ctx, W / 2, H - 36, 1);
    }
    // bay lights
    for (const x of [90, W / 2, W - 90]) { rect(ctx, [220, 220, 200], x - 8, 2, 16, 2); additive(ctx, () => glow(ctx, [255, 240, 210], x, 10, 30, 0.12)); }
  },

  // under the bow, looking aft along the belly
  ventral(ctx, k) {
    const f = k.sh.flight;
    const yb = 70 + k.shake; // where the belly meets the far end of the view
    // the belly overhead, receding aft
    poly(ctx, [52, 54, 62], [[-40, 0], [W + 40, 0], [W / 2 + 90, yb], [W / 2 - 90, yb]]);
    for (let i = -5; i <= 5; i++) line(ctx, [40, 42, 50], W / 2 + i * 60, 0, W / 2 + i * 16, yb, 0.6);
    for (let j = 1; j < 6; j++) { const y = yb * (1 - j * j / 40); const half = 90 + (1 - y / yb) * 210; line(ctx, [42, 44, 52], W / 2 - half, y, W / 2 + half, y, 0.5); }
    // the two large ventral turrets
    for (const s of [-1, 1]) { rect(ctx, [130, 60, 66], W / 2 + s * 58 - 5, yb - 22, 10, 5); rect(ctx, DARK, W / 2 + s * 58 - 1, yb - 17, 2, 5); }
    // the landing gear, down on the ground or folded into the belly
    const legs = [[-118, 20, 1], [118, 20, 1], [-70, 44, 0.75], [70, 44, 0.75], [-46, 62, 0.5], [46, 62, 0.5]];
    for (const [dx, y, s] of legs) {
      const x = W / 2 + dx * (1 + (1 - y / yb) * 0.6);
      if (gearDown(f)) {
        const len = (f.mode === 'landed' ? 110 : 70) * s;
        rect(ctx, [120, 124, 132], x - 3 * s, y, 6 * s, len);
        rect(ctx, [80, 84, 92], x - 6 * s, y + len - 3 * s, 12 * s, 3 * s);
      } else rect(ctx, [70, 72, 80], x - 5 * s, y - 2, 10 * s, 3);
    }
    weather(ctx, k, 0, 0, W, yb, 80);
    // the rover platform's outline, aft of the turrets
    line(ctx, [200, 170, 70], W / 2 - 30, yb - 6, W / 2 + 10, yb - 6, 0.7);
  },
};

/** The surface rover, side-on to the camera: a six-wheeled pressurized cab with sample bins. */
function drawRover(ctx, x, y, s) {
  rect(ctx, [178, 150, 60], x - 34 * s, y - 16 * s, 68 * s, 14 * s);
  rect(ctx, [190, 162, 70], x + 8 * s, y - 24 * s, 24 * s, 9 * s);
  rect(ctx, GLASS, x + 12 * s, y - 22 * s, 18 * s, 5 * s, 0.9);
  rect(ctx, [120, 104, 50], x - 32 * s, y - 14 * s, 26 * s, 8 * s);
  for (const dx of [-24, 0, 24]) { rect(ctx, [26, 26, 30], x + (dx - 7) * s, y - 4 * s, 14 * s, 8 * s); rect(ctx, [70, 70, 76], x + (dx - 2) * s, y - 1 * s, 4 * s, 3 * s); }
}

/** The flank cameras: the deck edge runs forward on the hull side of the frame, the wing's underside below it with its lit gallery windows. s = 1 for the port camera (hull to the right), -1 for starboard. */
function side(ctx, k, s) {
  const X = (x) => (s > 0 ? x : W - x);
  const vy = 88 + k.shake; // vanishing point
  // the top deck, seen almost edge-on
  poly(ctx, mul(HULL, 0.7), [[X(150), vy], [X(W + 20), vy - 6], [X(W + 20), vy + 18], [X(-10), H - 34]]);
  // the wing's underside, darker, sloping in toward the belly
  poly(ctx, [44, 46, 54], [[X(-10), H - 34], [X(150), vy + 1], [X(W + 20), vy + 30], [X(W + 20), H], [X(-10), H]]);
  // the deck edge itself, catching the light
  line(ctx, [170, 176, 186], X(-10), H - 34, X(150), vy, 0.9);
  // lit gallery windows in the wing underside
  for (let i = 0; i < 7; i++) {
    const u = i / 7, x = X(40 + u * 100), y = H - 30 + (vy + 6 - (H - 30)) * u;
    rect(ctx, mix(LIT, GLASS, 0.3), Math.min(x, X(40 + (u + 0.1) * 100)), y + 4, Math.max(2, 10 * (1 - u)), Math.max(1, 3 * (1 - u)), 0.85);
  }
  // micro-thruster pods along the edge, and a lifeboat housing on the deck
  for (const u of [0.15, 0.6]) { const x = X(-10 + u * 160), y = H - 34 + (vy - (H - 34)) * u; rect(ctx, [150, 150, 170], x - 2, y - 2, 4, 3); }
  poly(ctx, mul(HULL, 0.8), [[X(120), vy - 2], [X(170), vy - 4], [X(172), vy - 10], [X(124), vy - 8]]);
  weather(ctx, k, s > 0 ? 0 : W / 2, vy, s > 0 ? W / 2 : W, H, 60);
}

/** Effects every hull camera shares. */
function overlays(ctx, k, mount) {
  const { view, t, heat } = k;
  // shield shimmer in the corona
  if (view.mode === 'scooping' || (view.glare > 0.5 && heat > 0.6)) {
    for (let i = 0; i < 260; i++) {
      const x = hash(i, 1, Math.floor(t * 10)) * W;
      const y = 40 + Math.sin(x * 0.05 + t * 3) * 10 + hash(i, 2, 3) * 60;
      px(ctx, [140, 200, 255], x, y, 0.12 + 0.22 * clamp01(heat));
    }
  }
  // frost after the long cold of a void crossing
  if (k.sh.flight.mode === 'void') for (let i = 0; i < 300; i++) px(ctx, [220, 235, 255], hash(i, 1, 9) * W, H * 0.4 + hash(i, 2, 9) * H * 0.6, 0.5);
  // the dorsal camera sees the drive's glow behind the ship as a wash from below
  if (mount === 'dorsal' && (view.speed > 0.0005 || view.scene === 'hyperspace' || view.charging > 0)) {
    additive(ctx, () => glow(ctx, [110, 150, 255], W / 2, H + 10, 90, 0.25 + 0.3 * (view.charging || 0) + (view.scene === 'hyperspace' ? 0.3 : 0)));
  }
  ctx.fillStyle = css([0, 0, 0], 0.15);
  ctx.fillRect(0, 0, W, 2);
}
