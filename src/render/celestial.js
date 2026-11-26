// Celestial painting: starfield, stars, planets (textured spheres with
// terminators, atmospheres, clouds and rings), hyperspace, the void.
import { W, H, hex, mix, mul, css, rect, px, glow, hash, strHash, fbm3, noise3, clamp01, line, text } from './gfx.js';
import { registerSkyPick } from './picks.js';

export const FOV = 1.25; // horizontal field of view (radians)
export const FOCAL = W / 2 / Math.tan(FOV / 2);

/** Project a direction to screen (bearing right-positive, elev up-positive). */
export function project(bearing, elev, yaw = 0, pitch = 0) {
  const b = bearing - yaw;
  if (Math.abs(b) > 1.45) return null;
  return { x: W / 2 + FOCAL * Math.tan(b), y: H / 2 - FOCAL * Math.tan(elev - pitch) };
}
export const angToPx = (a) => FOCAL * Math.tan(Math.min(a, 1.5));

// ───────────────────────── starfield ─────────────────────────
const FIELD = [];
for (let i = 0; i < 1400; i++) {
  const az = hash(i, 1, 77) * Math.PI * 2 - Math.PI;
  const el = Math.asin(hash(i, 2, 77) * 2 - 1) * 0.9;
  const m = hash(i, 3, 77);
  const tint = hash(i, 4, 77);
  FIELD.push({ az, el, m: m * m * m, c: tint < 0.15 ? [255, 210, 170] : tint < 0.3 ? [180, 200, 255] : [235, 235, 245] });
}

/**
 * Background sky. With `sky` (render/sky.js) it is the real sky from this
 * system: the galactic band along the galactic plane, brightest toward the
 * core; nearby nebulae; the faint distant field; and the neighboring stars
 * by their true direction, brightness and color, so the same patterns hold
 * from system to system and drift as the ship travels. Without it (the
 * ground view, the gallery) it falls back to the old per-system sky.
 */
