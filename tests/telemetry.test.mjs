// The telemetry overlay's data: location, traveler, ship, all finite and sensible.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, HOUR } from './helpers.mjs';
import { telemetryFor, formatDistance, activityLabel } from '../src/ui/telemetry-model.js';
import { sectionOf } from '../src/ui/switcher.js';
import { readFileSync } from 'node:fs';

test('telemetry reports where the ship is, what the traveler is doing, and the ship state', () => {
  const s = fresh('tm');
  runCollect(s, 5 * HOUR);
  const feedDef = { id: 'CAM-02', label: 'OBS-LOUNGE', room: 'lounge' };
  const m = telemetryFor(s, data, feedDef, 0.6);
  assert.equal(m.camera.feed, 'CAM-02 OBS-LOUNGE');
  assert.ok(m.location.system && m.location.star && m.location.status);
  assert.match(m.location.starDistance, /(AU|Ls|km)$/);
  assert.equal(m.traveler.needs.length, 6);
  for (const n of m.traveler.needs) assert.ok(n.v >= 0 && n.v <= 100);
  assert.ok(m.traveler.vitals.hr > 40 && m.traveler.vitals.hr < 140);
  assert.ok(m.ship.battery >= 0 && m.ship.battery <= 100);
  assert.equal(typeof m.traveler.doing, 'string');
});

test('distances and activity labels read naturally', () => {
  assert.equal(formatDistance(1000), '2.00 AU');
  assert.equal(formatDistance(12.34), '12.3 Ls');
  assert.equal(activityLabel({ id: 'tinker', phase: 'perform', params: { object: 'music box' } }), 'Tinkering · music box');
  assert.equal(activityLabel({ id: 'cook_meal', phase: 'walk' }), 'On the way: cooking');
});

test('every camera feed lands in a menu section', () => {
  const cams = JSON.parse(readFileSync(new URL('../data/cameras.json', import.meta.url)));
  for (const f of cams.feeds) assert.ok(sectionOf(f), f.id);
  assert.equal(sectionOf({ id: 'CAM-08', exterior: true }), 'Exterior');
  assert.equal(sectionOf({ id: 'CAM-01', room: 'bridge' }), 'Command');
});
