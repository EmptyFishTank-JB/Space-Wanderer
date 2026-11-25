import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { data, fresh, clone } from './helpers.mjs';
import { computeMix, roomHops, listenerFor, presence } from '../src/audio/mix.js';
import { startFault } from '../src/sim/ship/wear.js';

const cameras = JSON.parse(readFileSync(new URL('../data/cameras.json', import.meta.url)));
const hops = roomHops(data);
const room = (r) => ({ kind: 'room', room: r });
const mix = (s, l, o) => computeMix(s, data, hops, l, o);

test('room graph distances: the bridge is three bulkheads from engineering', () => {
  assert.equal(hops.bridge.bridge, 0);
  assert.equal(hops.bridge.corridor_fore, 1);
  assert.equal(hops.bridge.engineering, 3);
  assert.equal(hops.hydro.lifesupport, 1); // the plumbing hatch
});

test('the feed being watched decides who is listening', () => {
  const f = (id) => cameras.feeds.find((x) => x.id === id);
  assert.deepEqual(listenerFor(f('CAM-05'), false), room('hydro'));
  assert.deepEqual(listenerFor(f('CAM-08'), false), { kind: 'ext' });
  assert.deepEqual(listenerFor(f('EVA-POV'), true), { kind: 'eva' });
  assert.deepEqual(listenerFor(f('EVA-POV'), false), { kind: 'static' });
});

test('bulkheads muffle: same room is clear, next room low-passed, far rooms faint', () => {
  const a = presence(hops, room('galley'), 'galley');
  const b = presence(hops, room('corridor_fore'), 'galley');
  const c = presence(hops, room('engineering'), 'galley');
  assert.ok(a.g > b.g && b.g > c.g);
  assert.ok(a.lp > b.lp && b.lp > c.lp);
});

test('watching an empty room: the traveler is heard as distant bleed', () => {
  const s = fresh('bleed');
  s.traveler.pos = { room: 'galley', x: 2 };
  const here = mix(s, room('galley')).traveler;
  const next = mix(s, room('corridor_fore')).traveler;
  const far = mix(s, room('engineering')).traveler;
  assert.equal(here.g, 1);
  assert.ok(next.g < 0.4 && next.lp < 1500);
  assert.ok(far.g < next.g);
});

test('reactor sub-bass: strongest in engineering, heavily muffled in the quarters', () => {
  const s = fresh('reactor');
  s.ship.power.reactorOut = 30;
  const eng = mix(s, room('engineering')).layers.reactor;
  const q = mix(s, room('quarters')).layers.reactor;
  assert.ok(eng.gain > q.gain * 5);
  assert.ok(q.lp < eng.lp);
  s.ship.power.reactorOut = 5;
  assert.ok(mix(s, room('engineering')).layers.reactor.gain < eng.gain);
});

test('room systems are heard where they live: misting in hydro, chirps on the bridge, a rattling pump next door', () => {
  const s = fresh('rooms');
  s.ship.ops.lampOn = true;
  s.ship.trays[0].water = 0.5;
  startFault(s, data, 'hydro_pump_1', 'minor');
  const h = mix(s, room('hydro')).layers;
  const b = mix(s, room('bridge')).layers;
  assert.ok(h.mist.gain > 0 && b.mist.gain < h.mist.gain * 0.1);
  assert.ok(b.chirps.gain > h.chirps.gain);
  assert.ok(h.pumpRattle.rate > 0 && h.pumpRattle.gain > mix(s, room('lifesupport')).layers.pumpRattle.gain);
});

test('scooping: plasma roar grows with heat, the warning chime starts near the limit', () => {
  const s = fresh('scoopmix');
  s.ship.flight.mode = 'scooping';
  s.ship.thermal.heat = 0.5;
  const cool = mix(s, room('bridge')).layers;
  s.ship.thermal.heat = 0.9;
  const hot = mix(s, room('bridge')).layers;
  assert.ok(hot.plasma.gain > cool.plasma.gain);
  assert.ok(hot.plasma.crackle > cool.plasma.crackle);
  assert.equal(cool.chime.interval, 0);
  assert.ok(hot.chime.interval > 0);
  assert.ok(hot.hullGroan.rate > 0);
});

