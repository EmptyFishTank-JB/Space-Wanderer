// Normalizes the raw JSON definitions into lookup tables used by the sim.
// The sim never fetches anything itself: callers load JSON (fetch in the
// browser, fs in Node) and pass the raw objects here.
import { buildNav } from './traveler/nav.js';

export const DATA_FILES = ['config', 'ship', 'components', 'crops', 'routines', 'traveler', 'space'];

export function prepareData(raw) {
  for (const k of DATA_FILES) {
    if (!raw[k]) throw new Error(`missing data file: ${k}.json`);
  }
  const rooms = {};
  for (const r of raw.ship.rooms) rooms[r.id] = r;
  for (const h of raw.ship.hatches) {
    if (!rooms[h.a] || !rooms[h.b]) throw new Error(`hatch ${h.id} references unknown room`);
  }

  const components = {};
  for (const c of raw.components.components) {
    if (!rooms[c.room]) throw new Error(`component ${c.id} in unknown room ${c.room}`);
    if (rooms[c.room].stations[c.station] === undefined) {
      throw new Error(`component ${c.id} at unknown station ${c.room}.${c.station}`);
    }
    components[c.id] = c;
  }

  const crops = {};
  for (const c of raw.crops.crops) crops[c.id] = c;

  return {
    config: raw.config,
    ship: raw.ship,
    rooms,
    roomIds: raw.ship.rooms.filter((r) => !r.exterior).map((r) => r.id), // interior compartments
    nav: buildNav(raw.ship),
    components,
    componentIds: raw.components.components.map((c) => c.id),
    crops,
    cropIds: raw.crops.crops.map((c) => c.id),
    photoperiod: raw.crops.photoperiod,
    routines: raw.routines.routines,
    traveler: raw.traveler,
    space: raw.space,
  };
}
