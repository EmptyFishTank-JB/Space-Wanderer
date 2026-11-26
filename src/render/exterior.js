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
  const yaw = def.yaw ?? 0, pitch = def.pitch ?? -0.08;
  if (view.scene === 'surface') {
    drawSurfaceScene(ctx, { body: view.body, sys: view.sys, t, altitudeKm: view.altitudeKm, yaw: 0.25 + yaw, pitch: view.altitudeKm > 0 ? pitch - 0.05 : pitch + 0.12, entryHeat: view.entryHeat, buffeting: view.buffeting });
  } else {
    drawSpaceScene(ctx, view, t, { yaw, pitch, pick: true });
  }
  const shake = view.buffeting ? Math.round(Math.sin(t * 31) * 2 * view.buffeting) : 0;
  const k = { state, view, t, shake, sh: state.ship, heat: state.ship.thermal.heat, wear: state.ship.components.hull_plating.wear };
  (MOUNTS[mount] || MOUNTS.dorsal)(ctx, k);
  overlays(ctx, k, mount);
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
