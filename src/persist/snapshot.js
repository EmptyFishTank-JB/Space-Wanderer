// Simulation snapshots in localStorage (or any getItem/setItem store).
// The previous snapshot is kept as a backup slot so a write interrupted by a
// closing tab can never lose the traveler.
import { STATE_VERSION, initMemory, defaultOutfit } from '../sim/state.js';
import { initSpace } from '../space/init.js';
import { initPorts } from '../space/ports.js';
import { initCombat } from '../space/combat.js';
import { getSystem, exemptFromVariants } from '../space/system.js';

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
  if (version < 3) {
    // Phase 2 → 5: memory, logs, skills, library; remember where we are by name
    initMemory(state);
    if (data && state.space && !state.space.systemName) {
      const sys = getSystem(state.space.galaxySeed, state.space.systemId, data.space);
      state.space.systemName = sys.name;
      state.space.starClass = sys.star.cls;
    }
  }
  if (version < 4) {
    // idle life: a bladder, and clothes that change each morning
    const tr = state.traveler;
    if (tr.needs.bladder === undefined) tr.needs.bladder = 0.3;
    if (!tr.outfit) tr.outfit = defaultOutfit();
    const h = tr.history;
    if (h.lastToiletT === undefined) h.lastToiletT = state.t - 3 * 3600;
    if (h.lastDressDay === undefined) h.lastDressDay = -1;
    if (h.laundry === undefined) h.laundry = 0;
  }
  if (version < 5 && state.space) {
    // star variants arrived: the system this voyage is sitting in stays exactly as it was
    state.space.variantExempt = state.space.variantExempt || [state.space.systemId];
  }
  if (version < 6) {
    // US spelling: gray water, and the gray T-shirt and socks in the wardrobe
    const w = state.ship && state.ship.water;
    if (w && w.grey !== undefined) { w.gray = (w.gray || 0) + w.grey; delete w.grey; }
    const o = state.traveler && state.traveler.outfit;
    if (o && o.top === 'grey_tee') o.top = 'gray_tee';
    if (o && o.socks === 'grey socks') o.socks = 'gray socks';
  }
  if (version < 7) {
    // the tanks double to 64 t, and the rover joins the ship
    const f = state.ship && state.ship.fuel;
    if (f && f.capacity === 32) f.capacity = 64;
    if (state.ship && !state.ship.rover) state.ship.rover = { charge: 1, out: false, odometerKm: 0 };
    const st = state.space && state.space.stats;
    if (st) { st.rovers = st.rovers || 0; st.roverKm = st.roverKm || 0; }
  }
  if (version < 8 && state.space) initPorts(state); // inhabited space: credits, reputation, missions
  if (version < 9 && state.space) initCombat(state); // shields and bounty vouchers
  if (version < 10 && state.space) initCombat(state); // the magazine, fire-control servicing, attackers with wingmen
  if (state.space) for (const id of state.space.variantExempt || []) exemptFromVariants(state.space.galaxySeed, id);
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

  /** Make `state` the only voyage here: main and backup slots both, so a fallback can never resurrect the old one. */
  replace(state) {
    const text = serialize(state);
    this.storage.setItem(SNAPSHOT_KEY, text);
    this.storage.setItem(BACKUP_KEY, text);
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
