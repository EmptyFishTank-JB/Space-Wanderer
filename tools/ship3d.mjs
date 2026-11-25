#!/usr/bin/env node
// Check the proposed 3D arrangement (data/ship3d.json) against the sim's room
// graph (data/ship.json) and print the door-position changes it implies.
//   node tools/ship3d.mjs          report
//   node tools/ship3d.mjs --json   machine-readable report
import { readFileSync } from 'node:fs';
import { checkArrangement, proposedChanges } from '../src/ship3d/geometry.js';

const root = new URL('..', import.meta.url);
const ship = JSON.parse(readFileSync(new URL('data/ship3d.json', root)));
const sim = JSON.parse(readFileSync(new URL('data/ship.json', root)));
const report = checkArrangement(ship, sim);
const changes = proposedChanges(report);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: report.ok, problems: report.problems, hatches: report.hatches, changes, resizes: report.resizes, volumes: report.volumes }, null, 2));
} else {
  console.log(`${ship.name} — ${report.ok ? 'geometry consistent' : `${report.problems.length} problem(s)`}`);
  for (const p of report.problems) console.log('  ✗', p);
  const pv = Object.entries(report.volumes).reduce((s, [, v]) => s + v, 0);
  const fresh = ship.rooms.filter((r) => r.new).length;
  console.log(`  pressurized volume ≈ ${Math.round(pv)} m³ in ${Object.keys(report.volumes).length} pressurized spaces (${ship.rooms.length - fresh} from the sim, ${fresh} new)`);
  for (const r of report.resizes) console.log(`\n  resize: ${r.room} ${r.from} m → ${r.to} m (${r.why})`);
  console.log(`\n  ship.json door positions this arrangement needs (${changes.length}):`);
  for (const c of changes) console.log(`    ${c.hatch.padEnd(14)} ${c.room.padEnd(14)} ${String(c.from).padStart(5)} → ${c.to}`);
}
process.exitCode = report.ok ? 0 : 1;
