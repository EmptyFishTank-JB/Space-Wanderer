// Furniture in three dimensions. Every station a room's camera feed draws
// (a bunk, the helm, a grow tray, the reactor face) becomes an object
// standing against the back wall, as deep as the thing would be, faced with
// its own live drawing from the feed. Solid things are boxes; open things
// (plants, chairs, an easel) are cut-out cards; desks and tables have tops
// and legs. What isn't furniture (pipes, a wall screen, a sign) stays flat on
// the wall. The rooms only the 3D layout has get furniture of their own,
// laid out along the wall clear of the doors. Pure data and layout: no DOM.
import { PPM } from '../render/gfx.js';

// station kind → { w: drawn width (px), top: px above the floor, h: drawn height (px), d: depth (m), shape }
export const STATION = {
  helm: { w: 26, top: 40, d: 0.75, shape: 'box' }, nav: { w: 26, top: 40, d: 0.75, shape: 'box' }, scanner: { w: 26, top: 40, d: 0.75, shape: 'box' },
  terminal: { w: 24, top: 50, d: 0.6, shape: 'box' }, couch: { w: 46, top: 30, d: 0.85, shape: 'box' }, easel: { w: 18, top: 42, d: 0.6, shape: 'card' },
  speaker: { w: 14, top: 36, d: 0.35, shape: 'box' }, exercise: { w: 28, top: 30, d: 0.9, shape: 'card' }, toilet: { w: 14, top: 22, d: 0.6, shape: 'box' },
  bunk: { w: 52, top: 30, d: 0.95, shape: 'box' }, sink: { w: 18, top: 34, d: 0.45, shape: 'box' }, desk: { w: 28, top: 28, d: 0.65, shape: 'table' },
  shelf: { w: 24, top: 84, h: 12, d: 0.25, shape: 'box' }, locker: { w: 22, top: 70, d: 0.55, shape: 'box' }, torpor_pod: { w: 24, top: 74, d: 0.9, shape: 'box' },
  pantry: { w: 28, top: 80, d: 0.6, shape: 'box' }, stove: { w: 26, top: 40, d: 0.65, shape: 'box' }, counter: { w: 32, top: 40, d: 0.65, shape: 'box' },
  table: { w: 26, top: 30, d: 0.9, shape: 'table' }, junction_box: { w: 16, top: 70, h: 20, d: 0.2, shape: 'box' }, light_panel: { w: 16, top: 70, h: 20, d: 0.15, shape: 'box' },
  seedbank: { w: 20, top: 36, d: 0.5, shape: 'box' }, tray: { w: 16, top: 36, d: 0.5, shape: 'card' }, algae: { w: 24, top: 50, d: 0.6, shape: 'box' },
  pump: { w: 18, top: 22, d: 0.45, shape: 'box' }, recycler: { w: 28, top: 50, d: 0.75, shape: 'box' }, ogs: { w: 24, top: 60, d: 0.7, shape: 'box' },
  scrubber: { w: 24, top: 60, d: 0.7, shape: 'box' }, dehumidifier: { w: 24, top: 50, d: 0.6, shape: 'box' }, shelves: { w: 42, top: 70, d: 0.5, shape: 'box' },
  crates: { w: 32, top: 26, d: 0.8, shape: 'box' }, suit_rack: { w: 22, top: 64, d: 0.5, shape: 'card' }, bench: { w: 32, top: 34, d: 0.7, shape: 'box' },
  fabricator: { w: 26, top: 46, d: 0.8, shape: 'box' }, lathe: { w: 26, top: 34, d: 0.7, shape: 'box' }, scoop_manifold: { w: 26, top: 60, d: 0.9, shape: 'box' },
  console: { w: 22, top: 44, d: 0.7, shape: 'box' }, reactor: { w: 38, top: 80, d: 1.3, shape: 'box' }, vents: { w: 32, top: 60, d: 0.6, shape: 'box' },
  drive: { w: 32, top: 70, d: 1.1, shape: 'box' }, seats: { w: 46, top: 28, d: 0.6, shape: 'card' }, kitchenette: { w: 34, top: 40, d: 0.6, shape: 'box' },
  glovebox: { w: 42, top: 44, d: 0.75, shape: 'box' }, incubator: { w: 30, top: 40, d: 0.6, shape: 'box' }, microscope: { w: 38, top: 34, d: 0.6, shape: 'box' },
  rack: { w: 58, top: 96, d: 0.5, shape: 'box' }, gimbals: { w: 54, top: 62, h: 42, d: 0.2, shape: 'box' }, racks: { w: 98, top: 86, d: 0.6, shape: 'box' },
  hoist: { w: 26, top: 110, d: 0.5, shape: 'box' },
};
// the same kind, shaped differently in a particular room
const OVERRIDE = {
  'gallery_s:bench': { w: 30, top: 14, d: 0.5, shape: 'table' }, 'gallery_p:bench': { w: 30, top: 14, d: 0.5, shape: 'table' },
  'firecontrol:console': { w: 70, top: 30, d: 0.7, shape: 'box' },
};
// what the feeds call each kind, for the rooms only the 3D layout has
export const GENERIC_NAME = {
  bike: 'Exercise bike', weights: 'Weights rack', mat: 'Exercise mat', medbed: 'Medical bed', medcab: 'Medical cabinet', screen: 'Wall screen', sink: 'Basin',
  washer: 'Washing machine', table: 'Folding table', bookshelf: 'Bookshelf', desk: 'Desk', bench: 'Lab bench', rack: 'Equipment rack', shelves: 'Shelving',
  cabinet: 'Cabinet', freezer: 'Freezer', console: 'Console', bigscreen: 'Survey map display', telescope: 'Telescope console', crates: 'Crates', tank: 'Tank',
  pipes: 'Pipework', toolwall: 'Tool wall', cradle: 'Drone cradle', suits: 'Suit lockers', bunk: 'Bunks', ahu: 'Air handling unit', filters: 'Filter bank',
  gpump: 'Pump set', valves: 'Valve manifold', hwtank: 'Hot-water tank',
};
// generic furniture: { width (m), drawn height (px), depth (m), shape } — anything not here stays flat on the wall
const GENERIC = {
  bike: [1.1, 38, 0.6, 'card'], weights: [1.2, 42, 0.5, 'card'], medbed: [2.0, 28, 0.9, 'box'], medcab: [0.9, 64, 0.45, 'box'], sink: [0.8, 34, 0.45, 'box'],
  washer: [0.8, 34, 0.65, 'box'], table: [1.4, 28, 0.8, 'table'], bookshelf: [1.2, 84, 0.35, 'box'], desk: [1.4, 28, 0.6, 'table'], bench: [1.8, 32, 0.7, 'box'],
  rack: [0.8, 110, 0.6, 'box'], shelves: [1.6, 94, 0.45, 'box'], cabinet: [0.9, 70, 0.5, 'box'], freezer: [1.0, 76, 0.7, 'box'], console: [1.2, 30, 0.7, 'box'],
  telescope: [1.4, 64, 0.8, 'card'], crates: [1.8, 36, 0.9, 'box'], tank: [1.2, 86, 0.9, 'box'], toolwall: [2.0, 30, 0.6, 'box'], cradle: [1.4, 34, 0.8, 'box'],
  suits: [1.6, 84, 0.45, 'card'], bunk: [2.0, 56, 0.9, 'box'], ahu: [2.2, 92, 1.4, 'box'], filters: [1.6, 80, 0.8, 'box'], gpump: [1.2, 40, 0.9, 'box'],
  valves: [1.6, 70, 0.3, 'box'], hwtank: [1.2, 92, 1.1, 'box'],
};
const ROOM_GENERIC = {
  gym: ['bike', 'weights', 'mat', 'bike'], medbay: ['medbed', 'medcab', 'screen', 'medbed'], isolation: ['medbed', 'screen', 'medcab'], washroom: ['sink'],
  laundry: ['washer', 'washer', 'table', 'washer'], study: ['bookshelf', 'desk', 'bookshelf'], lab: ['bench', 'screen', 'bench', 'rack'], scistores: ['shelves', 'shelves', 'cabinet'],
  coldstore: ['freezer', 'freezer', 'freezer'], datacore: ['rack', 'rack', 'rack', 'rack', 'console'], mapping: ['bigscreen', 'console'], comms: ['console', 'rack', 'console', 'rack'],
  observatory: ['console', 'telescope', 'console'], spares: ['shelves', 'shelves', 'shelves', 'cabinet'], cmstore: ['shelves', 'cabinet', 'shelves'], pantry: ['shelves', 'freezer', 'shelves'],
  hold: ['crates', 'crates', 'crates', 'crates', 'crates'], refinery: ['tank', 'pipes', 'tank', 'console'], powerroom: ['rack', 'console', 'rack', 'rack'], shieldroom: ['rack', 'console', 'rack'],
  gravroom: ['rack', 'console'], roverbay: ['toolwall', 'cabinet', 'toolwall'], flyerbay: ['toolwall', 'cabinet'], dronebay: ['cradle', 'cradle', 'console', 'cradle'],
  suitlock: ['suits', 'suits', 'bench'], shelter: ['bunk', 'cabinet', 'bunk', 'cabinet'],
  hvac: ['ahu', 'filters', 'console', 'ahu'], waterplant: ['gpump', 'hwtank', 'valves', 'gpump', 'console'],
};
const PROP_W = { mat: 1.6, screen: 1.0, stall: 1.0, bigscreen: 3.0, pipes: 1.4 };
const widthOf = (kind) => (GENERIC[kind] ? GENERIC[kind][0] : PROP_W[kind] || 1);