test('drive: spool-up whine rises in pitch; hyperspace roars; supercruise hum tracks speed', () => {
  const s = fresh('drive');
  s.ship.flight.mode = 'charging';
  s.ship.flight.timer = 18;
  const early = mix(s, room('bridge')).layers.charge;
  s.ship.flight.timer = 2;
  const late = mix(s, room('bridge')).layers.charge;
  assert.ok(late.pitch > early.pitch * 3 && late.gain > early.gain);
  s.ship.flight.mode = 'hyperspace';
  assert.ok(mix(s, room('bridge')).layers.hyper.gain > 0.2);
  s.ship.flight.mode = 'cruise';
  s.ship.flight.v = 0.01;
  const slow = mix(s, room('bridge')).layers.cruise;
  s.ship.flight.v = 500;
  const fast = mix(s, room('bridge')).layers.cruise;
  assert.ok(fast.pitch > slow.pitch && fast.drag > slow.drag);
});

test('atmospheric entry: wind shear and buffeting follow the descent', () => {
  const s = fresh('entry');
  const calm = mix(s, room('bridge'), { view: {} }).layers;
  const hot = mix(s, room('bridge'), { view: { entryHeat: 0.4, buffeting: 0.8 } }).layers;
  assert.equal(calm.entry.gain, 0);
  assert.ok(hot.entry.gain > 0.1 && hot.rumble.gain > 0.1 && hot.entry.cutoff > calm.entry.cutoff);
});

test('the hull camera hears propulsion and almost nothing of the interior', () => {
  const s = fresh('ext');
  s.ship.flight.mode = 'hyperspace';
  const ext = mix(s, { kind: 'ext' }).layers;
  const q = mix(s, room('quarters')).layers;
  assert.ok(ext.hyper.gain > q.hyper.gain);
  assert.equal(ext.vent.gain, 0);
  assert.ok(ext.reactor.gain < mix(s, room('engineering')).layers.reactor.gain);
});

test('helmet cam: suit breathing, comms and outside wind; the ship falls silent', () => {
  const s = fresh('suit');
  const m = mix(s, { kind: 'eva' }, { evaBody: { atmosphere: 'thin', tempK: 200 } }).layers;
  assert.ok(m.breath.gain > 0 && m.comms.gain > 0 && m.evaWind.gain > 0);
  for (const k of ['reactor', 'vent', 'water', 'chirps', 'cruise']) assert.equal(m[k].gain, 0, k);
  const airless = mix(s, { kind: 'eva' }, { evaBody: { atmosphere: 'none' } }).layers;
  assert.equal(airless.evaWind.gain, 0, 'no wind without air');
  assert.ok(mix(s, { kind: 'static' }).layers.static.gain > 0);
});

test('diegetic music: clear in the room with the speaker, muffled next door, silent when not playing', () => {
  const s = fresh('music');
  const on = { music: { playing: true, room: 'lounge' } };
  const here = mix(s, room('lounge'), on).layers.music;
  const next = mix(s, room('corridor_fore'), on).layers.music;
  assert.ok(here.gain > next.gain && here.lp > next.lp);
  assert.equal(mix(s, room('lounge'), { music: { playing: false } }).layers.music.gain, 0);
});

test('mute silences the master only', () => {
  const s = fresh('mute');
  assert.equal(mix(s, room('bridge'), { muted: true }).master, 0);
  assert.ok(mix(s, room('bridge')).master > 0);
});

test('faults are audible: arcing junction box, flickering light buzz, hot vents hiss', () => {
  const s = fresh('faultsnd');
  startFault(s, data, 'junction_box_fore', 'minor');
  startFault(s, data, 'corridor_lights_aft', 'minor');
  s.ship.thermal.heat = 0.9;
  assert.ok(mix(s, room('corridor_fore')).layers.arc.rate > 0);
  assert.ok(mix(s, room('corridor_aft')).layers.buzz.gain > 0);
  assert.ok(mix(s, room('engineering')).layers.ventHiss.gain > 0.1);
});

test('the mix is pure: computing it never changes the sim', () => {
  const s = fresh('pure');
  const before = JSON.stringify(s);
  mix(clone(s), room('hydro'));
  mix(s, { kind: 'eva' }, { evaBody: { atmosphere: 'thick' } });
  assert.equal(JSON.stringify(s), before);
});
