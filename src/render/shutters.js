// The windows' armored shutters. On its own the ship closes them for
// supercruise, hyperspace, the frame-shift charge and scooping, and opens
// them when it holds station somewhere safe ("auto"). Someone walking the
// ship can open or close any window's shutters by hand, and that holds until
// they set it back to auto. This is the viewer's setting, kept in the browser:
// the simulation never reads it, so it cannot change the traveler's story.
// Window ids are the 3D layout's (win_gal_s, ...); canopies are 'glass:<hull part>'.
const KEY = 'terrarium.shutters';
let manual = {};
try { manual = JSON.parse(globalThis.localStorage && localStorage.getItem(KEY)) || {}; } catch { manual = {}; }
const save = () => { try { if (globalThis.localStorage) localStorage.setItem(KEY, JSON.stringify(manual)); } catch { /* private window: fine */ } };

export const AUTO_SHUT_MODES = ['cruise', 'hyperspace', 'charging', 'scooping'];
export const autoShut = (state) => AUTO_SHUT_MODES.includes(state.ship.flight.mode);

/** Closed right now? A hand-set state if there is one, else what the ship does on its own. */
export function isShut(state, id) { return id in manual ? manual[id] : autoShut(state); }
/** The hand-set state: true (closed), false (open) or undefined (auto). */
export const manualShut = (id) => manual[id];
/** Set by hand (true closed, false open), or null to hand it back to the ship. */
export function setShut(id, v) { if (v === null || v === undefined) delete manual[id]; else manual[id] = !!v; save(); }
/** Every window at once. */
export function setAllShut(ids, v) { for (const id of ids) { if (v === null) delete manual[id]; else manual[id] = !!v; } save(); }
export const anyManual = () => Object.keys(manual).length > 0;
