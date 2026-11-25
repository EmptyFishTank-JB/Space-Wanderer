// Celestial painting: starfield, stars, planets (textured spheres with
// terminators, atmospheres, clouds and rings), hyperspace, the void.
import { W, H, hex, mix, mul, css, rect, px, glow, hash, strHash, fbm3, noise3, clamp01, line } from './gfx.js';

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

/** Background stars + faint galactic band. `seed` rotates the sky per system. */
export function drawStarfield(ctx, seed, yaw, pitch, { speed = 0, dim = 1, band = true } = {}) {
  const rot = (seed % 1000) / 1000 * Math.PI * 2;
  if (band) {
    for (let x = 0; x < W; x += 2) {
      const az = Math.atan((x - W / 2) / FOCAL) + yaw + rot;
      const cy = H / 2 - FOCAL * Math.tan(0.25 * Math.sin(az * 1.0 + 0.7) - pitch);
      for (let k = 0; k < 7; k++) {
        const y = cy + (hash(x, k, seed) - 0.5) * 50;
        const n = noise3(x * 0.05, y * 0.05, seed % 97, 5);
        if (n > 0.55) px(ctx, [110, 105, 140], x, y, (n - 0.55) * 0.9 * dim);
      }
    }
  }
  for (const s of FIELD) {
    let b = s.az - yaw + rot;
    b = ((b + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    if (Math.abs(b) > FOV / 2 + 0.05) continue;
    const x = W / 2 + FOCAL * Math.tan(b);
    const y = H / 2 - FOCAL * Math.tan(s.el - pitch);
    if (y < -2 || y > H + 2) continue;
    const a = (0.25 + 0.75 * s.m) * dim;
    if (speed > 0.02) {
      // supercruise streaks: radial from the centre of travel
      const dx = x - W / 2, dy = y - H / 2;
      const k = speed * 0.18;
      line(ctx, s.c, x, y, x + dx * k, y + dy * k, a * 0.8);
    } else {
      px(ctx, s.c, x, y, a);
      if (s.m > 0.85) { px(ctx, s.c, x - 1, y, a * 0.35); px(ctx, s.c, x + 1, y, a * 0.35); px(ctx, s.c, x, y - 1, a * 0.35); px(ctx, s.c, x, y + 1, a * 0.35); }
    }
  }
}

// ───────────────────────── stars ─────────────────────────
export function drawStar(ctx, x, y, angR, star, t, glareK = 1) {
  const c = hex(star.color);
  const r = angToPx(angR);
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
  const limbC = mix(c, [255, 100, 25], 0.55);
  const tt = t * 0.15;
  const gs = Math.max(0.25, Math.min(0.6, 40 / R)); // granulation cell size tracks apparent size
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
      const k = (0.5 + 0.5 * mu) * gran;
      const col = mix(limbC, hot, Math.pow(mu, 0.7));
      const o = ((j - y0) * (x1 - x0 + 1) + (i - x0)) * 4;
      d[o] = Math.min(255, col[0] * k + 20); d[o + 1] = Math.min(255, col[1] * k + 10); d[o + 2] = Math.min(255, col[2] * k); d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
  if (R > 30) {
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 14; k++) {
      const a = hash(k, 1, 61) * Math.PI * 2 + t * 0.01;
      const hgt = (0.03 + 0.06 * hash(k, 2, 61)) * R * (0.7 + 0.3 * Math.sin(t * 0.3 + k));
      for (let h = 0; h < hgt; h += 1) {
        const rr = R + h;
        const aa = a + Math.sin(h / hgt * Math.PI) * 0.02;
        px(ctx, [255, 120, 60], x + Math.cos(aa) * rr, y + Math.sin(aa) * rr, 0.5 * (1 - h / hgt));
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
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
export function drawSpaceScene(ctx, view, t, { yaw = 0, pitch = 0, parallax = 0 } = {}) {
  ctx.fillStyle = '#020308';
  ctx.fillRect(0, 0, W, H);
  if (view.scene === 'void') { drawVoid(ctx, t, yaw); return; }
  if (view.scene === 'hyperspace') { drawHyperspace(ctx, view, t); return; }
  const y0 = yaw + parallax;
  drawStarfield(ctx, view.seed, view.heading + y0, pitch, { speed: view.speed });
  for (const o of view.objects) {
    const p = project(o.bearing, o.elev, y0, pitch);
    if (!p) continue;
    const r = angToPx(o.angR);
    if (p.x + r < -W || p.x - r > 2 * W) continue;
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
