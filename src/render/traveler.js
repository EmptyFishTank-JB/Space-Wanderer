// The traveler, drawn procedurally from a pixel skeleton (~56 px tall at
// 32 px/m). Poses come from what they are doing; small motions (breathing,
// a slouch when tired, a yawn, hands busy at a console) keep them alive.
import { mix, mul, rect, px } from './gfx.js';

const SKIN = [206, 160, 128];
const HAIR = [64, 46, 38];
const SUIT = [74, 100, 98];
const SUIT_D = [52, 72, 72];
const ACCENT = [196, 120, 64];
const BOOT = [36, 36, 40];
const EVA_SUIT = [214, 214, 206];
const EVA_D = [160, 160, 156];

function limb(ctx, c, x0, y0, x1, y1, w) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    rect(ctx, c, x0 + (x1 - x0) * t - w / 2, y0 + (y1 - y0) * t - w / 2, w, w);
  }
}

/** Build a skeleton (facing right, feet origin) for a pose at animation time t. */
function skeleton(pose, t, k) {
  const breathe = Math.sin(t * 1.6) * 0.6;
  const slouch = k.fatigue > 0.65 ? 1 : 0;
  const S = (o) => ({ view: 'side', hip: [0, -26], chest: [slouch, -44 + slouch + breathe * 0.5], head: [1 + slouch * 2, -51 + slouch * 2],
    kneeF: [1, -13], footF: [1, 0], kneeB: [-1, -13], footB: [-1, 0], elbowF: [1, -35], handF: [2, -27], elbowB: [-1, -35], handB: [-2, -27], ...o });
  switch (pose) {
    case 'walk': {
      const p = k.phase;
      const s = Math.sin(p), c = Math.cos(p);
      const lift = (v) => -Math.max(0, v) * 2.5;
      return S({ hip: [0, -26 - Math.abs(c) * 1], kneeF: [s * 4 + 1.5, -13], footF: [s * 6, lift(c)], kneeB: [-s * 4 + 1.5, -13], footB: [-s * 6, lift(-c)],
        elbowF: [-s * 2, -35], handF: [-s * 5 + 1, -28], elbowB: [s * 2, -35], handB: [s * 5 - 1, -28] });
    }
    case 'sit_side': return S({ hip: [-2, -17], chest: [-1 + slouch, -35 + breathe * 0.4], head: [0 + slouch, -42 + slouch], kneeF: [7, -17], footF: [7, 0], kneeB: [6, -17], footB: [6, 0],
      elbowF: [3, -27], handF: [9, -24 - (k.eating ? Math.max(0, Math.sin(t * 0.9)) * 14 : 0)], elbowB: [2, -27], handB: [8, -24] });
    case 'sit_back': {
      const typ = k.typing ? Math.sin(t * 14) : 0;
      return S({ view: 'back', hip: [0, -17], chest: [0, -35 + breathe * 0.4], head: [0, -42 + slouch], kneeF: [3, -15], footF: [3, -3], kneeB: [-3, -15], footB: [-3, -3],
        elbowF: [6, -28], handF: [6, -32 + typ], elbowB: [-6, -28], handB: [-6, -32 - typ] });
    }
    case 'recline': return S({ hip: [-2, -17], chest: [-6, -33 + breathe * 0.4], head: [-7, -40], kneeF: [7, -19], footF: [9, -2], kneeB: [6, -18], footB: [8, -2],
      elbowF: [-1, -27], handF: [3, -33], elbowB: [-2, -27], handB: [2, -32], book: true });
    case 'stand_back': return S({ view: 'back', handF: k.working ? [6, -36 + Math.sin(t * 3) * 1.5] : [5, -27], elbowF: k.working ? [6, -32] : [5, -35],
      handB: k.working ? [-6, -36 - Math.sin(t * 3) * 1.5] : [-5, -27], elbowB: k.working ? [-6, -32] : [-5, -35] });
    case 'crouch': return S({ view: 'back', hip: [0, -13], chest: [0, -30], head: [0, -36], kneeF: [5, -10], footF: [4, 0], kneeB: [-5, -10], footB: [-4, 0],
      elbowF: [6, -22], handF: [6, -17 + Math.sin(t * 2)], elbowB: [-6, -22], handB: [-6, -18] });
    case 'kneel': return S({ hip: [-1, -14], chest: [2, -31], head: [4, -37], kneeF: [5, -1], footF: [-5, 0], kneeB: [4, -12], footB: [5, 0],
      elbowF: [7, -24], handF: [11, -17 + Math.sin(t * 5) * 2], elbowB: [5, -24], handB: [9, -18], tool: true });
    case 'stretch': {
      const a = Math.sin(t * 0.8) * 2;
      return S({ view: 'front', elbowF: [7, -54 + a], handF: [4, -62 + a], elbowB: [-7, -54 - a], handB: [-4, -62 - a] });
    }
    case 'exercise': {
      const p = (Math.sin(t * 2.2) + 1) / 2;
      return S({ hip: [-4 + p * 8, -9], chest: [-8 + p * 10, -26], head: [-8 + p * 10, -33], kneeF: [4 + p * 3, -9 - (1 - p) * 9], footF: [12, -4], kneeB: [3 + p * 3, -10 - (1 - p) * 8], footB: [11, -4],
        elbowF: [-2 + p * 10, -19], handF: [8 + p * 6, -17], elbowB: [-3 + p * 10, -19], handB: [7 + p * 6, -17] });
    }
    case 'slumped': return S({ hip: [0, -6], chest: [-3, -24], head: [1, -27], kneeF: [8, -8], footF: [13, 0], kneeB: [7, -7], footB: [12, 0], elbowF: [2, -14], handF: [5, -8], elbowB: [0, -14], handB: [3, -7] });
    default: return S({});
  }
}

