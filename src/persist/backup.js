// Portable backup of a long-running traveler: the snapshot plus the complete
// archive (events, visited systems, episodic memories) in one JSON file.
//
// Format history:
//   v1 (Phases 1–5): { format, exportedAtMs, snapshot, events }. Systems and
//      archived memories were not included.
//   v2: { format, version: 2, exportedAtMs, snapshot, archive: { events, systems, memories } }
import { serialize, deserialize } from './snapshot.js';

export const BACKUP_FORMAT = 'deep-space-terrarium/backup';
export const BACKUP_VERSION = 2;

export function buildBackup(state, archive) {
  const a = Array.isArray(archive) ? { events: archive, systems: [], memories: [] } : archive;
  return JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAtMs: Date.now(), snapshot: serialize(state),
    archive: { events: a.events || [], systems: a.systems || [], memories: a.memories || [] },
  });
}

/**
 * Rebuild what a v1 backup could not carry. Visited systems are recovered
 * (approximately) from the journal's arrival events; memories from the
 * snapshot's working set. Older memories that had already left the working
 * set are gone, so the result is flagged `partial`.
 */
function legacyArchive(state, events) {
  const systems = new Map();
  for (const e of events) {
    if (e.type !== 'system_arrival' || !e.systemId) continue;
    systems.set(e.systemId, { id: e.systemId, name: e.system, star: e.star, label: e.label, arrivedT: e.t, departedT: null, partial: true });
  }
  const memories = (state.memory && state.memory.records ? state.memory.records : []).map((r) => ({ ...r }));
  return { events, systems: [...systems.values()], memories };
}

export function parseBackup(text, data = null) {
  const obj = JSON.parse(text);
  if (!obj || obj.format !== BACKUP_FORMAT) throw new Error('not a terrarium backup');
  if (obj.version > BACKUP_VERSION) throw new Error(`backup version ${obj.version} is newer than this build`);
  const state = deserialize(obj.snapshot, data);
  if (obj.archive) {
    const a = obj.archive;
    for (const k of ['events', 'systems', 'memories']) if (!Array.isArray(a[k])) throw new Error(`backup archive is missing ${k}`);
    return { state, archive: a, events: a.events, partial: false };
  }
  const events = Array.isArray(obj.events) ? obj.events : [];
  return { state, archive: legacyArchive(state, events), events, partial: true };
}

/**
 * Restore a backup over whatever voyage is here now, as close to atomically
 * as two storage systems allow:
 *   1. parse and validate everything first (nothing is touched on a bad file);
 *   2. keep the current archive in memory as a rollback;
 *   3. swap the journal's three stores in one transaction;
 *   4. only then activate the snapshot; if that fails, put the old archive back.
 * A failed import leaves the previous voyage usable.
 */
export async function importVoyage({ text, data, snapshots, journal }) {
  const parsed = parseBackup(text, data);
  const rollback = await journal.exportArchive();
  await journal.importArchive(parsed.archive);
  try {
    snapshots.replace(parsed.state);
  } catch (err) {
    await journal.importArchive(rollback).catch(() => {});
    throw err;
  }
  return { state: parsed.state, partial: parsed.partial };
}
