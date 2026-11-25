// Simulation snapshots in localStorage (or any getItem/setItem store).
// The previous snapshot is kept as a backup slot so a write interrupted by a
// closing tab can never lose the traveler.
import { STATE_VERSION } from '../sim/state.js';
import { initSpace } from '../space/init.js';

export const SNAPSHOT_KEY = 'deep-space-terrarium.snapshot';
export const BACKUP_KEY = 'deep-space-terrarium.snapshot.prev';
export const FORMAT = 'deep-space-terrarium/snapshot';

export function serialize(state) {
  const { outbox, ...rest } = state;
  return JSON.stringify({ format: FORMAT, version: STATE_VERSION, savedAtMs: state.wallMs ?? null, state: { ...rest, outbox: [] } });
}

/**
 * Parse a snapshot. `data` is needed to upgrade older layouts (a v1 save
 * gains a galaxy and a home system); without it only current-version
 * snapshots load.
 */
export function deserialize(text, data = null) {
  const obj = JSON.parse(text);
  if (!obj || obj.format !== FORMAT || !obj.state) throw new Error('not a terrarium snapshot');
  return migrate(obj.state, obj.version, data);
}

/** Upgrade older snapshot layouts in place. Add a case per STATE_VERSION bump. */
export function migrate(state, version, data = null) {
  if (version > STATE_VERSION) throw new Error(`snapshot version ${version} is newer than this build (${STATE_VERSION})`);
  state.outbox = state.outbox || [];
  if (version < 2) {
    // Phase 1 → 2: the ship was coasting between stars; place it at a home system.
    if (!data) throw new Error('upgrading a v1 snapshot needs the data tables');
    initSpace(state, data);
    if (state.ship.components.drive_coil === undefined) throw new Error('v1 snapshot missing components');
  }
  state.version = STATE_VERSION;
  return state;
}

export class SnapshotStore {
  constructor(storage, data = null) {
    this.storage = storage;
    this.data = data;
  }

  save(state) {
    const text = serialize(state);
    const prev = this.storage.getItem(SNAPSHOT_KEY);
    if (prev) this.storage.setItem(BACKUP_KEY, prev);
    this.storage.setItem(SNAPSHOT_KEY, text);
    return text.length;
  }

  load() {
    for (const key of [SNAPSHOT_KEY, BACKUP_KEY]) {
      const text = this.storage.getItem(key);
      if (!text) continue;
      try {
        return deserialize(text, this.data);
      } catch (err) {
        console.warn(`terrarium: snapshot ${key} unreadable`, err);
      }
    }
    return null;
  }

  clear() {
    this.storage.removeItem(SNAPSHOT_KEY);
    this.storage.removeItem(BACKUP_KEY);
  }
}

/** In-memory stand-in for localStorage (Node, tests, private browsing fallback). */
export class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