/**
 * Draw the traveler with feet at (x, floorY).
 * k: { pose, facing (1 right / -1 left), phase, fatigue, yawn (0..1), typing, working, eating, suited, alpha }
 */
export function drawTraveler(ctx, x, y, k, t) {
  if (k.pose === 'lie') return drawLying(ctx, x, y, k, t);
  const sk = skeleton(k.pose, t, k);
  const f = k.facing < 0 ? -1 : 1;
  const X = (p) => x + p[0] * (sk.view === 'side' ? f : 1);
  const Y = (p) => y + p[1];
  const o = !k.suited && k.outfit;
  const suit = k.suited ? EVA_SUIT : (o && o.top) || SUIT;
  const suitD = k.suited ? EVA_D : (o && o.bottom) || SUIT_D;
  const boot = (o && o.shoes) || BOOT;
  const shin = o && o.shorts ? SKIN : suitD; // shorts leave the lower legs bare
  ctx.globalAlpha = k.alpha ?? 1;

  // yawn / rub eyes: the near hand rises to the face
  if (k.yawn > 0 && (sk.view === 'side' || sk.view === 'front')) {
    sk.elbowF = [sk.head[0] + 4, sk.head[1] + 9];
    sk.handF = [sk.head[0] + 3, sk.head[1] + 3];
  }
  // idle beats (see actor.js): hand to chin while thinking, a sip from a mug, something turned over in the hand
  if (!(k.yawn > 0) && k.beat && !k.suited && (sk.view === 'side' || sk.view === 'front')) {
    if (k.beat === 'chin') { sk.elbowF = [sk.head[0] + 3, sk.head[1] + 11]; sk.handF = [sk.head[0] + 2, sk.head[1] + 5]; }
    else if (k.beat === 'sip') { sk.elbowF = [sk.head[0] + 4, sk.head[1] + 10]; sk.handF = [sk.head[0] + 4, sk.head[1] + 3]; sk.mug = true; }
    else if (k.beat === 'hold') { sk.elbowF = [sk.chest[0] + 3, sk.chest[1] + 9]; sk.handF = [sk.chest[0] + 7, sk.chest[1] + 7]; sk.item = k.item || [200, 180, 120]; }
  }

  // far limbs
  limb(ctx, mul(suit, 0.75), X(sk.chest), Y(sk.chest) + 2, X(sk.elbowB), Y(sk.elbowB), 3);
  limb(ctx, mul(suit, 0.75), X(sk.elbowB), Y(sk.elbowB), X(sk.handB), Y(sk.handB), 3);
  rect(ctx, k.suited ? EVA_D : mul(SKIN, 0.8), X(sk.handB) - 1, Y(sk.handB) - 1, 2, 2);
  limb(ctx, mul(suitD, 0.85), X(sk.hip), Y(sk.hip), X(sk.kneeB), Y(sk.kneeB), 4);
  limb(ctx, mul(shin, 0.85), X(sk.kneeB), Y(sk.kneeB), X(sk.footB), Y(sk.footB) - 2, o && o.shorts ? 3 : 4);
  rect(ctx, boot, X(sk.footB) - 2 + (sk.view === 'side' ? f : 0), Y(sk.footB) - 3, 5, 3);

  // torso
  const tw = sk.view === 'side' ? 8 : 12;
  limb(ctx, suit, X(sk.hip), Y(sk.hip) - 2, X(sk.chest), Y(sk.chest) + 3, tw);
  rect(ctx, mul(suit, 0.8), X(sk.hip) - tw / 2, Y(sk.hip) - 3, tw, 2); // belt
  if (!k.suited && sk.view !== 'back') rect(ctx, ACCENT, X(sk.chest) + (sk.view === 'side' ? f * 1 : 2), Y(sk.chest) + 4, 2, 2); // mission patch
  if (k.suited) rect(ctx, [120, 124, 130], X(sk.chest) - (sk.view === 'side' ? f * 6 : 4), Y(sk.chest) + 1, 4, 9); // life-support pack

  // near leg
  limb(ctx, suitD, X(sk.hip), Y(sk.hip), X(sk.kneeF), Y(sk.kneeF), 4);
  limb(ctx, shin, X(sk.kneeF), Y(sk.kneeF), X(sk.footF), Y(sk.footF) - 2, o && o.shorts ? 3 : 4);
  rect(ctx, boot, X(sk.footF) - 2 + (sk.view === 'side' ? f : 0), Y(sk.footF) - 3, 5, 3);

  // head
  const hx = X(sk.head), hy = Y(sk.head);
  if (k.suited) {
    rect(ctx, EVA_SUIT, hx - 6, hy - 6, 12, 12);
    rect(ctx, EVA_D, hx - 6, hy + 5, 12, 1);
    if (sk.view !== 'back') { rect(ctx, [40, 60, 80], hx - 4 + (sk.view === 'side' ? f * 2 : 0), hy - 3, 8, 6); px(ctx, [200, 230, 255], hx - 2 + (sk.view === 'side' ? f * 3 : 0), hy - 2, 0.7); }
  } else {
    rect(ctx, SKIN, hx - 4, hy - 5, 9, 10);
    rect(ctx, SKIN, hx - 1, hy + 5, 3, 2); // neck
    if (sk.view === 'back') {
      rect(ctx, HAIR, hx - 4, hy - 6, 9, 9);
    } else if (sk.view === 'front') {
      rect(ctx, HAIR, hx - 4, hy - 6, 9, 3);
      rect(ctx, HAIR, hx - 4, hy - 4, 1, 4); rect(ctx, HAIR, hx + 4, hy - 4, 1, 4);
      px(ctx, [40, 30, 30], hx - 2, hy - 1); px(ctx, [40, 30, 30], hx + 2, hy - 1);
      if (k.yawn > 0) rect(ctx, [90, 40, 40], hx - 1, hy + 2, 3, 2);
    } else {
      // profile
      rect(ctx, HAIR, hx - 4 * f - (f < 0 ? 1 : 0) - (f > 0 ? 0 : 3), hy - 6, 6, 3);
      rect(ctx, HAIR, f > 0 ? hx - 4 : hx + 2, hy - 5, 3, 7);
      px(ctx, [40, 30, 30], hx + 2 * f, hy - 1);
      px(ctx, mul(SKIN, 0.85), hx + 5 * f, hy + 1); // nose
      if (k.yawn > 0) rect(ctx, [90, 40, 40], hx + 2 * f, hy + 2, 2, 2);
    }
  }

  // near arm
  limb(ctx, suit, X(sk.chest), Y(sk.chest) + 2, X(sk.elbowF), Y(sk.elbowF), 3);
  limb(ctx, suit, X(sk.elbowF), Y(sk.elbowF), X(sk.handF), Y(sk.handF), 3);
  rect(ctx, k.suited ? EVA_D : SKIN, X(sk.handF) - 1, Y(sk.handF) - 1, 2, 2);
  if (sk.book) rect(ctx, [150, 60, 50], X(sk.handF) - 2, Y(sk.handF) - 5, 4, 6);
  if (sk.tool) rect(ctx, [160, 160, 170], X(sk.handF), Y(sk.handF) - 1, 4 * f, 1);
  if (sk.mug) { rect(ctx, [206, 204, 196], X(sk.handF) - 1, Y(sk.handF) - 3, 3, 4); px(ctx, [150, 110, 80], X(sk.handF), Y(sk.handF) - 3); }
  if (sk.item) rect(ctx, sk.item, X(sk.handF) - 1, Y(sk.handF) - 3, 3, 3);
  ctx.globalAlpha = 1;
}

function drawLying(ctx, x, y, k, t) {
  // asleep on the bunk (y is the mattress top); blanket rises with breath
  const br = Math.round((Math.sin(t * 0.9) + 1) * 0.5);
  ctx.globalAlpha = k.alpha ?? 1;
  rect(ctx, SKIN, x - 26, y - 7, 8, 7);
  rect(ctx, HAIR, x - 28, y - 8, 5, 8);
  rect(ctx, [126, 112, 150], x - 19, y - 6 - br, 40, 6 + br);
  rect(ctx, [150, 136, 172], x - 19, y - 6 - br, 40, 1);
  rect(ctx, [100, 88, 122], x - 19, y - 1, 40, 1);
  rect(ctx, [126, 112, 150], x + 18, y - 4 - br, 4, 4 + br); // feet under the blanket
  ctx.globalAlpha = 1;
}
