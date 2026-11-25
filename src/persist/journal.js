// Long-term event journal in IndexedDB. Holds every notable sim event (the
// raw material Phase 5 turns into episodic memories and log prose) plus
// object stores reserved for later phases:
//   events    notable sim events, keyed by event id
//   memories  episodic memory records (spec §9 fields), callback counts kept current
//   systems   visited star-system records (one per system, keyed by id)
import { NOTABLE } from '../sim/events.js';

export const DB_NAME = 'deep-space-terrarium';
export const DB_VERSION = 1;

export const notableOnly = (events) => events.filter((e) => NOTABLE.has(e.type));

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export class IndexedDBJournal {
  static async open(idb = globalThis.indexedDB) {
    if (!idb) throw new Error('IndexedDB unavailable');
    const open = idb.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('events')) {
        const ev = db.createObjectStore('events', { keyPath: 'id' });
        ev.createIndex('t', 't');
        ev.createIndex('type', 'type');
        ev.createIndex('day', 'day');
      }
      if (!db.objectStoreNames.contains('memories')) db.createObjectStore('memories', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('systems')) db.createObjectStore('systems', { keyPath: 'id' });
    };
    return new IndexedDBJournal(await req(open));
  }

  constructor(db) { this.db = db; }

  async append(events) {
    const keep = notableOnly(events).filter((e) => e.type !== 'system_record');
    const systems = events.filter((e) => e.type === 'system_record');
    const formed = events.filter((e) => e.type === 'memory_formed');
    const recalled = events.filter((e) => e.type === 'memory_recalled');
    if (!keep.length && !systems.length && !formed.length && !recalled.length) return 0;
    const tx = this.db.transaction(['events', 'systems', 'memories'], 'readwrite');
    const store = tx.objectStore('events');
    for (const e of keep) store.put(e);
    for (const e of systems) tx.objectStore('systems').put(e.record);
    const mem = tx.objectStore('memories');
    for (const e of formed) mem.put(e.record);
    for (const e of recalled) {
      const g = mem.get(e.memoryId);
      g.onsuccess = () => { if (g.result) mem.put({ ...g.result, callback_count: e.callback_count, last_recalled_t: e.t }); };
    }
    await done(tx);
    return keep.length;
  }

  /** Episodic memories, heaviest first. */
  async memories(limit = 50) {
    const all = await req(this.db.transaction('memories', 'readonly').objectStore('memories').getAll());
    return all.sort((a, b) => b.emotional_weight - a.emotional_weight || b.t - a.t).slice(0, limit);
  }

  /** Visited star systems, most recent first. */
  async systems(limit = 50) {
    const all = await req(this.db.transaction('systems', 'readonly').objectStore('systems').getAll());
    return all.sort((a, b) => b.departedT - a.departedT).slice(0, limit);
  }

  async recent(limit = 50, type = null) {
    const tx = this.db.transaction('events', 'readonly');
    const src = type ? tx.objectStore('events').index('type') : tx.objectStore('events');
    const out = [];
    await new Promise((resolve, reject) => {
      const c = src.openCursor(type ? IDBKeyRange.only(type) : null, 'prev');
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur || out.length >= limit) return resolve();
        out.push(cur.value);
        cur.continue();
      };
      c.onerror = () => reject(c.error);
    });
    return type ? out.sort((a, b) => b.id - a.id) : out;
  }

  async count() {
    return req(this.db.transaction('events', 'readonly').objectStore('events').count());
  }

  async all() {
    return req(this.db.transaction('events', 'readonly').objectStore('events').getAll());
  }

  async replaceAll(events) {
    const tx = this.db.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    store.clear();
    for (const e of events) store.put(e);
    await done(tx);
  }

  async clear() { await this.replaceAll([]); }
}

/** Same API, in memory — Node tools, tests, and a fallback when IndexedDB is blocked. */
export class MemoryJournal {
  constructor() { this.events = []; this.systemRecords = new Map(); this.memoryRecords = new Map(); }
  async append(events) {
    for (const e of events) {
      if (e.type === 'system_record') this.systemRecords.set(e.record.id, e.record);
      if (e.type === 'memory_formed') this.memoryRecords.set(e.record.id, { ...e.record });
      if (e.type === 'memory_recalled' && this.memoryRecords.has(e.memoryId)) Object.assign(this.memoryRecords.get(e.memoryId), { callback_count: e.callback_count, last_recalled_t: e.t });
    }
    const keep = notableOnly(events).filter((e) => e.type !== 'system_record');
    this.events.push(...keep);
    return keep.length;
  }
  async memories(limit = 50) { return [...this.memoryRecords.values()].sort((a, b) => b.emotional_weight - a.emotional_weight || b.t - a.t).slice(0, limit); }
  async systems(limit = 50) { return [...this.systemRecords.values()].sort((a, b) => b.departedT - a.departedT).slice(0, limit); }
  async recent(limit = 50, type = null) {
    const src = type ? this.events.filter((e) => e.type === type) : this.events;
    return src.slice(-limit).reverse();
  }
  async count() { return this.events.length; }
  async all() { return this.events.slice(); }
  async replaceAll(events) { this.events = events.slice(); }
  async clear() { this.events = []; }
}