export function drawStarfield(ctx, seed, yaw, pitch, { speed = 0, dim = 1, band = true, sky = null, chart = false } = {}) {
  const rot = sky ? 0 : (seed % 1000) / 1000 * Math.PI * 2;
  const wrapA = (b) => ((b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  const toScreen = (az, el) => {
    const b = wrapA(az - yaw + rot);
    if (Math.abs(b) > FOV / 2 + 0.3) return null;
    return [W / 2 + FOCAL * Math.tan(b), H / 2 - FOCAL * Math.tan(el - pitch)];
  };
  if (sky) drawNebulae(ctx, sky, toScreen, yaw, pitch, dim, 'behind');
  if (band) {
    for (let x = 0; x < W; x += 2) {
      const az = Math.atan((x - W / 2) / FOCAL) + yaw - rot;
      const el0 = sky ? 0.03 * Math.sin(2 * az + 0.4) : 0.25 * Math.sin(az * 1.0 + 0.7);
      const core = sky ? 0.45 + 1.1 * Math.max(0, Math.cos(az - sky.coreAz)) ** 3 : 1;
      const cy = H / 2 - FOCAL * Math.tan(el0 - pitch);
      const n7 = sky ? Math.round(5 + 6 * core) : 7;
      for (let k = 0; k < n7; k++) {
        const y = cy + (hash(x, k, sky ? 11 : seed) - 0.5) * 50 * (sky ? 0.7 + 0.5 * core : 1);
        const n = noise3(x * 0.05 + (sky ? az * 9 : 0), y * 0.05, sky ? 31 : seed % 97, 5);
        if (n > 0.55) px(ctx, sky ? [128, 118, 150] : [110, 105, 140], x, y, Math.min(0.6, (n - 0.55) * 0.9 * dim * core));
      }
    }
  }
  const fieldK = sky ? 0.55 : 1;
  for (const s of FIELD) {
    const p = toScreen(s.az, s.el);
    if (!p) continue;
    const [x, y] = p;
    if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
    const a = (0.25 + 0.75 * s.m) * dim * fieldK;
    if (speed > 0.02) {
      // supercruise streaks: radial from the center of travel
      const dx = x - W / 2, dy = y - H / 2;
      const k = speed * 0.18;
      line(ctx, s.c, x, y, x + dx * k, y + dy * k, a * 0.8);
    } else {
      px(ctx, s.c, x, y, a);
      if (!sky && s.m > 0.85) { px(ctx, s.c, x - 1, y, a * 0.35); px(ctx, s.c, x + 1, y, a * 0.35); px(ctx, s.c, x, y - 1, a * 0.35); px(ctx, s.c, x, y + 1, a * 0.35); }
    }
  }
  if (!sky) return;
  // the neighbors: real directions, real colors, brighter when nearer and more luminous
  for (const st of sky.stars) {
    const p = toScreen(st.az, st.el);
    if (!p) continue;
    const [x, y] = p;
    if (x < -3 || x > W + 3 || y < -3 || y > H + 3) continue;
    const a = Math.min(1, (0.3 + (MAG_FAINT - st.m) / 6)) * dim * (st.pulsar ? 0.6 + 0.4 * Math.sin(performanceT() * 9 + st.az * 50) : 1);
    if (speed > 0.02) { const dx = x - W / 2, dy = y - H / 2; line(ctx, st.c, x, y, x + dx * speed * 0.2, y + dy * speed * 0.2, a); continue; }
    px(ctx, mix(st.c, [255, 255, 255], 0.35), x, y, a);
    if (st.m < 3.2) { px(ctx, st.c, x - 1, y, a * 0.45); px(ctx, st.c, x + 1, y, a * 0.45); px(ctx, st.c, x, y - 1, a * 0.45); px(ctx, st.c, x, y + 1, a * 0.45); }
    if (st.m < 1.4) {
      ctx.globalCompositeOperation = 'lighter';
      glow(ctx, st.c, x, y, 5 + (1.4 - st.m) * 2, 0.25 * dim);
      ctx.globalCompositeOperation = 'source-over';
      px(ctx, st.c, x - 2, y, a * 0.25); px(ctx, st.c, x + 2, y, a * 0.25); px(ctx, st.c, x, y - 2, a * 0.25); px(ctx, st.c, x, y + 2, a * 0.25);
    }
  }
  drawNebulae(ctx, sky, toScreen, yaw, pitch, dim, 'dark');
  if (chart && sky.asterisms) {
    // star chart overlay (with telemetry on): faint figure lines and their names
    for (const a of sky.asterisms) {
      const pts = a.stars.map((s) => toScreen(s.az, s.el));
      if (pts.some((q) => !q)) continue;
      for (let i = 0; i < pts.length - 1; i++) line(ctx, [120, 200, 170], pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0.22);
      // name it at its first star that is comfortably on screen
      const lab = pts.find(([x, y]) => x > 4 && x < W - 70 && y > 10 && y < H - 6);
      if (lab) text(ctx, a.name, lab[0] + 4, lab[1] - 7, [150, 230, 195], 0.8);
    }
  }
}

const MAG_FAINT = 6.2;
const performanceT = () => (typeof performance !== 'undefined' ? performance.now() / 1000 : 0);

/** Nebulae: emission, reflection and planetary glow behind the stars; dark clouds over them. */
function drawNebulae(ctx, sky, toScreen, yaw, pitch, dim, pass) {
  for (const n of sky.nebulae) {
    const dark = n.kind === 'dark';
    if ((pass === 'dark') !== dark) continue;
    const seed = strHash(n.id);
    if (n.inside) {
      // inside the cloud: a tint everywhere and wisps drifting across the view
      ctx.globalCompositeOperation = dark ? 'source-over' : 'lighter';
      ctx.fillStyle = css(n.color, (dark ? 0.35 : 0.07) * dim * (0.6 + 0.4 * n.depth));
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 18; i++) {
        const p = toScreen(hash(i, 1, seed) * Math.PI * 2 - Math.PI, (hash(i, 2, seed) - 0.5) * 1.2);
        if (!p) continue;
        glow(ctx, mix(n.color, [255, 255, 255], 0.15 * hash(i, 4, seed)), p[0], p[1], 30 + 70 * hash(i, 3, seed), (dark ? 0.3 : 0.12) * dim);
      }
      ctx.globalCompositeOperation = 'source-over';
      continue;
    }
    const c = toScreen(n.az, n.el);
    if (!c) continue;
    const R = FOCAL * Math.tan(Math.min(n.ang, 1.2));
    if (c[0] + R < 0 || c[0] - R > W || c[1] + R < 0 || c[1] - R > H) continue;
    ctx.globalCompositeOperation = dark ? 'source-over' : 'lighter';
    if (n.kind === 'planetary') {
      // a small shell around a dying star: a ring, brighter at the rim
      for (let a = 0; a < Math.PI * 2; a += 0.12) glow(ctx, n.color, c[0] + Math.cos(a) * R * 0.8, c[1] + Math.sin(a) * R * 0.65, Math.max(1.5, R * 0.35), 0.1 * n.bright * dim);
      px(ctx, [230, 240, 255], c[0], c[1], 0.9 * dim);
    } else {
      // a clumpy cloud: overlapping glows placed by the nebula's own hash, sculpted by noise
      const k = Math.round(10 + 14 * Math.min(1, R / 60));
      for (let i = 0; i < k; i++) {
        const ang = hash(i, 1, seed) * Math.PI * 2, rr = Math.sqrt(hash(i, 2, seed)) * R * (0.6 + 0.4 * n.shape);
        const x = c[0] + Math.cos(ang) * rr * 1.3, y = c[1] + Math.sin(ang) * rr * 0.75;
        const w = noise3(x * 0.03, y * 0.03, seed % 53, 4);
        const col = mix(n.color, n.kind === 'emission' ? [255, 170, 120] : [200, 220, 255], 0.3 * hash(i, 3, seed));
        glow(ctx, col, x, y, R * (0.25 + 0.4 * hash(i, 4, seed)), (dark ? 0.35 : 0.11) * n.bright * dim * (0.5 + w));
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

// ───────────────────────── stars ─────────────────────────
export function drawStar(ctx, x, y, angR, star, t, glareK = 1) {
  const c = hex(star.color);
  const r = angToPx(angR);
  if (star.variant === 'PSR') {
    // a pulsar: a hard point, and two beams sweeping round as it turns, flickering at the spin rate
    const spin = star.spinS || 0.5;
    const flick = 0.55 + 0.45 * Math.abs(Math.sin((Math.PI * t) / spin));
    const a = t * 0.35;
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, [170, 190, 255], x, y, 14 * glareK, 0.5 * flick);
    for (const s of [1, -1]) {
      for (let w = -1; w <= 1; w++) line(ctx, [170, 200, 255], x, y, x + Math.cos(a) * 160 * s + w, y + Math.sin(a) * 60 * s, (w ? 0.12 : 0.3) * flick);
    }
    ctx.globalCompositeOperation = 'source-over';
    px(ctx, [255, 255, 255], x, y);
    return;
  }
  if (star.cls === 'BH') {
    // a black hole: a lensed ring, nothing more
    const rr = Math.max(3, r * 30);
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, [140, 120, 180], x, y, rr * 1.6, 0.25);
    ctx.globalCompositeOperation = 'source-over';
    for (let a = 0; a < Math.PI * 2; a += 0.05) px(ctx, [200, 180, 255], x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.35, 0.7);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, rr * 0.7, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.globalCompositeOperation = 'lighter';
  const lumK = Math.min(1, 0.35 + 0.15 * Math.log10(1 + (star.lum || 0.01) * 10));
  glow(ctx, c, x, y, Math.max(6, r * 3.2 + 10 * lumK) * glareK, 0.55 * lumK);
  glow(ctx, [255, 255, 255], x, y, Math.max(3, r * 1.4), 0.6);
  ctx.globalCompositeOperation = 'source-over';
  if (r < 1.2) {
    px(ctx, [255, 255, 255], x, y);
    px(ctx, c, x - 1, y, 0.7); px(ctx, c, x + 1, y, 0.7); px(ctx, c, x, y - 1, 0.7); px(ctx, c, x, y + 1, 0.7);
    return;
  }
  // limb-darkened, granulated disc
  const R = Math.min(r, 900);
  const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(W - 1, Math.ceil(x + R));
  const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(H - 1, Math.ceil(y + R));
  if (x1 < x0 || y1 < y0) return;
  const img = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const d = img.data;
  const hot = mix(c, [255, 250, 235], 0.35);
  const cool = star.variant === 'Y';
  const limbC = cool ? mul(c, 0.55) : mix(c, [255, 100, 25], 0.55);
  const tt = t * 0.15;
  const giant = star.variant === 'RG' || star.variant === 'C';
  const gs = Math.max(0.25, Math.min(0.6, 40 / R)) * (giant ? 0.55 : 1); // granulation tracks apparent size; giants churn in huge cells
  const soot = star.variant === 'C'; // carbon stars: dark sooty patches drifting over the disc
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const dx = (i - x) / R, dy = (j - y) / R;
      const q = dx * dx + dy * dy;
      if (q > 1) continue;
      const mu = Math.sqrt(1 - q);
      const n1 = noise3(i * gs + tt, j * gs, tt * 0.7, 9);
      const n2 = noise3(i * gs * 0.23 - tt * 0.3, j * gs * 0.23, 3, 12);
      const lane = Math.abs(n1 - 0.5) < 0.035 ? 0.9 : 1; // dark intergranular lanes
      const gran = (0.86 + 0.18 * n1 + 0.1 * (n2 - 0.5)) * lane;
      const k = (0.5 + 0.5 * mu) * gran * (soot && n2 > 0.58 ? 0.55 : 1) * (cool ? 0.45 : 1);
      const col = mix(limbC, hot, Math.pow(mu, 0.7));
      const o = ((j - y0) * (x1 - x0 + 1) + (i - x0)) * 4;
      d[o] = Math.min(255, col[0] * k + (cool ? 0 : 20)); d[o + 1] = Math.min(255, col[1] * k + (cool ? 0 : 10)); d[o + 2] = Math.min(255, col[2] * k); d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
  const flareC = mix(c, [255, 120, 60], 0.5); // prominences take the star's own color
  if (star.variant === 'WR') wolfRayetShells(ctx, x, y, R, t);
  if (R > 30) {
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 14; k++) {
      const a = hash(k, 1, 61) * Math.PI * 2 + t * 0.01;
      const hgt = (0.03 + 0.06 * hash(k, 2, 61)) * R * (0.7 + 0.3 * Math.sin(t * 0.3 + k));
      for (let h = 0; h < hgt; h += 1) {
        const rr = R + h;
        const aa = a + Math.sin(h / hgt * Math.PI) * 0.02;
        px(ctx, flareC, x + Math.cos(aa) * rr, y + Math.sin(aa) * rr, 0.5 * (1 - h / hgt));
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** Wolf-Rayet: the star is shedding itself; shells of gas expand away from it. */
function wolfRayetShells(ctx, x, y, R, t) {
  ctx.globalCompositeOperation = 'lighter';
  const base = Math.max(14, R * 2.2);
  for (let i = 0; i < 3; i++) {
    const rr = base * (1 + i * 0.7) + ((t * 0.6) % (base * 0.7));
    for (let a = 0; a < Math.PI * 2; a += 0.03) {
      const n = noise3(Math.cos(a) * 3 + i, Math.sin(a) * 3, i * 7, 61);
      if (n < 0.45) continue;
      px(ctx, mix([150, 180, 255], [210, 120, 255], i / 3), x + Math.cos(a) * rr * (0.9 + 0.2 * n), y + Math.sin(a) * rr * (0.9 + 0.2 * n), (n - 0.45) * 0.8 / (1 + i));
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ───────────────────────── planets ─────────────────────────
const TEX_W = 384, TEX_H = 192;
const texCache = new Map();

function typePalette(b) {
  const h = b.hue ?? 0.5;
  switch (b.type) {
    case 'gas_giant': return { a: mix([214, 186, 140], [170, 140, 110], h), b: mix([176, 120, 80], [200, 150, 110], h), c: [236, 222, 196], storm: [196, 110, 70] };
    case 'ice_giant': return { a: mix([120, 190, 210], [100, 150, 220], h), b: mix([150, 210, 220], [130, 170, 230], h), c: [200, 235, 240] };
    case 'earth_like': return { ocean: [30, 70, 130], shallow: [50, 110, 150], land: mix([70, 110, 60], [120, 120, 70], h), desert: [170, 150, 100], ice: [235, 240, 245] };
    case 'water_world': return { ocean: mix([25, 60, 120], [30, 80, 110], h), shallow: [60, 120, 160], land: [60, 120, 160], desert: [60, 120, 160], ice: [220, 235, 245] };
    case 'ammonia': return { a: mix([170, 150, 100], [150, 160, 110], h), b: [120, 110, 80], c: [200, 190, 150] };
    case 'icy': return { base: mix([210, 222, 235], [190, 205, 225], h), dark: [140, 160, 180] };
    case 'metal_rich': return { base: mix([110, 80, 65], [95, 85, 80], h), dark: [55, 40, 35] };
    case 'high_metal': return { base: mix([140, 120, 100], [130, 110, 105], h), dark: [80, 65, 55] };
    default: return { base: mix([140, 130, 115], [120, 115, 110], h), dark: [75, 70, 65] };
  }
}

function surface(b, pal, s, x, y, z) {
  switch (b.type) {
    case 'gas_giant': case 'ice_giant': case 'ammonia': {
      const turb = fbm3(x * 2, y * 2, z * 2, s, 3);
      const band = Math.sin(y * (b.type === 'ice_giant' ? 7 : 16) + turb * 5);
      const u = band * 0.5 + 0.5;
      let c = u < 0.5 ? mix(pal.b, pal.c, u * 2) : mix(pal.c, pal.a, (u - 0.5) * 2);
      c = mix(c, pal.c, (fbm3(x * 6, y * 9, z * 6, s + 3, 2) - 0.5) * 0.6 + 0.2);
      if (pal.storm) {
        const sx = x - 0.6, sy = y + 0.35, sz = z - 0.7;
        if (sx * sx + sy * sy * 4 + sz * sz < 0.035) c = mix(c, pal.storm, 0.7);
      }
      return c;
    }
    case 'earth_like': case 'water_world': {
      const h = fbm3(x * 1.8, y * 1.8, z * 1.8, s, 4);
      const lat = Math.abs(y);
      if (lat > 0.88 - (h - 0.5) * 0.2) return pal.ice;
      if (h < 0.53) return mix(pal.ocean, pal.shallow, clamp01((h - 0.42) / 0.11));
      return mix(pal.land, pal.desert, clamp01((0.5 - lat) * fbm3(x * 4, y * 4, z * 4, s + 7, 2)));
    }
    case 'icy': {
      const n = fbm3(x * 3, y * 3, z * 3, s, 3);
      const crack = Math.abs(noise3(x * 9, y * 9, z * 9, s + 11) - 0.5) < 0.03;
      return crack ? pal.dark : mix(pal.base, pal.dark, (n - 0.5) * 0.6 + 0.1);
    }
    default: {
      const n = fbm3(x * 3, y * 3, z * 3, s, 4);
      let c = mix(pal.base, pal.dark, clamp01((n - 0.35) * 1.4));
      // craters
      for (let k = 0; k < 9; k++) {
        const cx = hash(k, 1, s) * 2 - 1, cy = hash(k, 2, s) * 2 - 1, cz = hash(k, 3, s) * 2 - 1;
        const cl = Math.hypot(cx, cy, cz) || 1;
        const dot = (x * cx + y * cy + z * cz) / cl;
        const rad = 0.06 + hash(k, 4, s) * 0.12;
        const rim = 1 - dot;
        if (rim < rad * rad * 0.5) c = mul(c, rim < rad * rad * 0.35 ? 0.82 : 1.12);
      }
      return c;
    }
  }
}

/** Equirectangular texture per body, computed once. */
function texture(b, sysSeed) {
  const key = `${sysSeed}:${b.id}`;
  let t = texCache.get(key);
  if (t) return t;
  const s = strHash(key) % 100000;
  const pal = typePalette(b);
  const data = new Uint8ClampedArray(TEX_W * TEX_H * 3);
  const clouds = new Uint8ClampedArray(TEX_W * TEX_H);
  const cloudy = b.atmosphere === 'thick' && !['gas_giant', 'ice_giant'].includes(b.type);
  for (let j = 0; j < TEX_H; j++) {
    const lat = (j / (TEX_H - 1) - 0.5) * Math.PI;
    for (let i = 0; i < TEX_W; i++) {
      const lon = (i / TEX_W) * Math.PI * 2;
      const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon);
      const c = surface(b, pal, s, x, y, z);
      const o = (j * TEX_W + i) * 3;
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
      if (cloudy) clouds[j * TEX_W + i] = clamp01((fbm3(x * 3 + 4, y * 5, z * 3, s + 50, 4) - 0.52) * 3) * 230;
    }
  }
  t = { data, clouds: cloudy ? clouds : null };
  if (texCache.size > 48) texCache.delete(texCache.keys().next().value);
  texCache.set(key, t);
  return t;
}

const ATMO = { thin: 0.35, thick: 0.8, giant: 0.6 };
const planetCanvasCache = new Map();

function ringGeom(b, sysSeed) {
  const h = strHash(`${sysSeed}:${b.id}:ring`);
  return { flat: 0.18 + hash(h, 1) * 0.22, tilt: (hash(h, 2) - 0.5) * 0.5, inner: 1.35, outer: 2.2 + hash(h, 3) * 0.4, tint: mix([200, 185, 160], [170, 175, 185], hash(h, 4)) };
}

/**
 * Draw a body at screen (x, y) with pixel radius r. `light` is the unit
 * direction to the star in view space (x right, y up, z toward viewer).
 */
export function drawBody(ctx, x, y, r, b, light, sysSeed, t) {
  const pal = typePalette(b);
  if (r < 1.2) {
    const base = pal.a || pal.ocean || pal.base;
    const lit = clamp01(0.3 + 0.7 * (light[2] * 0.5 + 0.5));
    px(ctx, mul(base, 0.5 + lit), x, y, Math.min(1, 0.4 + r));
    return;
  }
  const ring = b.rings ? ringGeom(b, sysSeed) : null;
  const ext = ring ? r * ring.outer : r * 1.08;
  const bx0 = Math.max(0, Math.floor(x - ext)), bx1 = Math.min(W - 1, Math.ceil(x + ext));
  const by0 = Math.max(0, Math.floor(y - ext)), by1 = Math.min(H - 1, Math.ceil(y + ext));
  if (bx1 < bx0 || by1 < by0) return;
  const spinKey = Math.floor(t / 20);
  const key = `${sysSeed}:${b.id}:${Math.round(x)}:${Math.round(y)}:${Math.round(r * 2)}:${light.map((v) => Math.round(v * 40)).join(',')}:${spinKey}`;
  let cached = planetCanvasCache.get(b.id);
  if (!cached || cached.key !== key) {
    const cw = bx1 - bx0 + 1, ch = by1 - by0 + 1;
    const cv = (cached && cached.canvas.width === cw && cached.canvas.height === ch) ? cached.canvas : makeCanvas(cw, ch);
    const cctx = cv.getContext('2d');
    const img = cctx.createImageData(cw, ch);
    paintBody(img.data, cw, ch, bx0, by0, x, y, r, b, light, sysSeed, t, ring);
    cctx.putImageData(img, 0, 0);
    cached = { key, canvas: cv };
    planetCanvasCache.set(b.id, cached);
    if (planetCanvasCache.size > 24) planetCanvasCache.delete(planetCanvasCache.keys().next().value);
  }
  ctx.drawImage(cached.canvas, bx0, by0);
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
export { makeCanvas };

function sampleTex(data, u, v) {
  const i0 = Math.floor(u), j0 = Math.floor(v);
  const i1 = (i0 + 1) % TEX_W, j1 = Math.min(TEX_H - 1, j0 + 1);
  const fu = u - i0, fv = v - j0;
  const a = (j0 * TEX_W + i0) * 3, b = (j0 * TEX_W + i1) * 3, c = (j1 * TEX_W + i0) * 3, d = (j1 * TEX_W + i1) * 3;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) out[k] = (data[a + k] * (1 - fu) + data[b + k] * fu) * (1 - fv) + (data[c + k] * (1 - fu) + data[d + k] * fu) * fv;
  return out;
}
function sampleCloud(data, u, v) {
  const i0 = Math.floor(u), j0 = Math.floor(v);
  const i1 = (i0 + 1) % TEX_W, j1 = Math.min(TEX_H - 1, j0 + 1);
  const fu = u - i0, fv = v - j0;
  return (data[j0 * TEX_W + i0] * (1 - fu) + data[j0 * TEX_W + i1] * fu) * (1 - fv) + (data[j1 * TEX_W + i0] * (1 - fu) + data[j1 * TEX_W + i1] * fu) * fv;
}

function paintBody(d, cw, ch, bx0, by0, x, y, r, b, light, sysSeed, t, ring) {
  const tex = texture(b, sysSeed);
  const spin = (t / 600) % (Math.PI * 2) + hash(strHash(b.id), 9) * 6;
  const cloudSpin = spin * 1.35;
  const atmo = ATMO[b.atmosphere] || 0;
  const pal = typePalette(b);
  const rimC = b.type === 'earth_like' || b.type === 'water_world' ? [120, 170, 255] : mix(pal.c || pal.base || [200, 200, 220], [200, 220, 255], 0.5);
  const [lx, ly, lz] = light;
  const ll = Math.hypot(lx, ly, lz) || 1;
  const Lx = lx / ll, Ly = ly / ll, Lz = lz / ll;
  const cosT = Math.cos(ring ? ring.tilt : 0), sinT = Math.sin(ring ? ring.tilt : 0);
  for (let j = 0; j < ch; j++) {
    const sy = by0 + j;
    for (let i = 0; i < cw; i++) {
      const sx = bx0 + i;
      const dx = (sx - x) / r, dy = (sy - y) / r;
      const q = dx * dx + dy * dy;
      const o = (j * cw + i) * 4;
      let col = null;
      let alpha = 0;
      // ring coordinates
      let ringA = 0, ringFront = false, ringC = null;
      if (ring) {
        const u = dx * cosT + dy * sinT;
        const v = -dx * sinT + dy * cosT;
        const rr = Math.sqrt(u * u + (v / ring.flat) * (v / ring.flat));
        if (rr > ring.inner && rr < ring.outer) {
          const band = noise3(rr * 14, 0, 0, 3);
          ringA = clamp01(0.25 + band * 0.75) * (rr < ring.inner + 0.12 ? 0.5 : 1) * (Math.abs(rr - (ring.inner + ring.outer) * 0.55) < 0.05 ? 0.2 : 1);
          ringFront = v > 0;
          ringC = mul(ring.tint, 0.55 + 0.6 * clamp01(Lz * 0.5 + 0.6));
        }
      }
      if (q <= 1) {
        const nz = Math.sqrt(1 - q);
        const nx = dx, ny = -dy;
        // texture lookup on the rotating sphere
        const lon = Math.atan2(nz, nx) + spin;
        const lat = Math.asin(Math.max(-1, Math.min(1, ny)));
        const fu = (((lon / (Math.PI * 2)) * TEX_W) % TEX_W + TEX_W) % TEX_W;
        const fv = Math.max(0, Math.min(TEX_H - 1.001, (lat / Math.PI + 0.5) * (TEX_H - 1)));
        let c = sampleTex(tex.data, fu, fv);
        // fine surface detail so close approaches never look like a blown-up texture
        if (r > 120) c = mul(c, 0.93 + 0.14 * noise3(nx * r * 0.12, ny * r * 0.12, nz * r * 0.12, 17));
        if (tex.clouds) {
          const cu = ((((Math.atan2(nz, nx) + cloudSpin) / (Math.PI * 2)) * TEX_W) % TEX_W + TEX_W) % TEX_W;
          const ca = sampleCloud(tex.clouds, cu, fv) / 255;
          if (ca > 0) c = mix(c, [240, 242, 245], ca);
        }
        const lam = nx * Lx + ny * Ly + nz * Lz;
        const shade = clamp01(lam * 1.05 + 0.04);
        col = mul(c, 0.06 + shade);
        // terminator glow & atmosphere rim
        if (atmo > 0) {
          const rim = Math.pow(1 - nz, 3) * atmo;
          col = mix(col, rimC, rim * clamp01(lam + 0.35));
        }
        // planet shadow on rings is skipped; ring in front over the disc
        if (ringA > 0 && ringFront) col = mix(col, ringC, ringA * 0.85);
        alpha = 1;
      } else {
        if (atmo > 0 && q < 1.12) {
          const k = (1 - (Math.sqrt(q) - 1) / 0.06) * atmo * 0.55;
          const lamEdge = clamp01(dx * Lx - dy * Ly + 0.3);
          if (k > 0) { col = rimC; alpha = clamp01(k * lamEdge); }
        }
        if (ringA > 0) { col = col ? mix(col, ringC, ringA) : ringC; alpha = Math.max(alpha, ringA * 0.9); }
      }
      if (col) { d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = alpha * 255; }
    }
  }
}

// ───────────────────────── scenes ─────────────────────────
/**
 * Paint the space scene for a view model into the full frame.
 * `yaw` turns the virtual camera (each room's viewports look a different way).
 */
export function drawSpaceScene(ctx, view, t, { yaw = 0, pitch = 0, parallax = 0, pick = false } = {}) {
  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, W, H);
  if (view.scene === 'void') { drawVoid(ctx, t, yaw); return; }
  if (view.scene === 'hyperspace') { drawHyperspace(ctx, view, t); return; }
  const y0 = yaw + parallax;
  drawStarfield(ctx, view.seed, view.heading + y0, pitch, { speed: view.speed, sky: view.sky, chart: view.chart });
  for (const o of view.objects) {
    const p = project(o.bearing, o.elev, y0, pitch);
    if (!p) continue;
    const r = angToPx(o.angR);
    if (p.x + r < -W || p.x - r > 2 * W) continue;
    if (pick && p.x > -r && p.x < W + r) registerSkyPick(o, p.x, p.y, r, view.sys);
    if (o.kind === 'star') drawStar(ctx, p.x, p.y, o.angR, o.star, t, 1 + (view.glare || 0));
    else drawBody(ctx, p.x, p.y, r, o.body, o.light, view.seed, t);
  }
  if (view.charging > 0) {
    // frame-shift drive spool: the view starts to bloom and shiver
    ctx.globalCompositeOperation = 'lighter';
    glow(ctx, [140, 170, 255], W / 2, H / 2, 60 + 140 * view.charging, 0.25 * view.charging);
    ctx.globalCompositeOperation = 'source-over';
  }
}

export function drawHyperspace(ctx, view, t) {
  const c = hex(view.tunnelColor || '#cfe0ff');
  ctx.fillStyle = css(mul(c, 0.08));
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < 260; i++) {
    const a = hash(i, 1, 5) * Math.PI * 2 + t * 0.15;
    const ph = (hash(i, 2, 5) + t * (0.35 + hash(i, 3, 5) * 0.6)) % 1;
    const r0 = 4 + ph * ph * 260;
    const r1 = r0 * (1.08 + ph * 0.25);
    const col = mix(c, [255, 255, 255], hash(i, 4, 5) * 0.6);
    line(ctx, col, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.8, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.8, 0.25 + ph * 0.75);
  }
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, c, cx, cy, 40 + 10 * Math.sin(t * 3), 0.6);
  glow(ctx, [255, 255, 255], cx, cy, 10, 0.8);
  ctx.globalCompositeOperation = 'source-over';
}

export function drawVoid(ctx, t, yaw) {
  // deep intergalactic dark: a far, faint band of the galaxy left behind
  for (let i = 0; i < 160; i++) {
    const x = ((hash(i, 1, 404) * W * 3 - yaw * 40 - t * 0.02) % W + W) % W;
    const y = H * 0.55 + (hash(i, 2, 404) - 0.5) * 40 + Math.sin(x * 0.02) * 8;
    px(ctx, [140, 130, 170], x, y, 0.1 + hash(i, 3, 404) * 0.3);
  }
  for (let i = 0; i < 60; i++) px(ctx, [200, 200, 220], hash(i, 5, 404) * W, hash(i, 6, 404) * H, 0.15 + hash(i, 7, 404) * 0.25);
}

export { rect };