/**
 * Where the furniture of a room only the 3D layout has goes: along the back
 * wall from one end, clear of the doors and the enclosed spaces in that wall
 * (`avoid`: [[u0, u1], ...]). Returns [{ kind, u0, u1 }].
 */
export function genericLayout(roomId, len, avoid = []) {
  const out = [];
  const free = (u0, u1) => u0 >= 0.2 && u1 <= len - 0.2 && !avoid.some(([a, b]) => u1 > a - 0.15 && u0 < b + 0.15);
  let u = 0.4;
  for (const kind of ROOM_GENERIC[roomId] || []) {
    const w = widthOf(kind);
    let at = u;
    while (at + w < len - 0.2 && !free(at, at + w)) at += 0.25;
    if (at + w >= len - 0.2) continue; // no room for this one: try the next
    out.push({ kind, u0: at, u1: at + w });
    u = at + w + 0.35;
  }
  return out;
}

/**
 * A room's furniture as objects: [{ id, kind, name, station, u0, u1, z0, z1
 * (m above the floor), d (m off the back wall), shape, px: [x0, x1, y0, y1]
 * (where its drawing is in the feed's pixels) }].
 */
export function furnitureOf(room, simDef, avoid = []) {
  const items = [];
  const add = (o) => {
    const x0 = Math.round(o.u0 * PPM), x1 = Math.round(o.u1 * PPM);
    items.push({ ...o, px: [x0, x1, 150 - Math.round(o.z1 * PPM), 150 - Math.round(o.z0 * PPM)] });
  };
  const inSpace = (u) => (room.spaces || []).some((s) => u >= s.u[0] && u <= s.u[1]);
  if (simDef) {
    for (const [name, u] of Object.entries(simDef.stations)) {
      const kind = name.replace(/_\d+$/, '');
      const spec = OVERRIDE[`${room.id}:${kind}`] || STATION[kind];
      if (!spec || inSpace(u)) continue;
      const hpx = spec.h ?? spec.top;
      add({ id: `${room.id}:${name}`, kind, station: name, u0: u - spec.w / 2 / PPM, u1: u + spec.w / 2 / PPM, z0: (spec.top - hpx) / PPM, z1: spec.top / PPM, d: spec.d, shape: spec.shape });
    }
  } else {
    for (const g of genericLayout(room.id, room.len, avoid)) {
      const spec = GENERIC[g.kind];
      if (!spec) continue;
      add({ id: `${room.id}:${g.kind}:${g.u0.toFixed(2)}`, kind: g.kind, name: GENERIC_NAME[g.kind], u0: g.u0, u1: g.u1, z0: 0, z1: spec[1] / PPM, d: spec[2], shape: spec[3] });
    }
  }
  return items;
}
