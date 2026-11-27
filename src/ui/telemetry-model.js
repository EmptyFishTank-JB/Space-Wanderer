// What the ship's own telemetry says, as plain data (no DOM, testable in
// Node): where the camera is, where the ship is, what the traveler is doing
// and how they are, and how the ship is holding up. Read-only.
import { formatShipTime } from '../sim/clock.js';
import { currentSystem, shipPos } from '../space/flight.js';
import { LS_PER_AU } from '../space/system.js';

const ACTIVITY = {
  sleep: 'Sleeping', nap: 'Napping', doze: 'Dozing off', cook_meal: 'Cooking', eat_meal: 'Eating', snack: 'Having a snack', drink_water: 'Drinking water',
  wash: 'Washing', use_toilet: 'In the washroom', change_clothes: 'Getting dressed', exercise: 'Exercising', stretch: 'Stretching',
  tend_trays: 'Tending the grow trays', harvest_tray: 'Harvesting', plant_tray: 'Planting', tend_algae: 'Tending the algae', repair: 'Repairing',
  maintain: 'Maintenance', vent_heat: 'Venting heat', fabricate: 'Fabricating', inspect_engineering: 'Inspecting engineering',
  inspect_lifesupport: 'Inspecting life support', organize_storage: 'Organizing storage', clean_room: 'Cleaning', wash_dishes: 'Washing up',
  preserve_food: 'Preserving food', check_scans: 'Checking scans', nav_review: 'Reviewing navigation', write_log: 'Writing the log',
  gaze_viewport: 'Looking out', read: 'Reading', listen_music: 'Listening to music', sketch: 'Sketching', play_solitaire: 'Playing cards',
  play_instrument: 'Playing an instrument', reflect: 'Thinking', linger: 'Pausing', stroll: 'Walking the ship', tinker: 'Tinkering',
  survey_system: 'Surveying the system', scan_body: 'Scanning', plot_route: 'Plotting a route', set_course: 'Setting course', jump: 'Jumping',
  scoop_fuel: 'Scooping fuel', land: 'Landing', takeoff: 'Lifting off', eva: 'On EVA', rover_outing: 'Out in the rover', dock: 'Docking', study_sample: 'Studying a sample', chat_passengers: 'Talking with a passenger', go_ashore: 'Ashore on the station', undock: 'Undocking', refine_samples: 'Refining samples', melt_ice: 'Melting ice',
  enter_torpor: 'In torpor',
};
const FLIGHT = { idle: 'Holding station', cruise: 'Supercruise', orbit: 'In orbit', landed: 'Landed', descent: 'Descending', ascent: 'Ascending', scooping: 'Scooping', charging: 'Charging jump drive', hyperspace: 'In hyperspace', void: 'Crossing the void' };

const pct = (v) => Math.round(Math.max(0, Math.min(1, v)) * 100);
const titleRoom = (data, id) => (data.rooms[id] && data.rooms[id].name) || id;

/** Distance in light-seconds, written the way a navigator would. */
export function formatDistance(ls) {
  if (ls >= LS_PER_AU * 0.5) return `${(ls / LS_PER_AU).toFixed(ls >= LS_PER_AU * 10 ? 0 : 2)} AU`;
  if (ls >= 1) return `${ls.toFixed(ls >= 100 ? 0 : 1)} Ls`;
  return `${Math.round(ls * 299792)} km`;
}

export function activityLabel(a) {
  if (!a) return 'Idle';
  let s = ACTIVITY[a.id] || a.id.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  if (a.id === 'tinker' && a.params && a.params.object) s += ` · ${a.params.object}`;
  if (a.phase && a.phase !== 'perform') s = `On the way: ${s.toLowerCase()}`;
  return s;
}

/**
 * Estimated vitals. The sim models needs, exertion and condition; heart rate
 * and skin temperature are derived from those, not simulated separately.
 */
export function vitals(state, exertion) {
  const tr = state.traveler;
  const n = tr.needs;
  const hr = Math.round(58 + 26 * exertion + 18 * n.stress + 10 * Math.max(0, n.fatigue - 0.6) - 6 * tr.body.fitness);
  const temp = 36.5 + 0.35 * Math.min(1, exertion / 2) + 0.4 * Math.max(0, state.ship.thermal.heat - 0.6);
  return { hr, temp: Math.round(temp * 10) / 10, condition: pct(tr.body.condition), fitness: pct(tr.body.fitness) };
}

export function telemetryFor(state, data, feedDef, exertion = 0.5) {
  const tr = state.traveler;
  const n = tr.needs;
  const f = state.ship.flight;
  const sys = currentSystem(state, data);
  const p = shipPos(state, data);
  const starDist = Math.max(0, Math.hypot(p.x, p.y) - sys.star.radius);
  const body = f.at && sys.byId[f.at];
  const target = f.target && f.target.body && (f.target.body === 'star' ? sys.star.label : sys.byId[f.target.body] && sys.byId[f.target.body].name);
  let where = FLIGHT[f.mode] || f.mode;
  if (body) where += ` · ${body.name}`;
  else if (target) where += ` → ${target}`;
  const sh = state.ship;
  const faults = Object.values(sh.components).filter((c) => c.fault).length;
  const feedLabel = feedDef ? `${feedDef.id}${feedDef.label ? ` ${feedDef.label}` : ''}` : '';
  const travelerRoom = tr.pos && tr.pos.room;
  return {
    camera: { feed: feedLabel, room: feedDef && feedDef.room ? titleRoom(data, feedDef.room) : feedDef && feedDef.rover ? 'Rover cab' : feedDef && feedDef.port ? 'Station concourse' : feedDef && feedDef.exterior ? `Hull exterior${feedDef.mount ? ` · ${feedDef.mount.toLowerCase()}` : ''}` : 'Helmet' },
    location: {
      system: sys.name, star: `${sys.star.label}${sys.star.companion ? ' + companion' : ''}`, starType: sys.star.type || sys.star.cls,
      status: where, starDistance: formatDistance(starDist), time: formatShipTime(state),
    },
    traveler: {
      where: travelerRoom ? titleRoom(data, travelerRoom) : '—', inView: !!(feedDef && feedDef.room && feedDef.room === travelerRoom),
      doing: activityLabel(tr.activity),
      needs: [['Hunger', n.hunger], ['Thirst', n.thirst], ['Fatigue', n.fatigue], ['Hygiene', n.hygiene], ['Bladder', n.bladder ?? 0], ['Stress', n.stress]].map(([k, v]) => ({ k, v: pct(v) })),
      mood: { wonder: pct(tr.mood.wonder), weariness: pct(tr.mood.weariness) },
      vitals: vitals(state, exertion),
    },
    ship: {
      power: sh.power.mode, battery: pct(sh.power.battery / sh.power.batteryCap), reactorKW: Math.round(sh.power.reactorOut || 0),
      fuel: `${sh.fuel.tons.toFixed(1)} / ${sh.fuel.capacity} t`, heat: pct(sh.thermal.heat), o2: sh.atmo.o2.toFixed(1), co2: Math.round(sh.atmo.co2),
      water: Math.round(sh.water.potable), faults,
      credits: state.space ? Math.round(state.space.credits || 0) : 0, missions: state.space && state.space.missions ? state.space.missions.map((x) => x.title) : [],
    },
  };
}
