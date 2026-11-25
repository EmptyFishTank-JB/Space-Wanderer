// Portable backup of a long-running traveler: snapshot + journal in one JSON.
import { serialize, deserialize } from './snapshot.js';

export const BACKUP_FORMAT = 'deep-space-terrarium/backup';

export function buildBackup(state, events) {
  return JSON.stringify({ format: BACKUP_FORMAT, exportedAtMs: Date.now(), snapshot: serialize(state), events });
}

export function parseBackup(text, data = null) {
  const obj = JSON.parse(text);
  if (!obj || obj.format !== BACKUP_FORMAT) throw new Error('not a terrarium backup');
  return { state: deserialize(obj.snapshot, data), events: Array.isArray(obj.events) ? obj.events : [] };
}
