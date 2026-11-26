// Planetary surfaces: skies, horizons, parallax ridges, ground clutter and
// EVA features. Used by the descent/landed hull camera and the helmet cam.
import { W, H, hex, mix, mul, css, rect, px, glow, hash, strHash, noise1, clamp01, line, disc } from './gfx.js';
import { drawStarfield, drawStar, drawBody, FOCAL } from './celestial.js';

const GROUND = {
  rocky: [128, 116, 100], metal_rich: [92, 66, 54], high_metal: [124, 106, 92], icy: [196, 210, 224],
  earth_like: [86, 112, 66], water_world: [70, 110, 140], ammonia: [150, 136, 96],
};

export function surfacePalette(body) {
  const base = GROUND[body.type] || GROUND.rocky;
  const h = body.hue ?? 0.5;
  const g = mix(base, mul(base, 0.8 + h * 0.4), 0.5);
  let skyTop = [2, 3, 8];
  let skyHor = [6, 6, 12];
  if (body.atmosphere === 'thin') { skyTop = [10, 10, 20]; skyHor = mix([60, 50, 60], g, 0.35); }
  if (body.atmosphere === 'thick') {
    if (body.type === 'earth_like') { skyTop = [40, 80, 150]; skyHor = [150, 180, 210]; }
    else if (body.type === 'ammonia') { skyTop = [90, 80, 40]; skyHor = [190, 170, 110]; }
    else { skyTop = [70, 50, 40]; skyHor = [190, 140, 100]; }
  }
  return { ground: g, far: mix(g, skyHor, 0.55), mid: mix(g, skyHor, 0.25), near: mul(g, 0.85), skyTop, skyHor, dust: mix(g, [255, 255, 255], 0.2) };
}

/**
 * opts: { body, sys, t, altitudeKm, yaw, pitch, walkX, facing (1 ahead / -1 back toward ship),
 *         features: [{kind, x}], shipX, phase, entryHeat, buffeting, local: {starElev, starAng} }
 */
