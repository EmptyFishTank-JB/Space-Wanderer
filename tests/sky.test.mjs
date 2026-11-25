// Rare star kinds, binaries, nebulae and the real sky. Variants are rolled
// from each star's own hash, so they never move or reclassify other stars,
// and a saved voyage's current system keeps the star it had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh } from './helpers.mjs';
import { neighbors, starVariant, starsInCell, nebulaeNear } from '../src/space/galaxy.js';
import { getSystem, exemptFromVariants } from '../src/space/system.js';
import { serialize, deserialize } from '../src/persist/snapshot.js';
import { skyFor } from '../src/render/sky.js';

const space = data.space;
const SEED = 777;

test('variants come from the base classes they replace, at roughly the configured rates', () => {
  const counts = {};
  const base = {};
  for (let x = -12; x <= 12; x++) for (let y = -12; y <= 12; y++) for (let z = -3; z <= 3; z++) {
    for (const s of starsInCell(SEED, x, y, z, space)) {
      base[s.cls] = (base[s.cls] || 0) + 1;
      const v = starVariant(SEED, s.id, s.cls, space);
      if (v) { counts[v] = (counts[v] || 0) + 1; assert.equal(space.variants[v].from, s.cls); }
    }
  }
  const ratio = (v) => (counts[v] || 0) / (base[space.variants[v].from] || 1);
  assert.ok(ratio('Y') > 0.15 && ratio('Y') < 0.35, `Y ${ratio('Y')}`);
  assert.ok(ratio('RG') > 0.01 && ratio('RG') < 0.06, `RG ${ratio('RG')}`);
});

test('a red giant swallows its inner planets; a variant star carries its new physics', () => {
  let found = null;
  for (const c of neighbors(SEED, [0, 0, 0], 220, space)) if (starVariant(SEED, c.id, c.cls, space) === 'RG') { found = c; break; }
  assert.ok(found, 'no red giant within 220 ly');
  const sys = getSystem(SEED, found.id, space);
  assert.equal(sys.star.type, 'RG');
  assert.equal(sys.star.label, 'red giant');
  assert.ok(sys.star.radiusSun >= 10);
  for (const b of sys.bodies) if (b.parent === 'star') assert.ok(b.a >= sys.star.radius * 6, `${b.id} inside the giant`);
});

test('some systems have a companion star; generation is deterministic', () => {
  const sys = neighbors(SEED, [0, 0, 0], 120, space).map((c) => getSystem(SEED, c.id, space));
  const binaries = sys.filter((s) => s.star.companion);
  assert.ok(binaries.length > 0);
  const again = getSystem(SEED, binaries[0].id, space);
  assert.deepEqual(again.star.companion, binaries[0].star.companion);
});

test('a voyage saved before variants keeps the star it is sitting at', () => {
  const s = fresh('legacy-sky');
  delete s.space.variantExempt;
  const text = serialize(s).replace(/"version":\d+/, '"version":4');
  const back = deserialize(text, data);
  assert.deepEqual(back.space.variantExempt, [back.space.systemId]);
  exemptFromVariants(back.space.galaxySeed, back.space.systemId);
  assert.equal(getSystem(back.space.galaxySeed, back.space.systemId, space).star.variant, undefined);
});

test('the sky holds real neighbours: the same star sits in nearly the same place one jump later', () => {
  const near = neighbors(SEED, [0, 0, 0], 30, space).filter((c) => c.cls === 'G' || c.cls === 'K' || c.cls === 'M');
  const a = getSystem(SEED, near[0].id, space), b = getSystem(SEED, near[1].id, space);
  const sa = skyFor(SEED, a, space), sb = skyFor(SEED, b, space);
  assert.ok(sa.stars.length > 50, `only ${sa.stars.length} visible stars`);
  // a bright star seen from both barely moves on the sky between two systems a few ly apart
  const shared = sa.stars.filter((s) => s.m < 4.5 && sb.stars.some((t) => t.id === s.id));
  assert.ok(shared.length > 0);
  for (const s of shared.slice(0, 10)) {
    const t = sb.stars.find((x) => x.id === s.id);
    const dAz = Math.abs(((t.az - s.az + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    assert.ok(dAz < 0.6, `${s.id} jumped ${dAz.toFixed(2)} rad`);
  }
  assert.ok(Array.isArray(nebulaeNear(SEED, [0, 0, 0], 1600, space)));
});
