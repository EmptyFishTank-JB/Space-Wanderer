// Mission calendar. Sim time `state.t` is real seconds simulated since this
// save began (1:1 with wall clock). Mission time adds the epoch the save started
// at plus any time spent in torpor (Phase 2 uses torpor to stretch the mission
// calendar across centuries while waking life keeps a human circadian rhythm).
import { DAY, HOUR } from './util.js';

export function missionSeconds(state) {
  return state.calendar.baseSeconds + state.t + state.calendar.torporSeconds;
}

export function shipHour(state) {
  return ((missionSeconds(state) / HOUR) % 24 + 24) % 24;
}

export function missionDay(state) {
  return Math.floor(missionSeconds(state) / DAY);
}

export function missionYear(state) {
  return Math.floor(missionDay(state) / 365) + 1;
}

export function dayOfYear(state) {
  return (missionDay(state) % 365) + 1;
}

export function baseSecondsFor({ year, dayOfYear: doy, hour }) {
  return ((year - 1) * 365 + (doy - 1)) * DAY + hour * HOUR;
}

export function formatShipTime(state) {
  const h = shipHour(state);
  const hh = String(Math.floor(h)).padStart(2, '0');
  const mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
  return `Y${missionYear(state)} D${String(dayOfYear(state)).padStart(3, '0')} ${hh}:${mm}`;
}
