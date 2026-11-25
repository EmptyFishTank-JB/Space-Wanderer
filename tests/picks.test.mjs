// Selection mode: every room registers its stations, doors, lights and the
// traveler, and each entry describes itself from live sim data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, fresh, runCollect, HOUR } from './helpers.mjs';
import { picks, registerRoomPicks } from '../src/render/picks.js';
import { PPM } from '../src/render/gfx.js';

test('every room registers selectable things that describe themselves', () => {
  const s = fresh('picks');
  runCollect(s, 2 * HOUR);
  for (const room of Object.keys(data.rooms)) {
    if (data.rooms[room].exterior) continue;
    picks.begin();
    registerRoomPicks({ state: s, data, room, ox: 0, M: (u) => u * PPM, lamps: [{ x: 40, y: 20 }], windows: [] }, null);
    const all = picks.all();
    assert.ok(all.some((p) => p.id.startsWith('door:')), `${room} has no door`);
    for (const p of all) {
      const info = p.info();
      assert.ok(info.name && typeof info.name === 'string', `${p.id} has no name`);
      for (const [k, v] of info.lines || []) assert.ok(v !== undefined && !String(v).includes('NaN'), `${p.id} ${k}: ${v}`);
    }
  }
  picks.begin();
  registerRoomPicks({ state: s, data, room: 'hydro', ox: 0, M: (u) => u * PPM, lamps: [], windows: [] }, null);
  const tray = picks.byId('st:hydro:tray_0').info();
  assert.match(tray.name, /Grow tray 1/);
  assert.ok(tray.lines.some(([k]) => k === 'Crop'));
  const pump = picks.all().find((p) => p.id === 'st:hydro:pump_1').info();
  assert.ok(pump.lines.some(([k]) => k === 'Wear'));
});