export function drawSurfaceScene(ctx, o) {
  const b = o.body;
  const seed = strHash(`${o.sys.id}:${b.id}`) % 100000;
  const pal = surfacePalette(b);
  const alt = o.altitudeKm || 0;
  const hy = Math.round(H * 0.52 + (o.pitch || 0) * FOCAL + Math.min(30, alt * 1.5)); // horizon line
  const yaw = (o.yaw || 0) + (o.facing < 0 ? Math.PI : 0);
  const t = o.t;

  // sky
  for (let y = 0; y < hy; y++) {
    const k = Math.pow(y / Math.max(1, hy), 1.6);
    rect(ctx, mix(pal.skyTop, pal.skyHor, k), 0, y, W, 1);
  }
  const airless = b.atmosphere === 'none' || !b.atmosphere;
  const starDim = airless ? 1 : b.atmosphere === 'thin' ? 0.45 : 0.08;
  if (starDim > 0.05) drawStarfield(ctx, seed, yaw, 0.35, { dim: starDim, band: airless });

  // the sun in this sky
  const starAz = hash(seed, 1) * Math.PI * 2 - Math.PI;
  const starEl = 0.18 + hash(seed, 2) * 0.35;
  const aStar = b.parent === 'star' ? b.a : o.sys.byId[b.parent].a;
  const starAng = Math.asin(Math.min(1, o.sys.star.radius / Math.max(aStar, 1e-6)));
  const sb = wrap(starAz - yaw);
  if (Math.abs(sb) < 1.3) {
    const sx = W / 2 + FOCAL * Math.tan(sb);
    const sy = hy - FOCAL * Math.tan(starEl);
    drawStar(ctx, sx, sy, starAng, o.sys.star, t, airless ? 0.7 : 1.4);
  }
  // a moon's parent world dominates the sky
  if (b.parent !== 'star') {
    const pb = o.sys.byId[b.parent];
    const ang = Math.asin(Math.min(1, pb.radius / Math.max(b.a, pb.radius * 1.01)));
    const pAz = hash(seed, 3) * Math.PI * 2 - Math.PI;
    const pbB = wrap(pAz - yaw);
    if (Math.abs(pbB) < 1.4) {
      const r = FOCAL * Math.tan(Math.min(ang, 1.2));
      const light = [Math.sin(starAz - pAz), 0.2, Math.cos(starAz - pAz)];
      drawBody(ctx, W / 2 + FOCAL * Math.tan(pbB), hy - FOCAL * Math.tan(0.32 + hash(seed, 4) * 0.2), r, pb, light, seed, t);
    }
  }
  // atmospheric haze over the sky near the horizon
  if (!airless) {
    const g = ctx.createLinearGradient(0, hy - 40, 0, hy);
    g.addColorStop(0, css(pal.skyHor, 0));
    g.addColorStop(1, css(pal.skyHor, b.atmosphere === 'thick' ? 0.7 : 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(0, hy - 40, W, 40);
  }

  // ridges (far → near), scrolled by heading and walked distance
  const walk = o.walkX || 0;
  const rough = b.type === 'icy' ? 0.8 : b.atmosphere === 'thick' ? 0.7 : 1.15;
  const layers = [
    { c: pal.far, amp: 34 * rough, freq: 0.008, base: 4, par: 0.02 },
    { c: mix(pal.far, pal.mid, 0.5), amp: 22 * rough, freq: 0.016, base: 1, par: 0.05 },
    { c: pal.mid, amp: 12 * rough, freq: 0.03, base: 0, par: 0.1 },
  ];
  const flat = Math.min(1, alt / 25);
  for (const [li, L] of layers.entries()) {
    for (let x = 0; x < W; x++) {
      const wx = x + yaw * 160 * (li + 1) + walk * L.par * (o.facing < 0 ? -1 : 1);
      const n = noise1(wx * L.freq, seed + li * 13) * 0.7 + noise1(wx * L.freq * 3.1, seed + li * 29) * 0.3;
      const n2 = noise1((wx + 1) * L.freq, seed + li * 13) * 0.7 + noise1((wx + 1) * L.freq * 3.1, seed + li * 29) * 0.3;
      const h = Math.round((n * L.amp + L.base) * (1 - flat * 0.8));
      rect(ctx, L.c, x, hy - h, 1, h + 1);
      // sunlit faces catch a lighter edge
      if (n2 < n) rect(ctx, mix(L.c, [255, 245, 225], 0.18), x, hy - h, 1, 2);
    }
  }
  // ground
  for (let y = hy; y < H; y++) {
    const k = (y - hy) / (H - hy);
    rect(ctx, mix(pal.mid, pal.near, Math.min(1, k * 1.4)), 0, y, W, 1);
  }
  // ground clutter with perspective (rocks / ice blocks), moving as we walk
  const camH = 1.7 + alt * 1000;
  for (let i = 0; i < 90; i++) {
    const u = (hash(i, 1, seed) - 0.5) * 60;
    const zBase = hash(i, 2, seed) * 80;
    const z = ((zBase - walk * (o.facing < 0 ? -1 : 1)) % 80 + 80) % 80 + 1.5;
    const zz = z + alt * 3000 * hash(i, 4, seed);
    const sy = hy + (camH * FOCAL) / (zz * 4.5);
    if (sy > H + 4) continue;
    const sx = W / 2 + ((u + yaw * 20) * FOCAL) / zz;
    const s = Math.max(1, (0.5 + hash(i, 3, seed)) * FOCAL / zz * 0.35);
    if (sx < -10 || sx > W + 10) continue;
    rect(ctx, mul(pal.near, 0.7), sx - s / 2, sy - s / 2, s, Math.max(1, s * 0.6));
    if (s > 2) rect(ctx, mul(pal.near, 1.15), sx - s / 2, sy - s / 2, Math.max(1, s * 0.5), 1);
  }

  // EVA features ahead
  if (o.features) {
    for (const f of [...o.features].sort((a, c) => (c.x - walk) - (a.x - walk))) {
      const d = (f.x - walk) * (o.facing < 0 ? -1 : 1);
      if (d < 1.5 || d > 260) continue;
      drawFeature(ctx, f, d, hy, seed, pal, t, camH);
    }
  }
  // our lander, behind us on the way back (or seen from the hull cam)
  if (o.shipX !== undefined) {
    const d = o.facing < 0 ? walk - o.shipX : -1;
    if (d > 3 && d < 600) drawLander(ctx, W / 2 + 18, hy + (camH * FOCAL) / (d * 4.5), FOCAL / d, t);
  }

  // descent effects
  if (o.entryHeat > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    const k = clamp01(o.entryHeat * 2);
    for (let i = 0; i < 40; i++) {
      const x = hash(i, Math.floor(t * 12), 3) * W;
      line(ctx, [255, 140, 60], x, H, x + (x - W / 2) * 0.3, H - 30 - hash(i, 2, 3) * 60, 0.25 * k);
    }
    glow(ctx, [255, 110, 40], W / 2, H + 40, 200, 0.5 * k);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (b.atmosphere === 'thick' && alt > 1 && alt < 30) {
    // cloud deck rushing past
    for (let i = 0; i < 14; i++) {
      const cx = ((hash(i, 1, seed) * W * 2 - t * (30 + 40 * hash(i, 2, seed))) % (W * 1.5) + W * 1.5) % (W * 1.5) - W * 0.25;
      const cy = hy - 30 + hash(i, 3, seed) * 80;
      for (let k = 0; k < 6; k++) disc(ctx, [235, 235, 240], cx + k * 9, cy + Math.sin(k) * 3, 6 + hash(i, k, 9) * 6, 0.18);
    }
  }
  return { horizonY: hy };
}

function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }

function drawFeature(ctx, f, d, hy, seed, pal, t, camH) {
  const sy = hy + (camH * FOCAL) / (d * 4.5);
  const k = FOCAL / d; // pixels per meter at that distance
  const sx = W / 2 + (hash(strHash(f.kind), 7, seed) - 0.5) * 40 + (f.x % 7) - 3;
  switch (f.kind) {
    case 'outcrop': {
      for (let i = 0; i < 4; i++) rect(ctx, mul(pal.near, 0.7 + i * 0.1), sx - 3 * k + i * k * 0.4, sy - (4 - i) * k * 0.6, 6 * k - i * k * 0.8, k * 0.6);
      break;
    }
    case 'crater_rim': rect(ctx, mul(pal.mid, 0.8), sx - 12 * k, sy - 1.2 * k, 24 * k, 1.2 * k); break;
    case 'regolith_plain': break;
    case 'ice_ridge': {
      for (let i = -6; i <= 6; i++) { const h = (2 + hash(i, 1, seed) * 3) * k; rect(ctx, mix([220, 235, 250], [160, 190, 220], hash(i, 2, seed)), sx + i * k, sy - h, Math.max(1, k), h); }
      break;
    }
    case 'dune': for (let x = -15; x <= 15; x++) { const h = Math.cos(x / 15 * 1.5) * 1.5 * k; rect(ctx, mul(pal.mid, 1.05), sx + x * k, sy - h, Math.max(1, k), h); } break;
    case 'geyser': case 'fumarole': {
      rect(ctx, mul(pal.near, 0.6), sx - 1.5 * k, sy - 0.5 * k, 3 * k, 0.5 * k);
      const tall = f.kind === 'geyser' ? 14 : 5;
      const pulse = f.kind === 'geyser' ? Math.max(0, Math.sin(t * 0.4)) : 0.6;
      for (let i = 0; i < 40; i++) {
        const h = hash(i, 1, 9) * tall * k * pulse;
        const w = (hash(i, 2, 9) - 0.5) * (1 + h / k * 0.3) * k;
        px(ctx, [230, 235, 240], sx + w + Math.sin(t + i) * 0.5, sy - h - ((t * 6 + i * 3) % (tall * k + 1)) * 0.1, 0.45);
      }
      break;
    }
    case 'bio_mat': {
      for (let i = 0; i < 30; i++) {
        const c = mix([90, 140, 60], [170, 80, 120], hash(i, 3, seed));
        rect(ctx, c, sx + (hash(i, 1, seed) - 0.5) * 10 * k, sy - hash(i, 2, seed) * 0.6 * k, Math.max(1, k * 0.8), Math.max(1, k * 0.3));
      }
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, [80, 160, 120], sx, sy, 8 * k, 0.08 + 0.04 * Math.sin(t * 0.7));
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'crystalline_spires': {
      for (let i = -3; i <= 3; i++) {
        const h = (3 + hash(i, 4, seed) * 6) * k;
        const x = sx + i * 1.6 * k;
        for (let y = 0; y < h; y++) rect(ctx, mix([180, 200, 240], [120, 140, 200], y / h), x - (1 - y / h) * 0.6 * k, sy - y, Math.max(1, (1 - y / h) * 1.2 * k), 1);
        px(ctx, [255, 255, 255], x, sy - h, 0.5 + 0.5 * Math.sin(t * 2 + i));
      }
      break;
    }
    case 'patterned_vents': case 'unexplained_signal': {
      for (let i = -2; i <= 2; i++) for (let j = 0; j < 2; j++) {
        rect(ctx, mul(pal.near, 0.4), sx + i * 2.5 * k, sy - j * 0.8 * k, Math.max(1, k * 0.8), Math.max(1, k * 0.3));
        if (f.kind === 'patterned_vents') px(ctx, [255, 200, 140], sx + i * 2.5 * k, sy - j * 0.8 * k - 1, 0.3 + 0.3 * Math.sin(t + i));
      }
      break;
    }
    default: break;
  }
}

export function drawLander(ctx, x, y, k, t) {
  // small side-on silhouette of the ship on its landing struts
  const s = Math.max(0.15, k * 0.1);
  const body = [150, 152, 160];
  rect(ctx, mul(body, 0.7), x - 14 * s, y - 6 * s, 28 * s, 5 * s);
  rect(ctx, body, x - 10 * s, y - 9 * s, 18 * s, 4 * s);
  rect(ctx, [40, 40, 46], x - 14 * s, y - 1 * s, 2 * s, 1 * s + 1);
  rect(ctx, [40, 40, 46], x + 12 * s, y - 1 * s, 2 * s, 1 * s + 1);
  px(ctx, [255, 80, 60], x + 14 * s, y - 7 * s, 0.5 + 0.5 * Math.sin(t * 3));
}
