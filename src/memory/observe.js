// Episodic memory formation. Notable sim events are weighed and, if they
// matter enough, become structured memory records (spec §9):
//   { id, timestamp, mission_year, day, system_id, system_name, star_class,
//     event_type, emotional_weight, valence, subject, summary, tags,
//     callback_count, last_recalled_t }
// Records live in the snapshot (a bounded working set used for callbacks and
// reflection) and are mirrored to IndexedDB via `memory_formed` events.
import { missionSeconds, missionDay, missionYear } from '../sim/clock.js';

export const MEMORY_CAP = 100;
const DEDUPE_SECONDS = 2 * 86400;

const ANOMALY = { crystalline_spires: 'crystal spires', patterned_vents: 'patterned vents', unexplained_signal: 'the signal source' };
const TYPE_WORD = { earth_like: 'earth-like world', water_world: 'water world', ammonia: 'ammonia world', gas_giant: 'gas giant', ice_giant: 'ice giant', icy: 'ice moon', rocky: 'rock', metal_rich: 'metal-rich world', high_metal: 'high-metal world' };
const FEATURE = { scarp: 'fault scarp', ejecta_ray: 'ejecta ray', boulder_field: 'boulder field', geyser: 'geysers', fumarole: 'fumaroles', ice_ridge: 'ice ridges', crystalline_spires: 'crystal spires', bio_mat: 'living mats', patterned_vents: 'patterned vents', dune: 'dunes', crater_rim: 'crater rim', outcrop: 'outcrops' };

/** Weigh an event. Returns null if it is not worth remembering. */
export function appraise(state, ev) {
  const sys = state.space ? state.space.systemName || ev.system || '' : '';
  switch (ev.type) {
    case 'discovery':
      switch (ev.kind) {
        case 'life': return { w: 1, v: 1, subject: `the living mats on ${ev.body}`, summary: `Confirmed living mats on ${ev.body} in ${ev.system}.`, tags: ['life', ev.bodyType] };
        case 'anomaly': return { w: 0.85, v: 0.6, subject: `the ${ANOMALY[ev.anomaly] || 'anomaly'} on ${ev.body}`.replace('the the', 'the'), summary: `Found ${ANOMALY[ev.anomaly] || 'something unclassified'} on ${ev.body}.`, tags: ['anomaly'] };
        case 'bio_signal': return { w: 0.55, v: 0.8, subject: `the bio readings over ${ev.body}`, summary: `Picked up biological signals on ${ev.body}.`, tags: ['bio'] };
        case 'star': return { w: (ev.first ? 0.3 : 0.15) + 0.45 * (ev.rarity || 0), v: 0.6, subject: `the ${ev.label} at ${ev.system}`, summary: `Arrived at ${ev.system}, a ${ev.label}.`, tags: ['star', ev.star] };
        case 'body': {
          if (ev.bodyType === 'earth_like') return { w: 0.7, v: 0.9, subject: `the earth-like world ${ev.body}`, summary: `Surveyed an earth-like world, ${ev.body}.`, tags: ['body', ev.bodyType] };
          if (ev.bodyType === 'water_world') return { w: 0.5, v: 0.7, subject: `the water world ${ev.body}`, summary: `Surveyed a water world, ${ev.body}.`, tags: ['body', ev.bodyType] };
          if (ev.rings && (ev.bodyType === 'gas_giant' || ev.bodyType === 'ice_giant')) return { w: 0.42, v: 0.7, subject: `the rings of ${ev.body}`, summary: `Ringed ${TYPE_WORD[ev.bodyType]} at ${ev.body}.`, tags: ['body', 'rings'] };
          if (ev.bodyType === 'ammonia') return { w: 0.38, v: 0.5, subject: `the ammonia world ${ev.body}`, summary: `Surveyed an ammonia world, ${ev.body}.`, tags: ['body', ev.bodyType] };
          if ((ev.rarity || 0) >= 0.5) return { w: 0.3, v: 0.5, subject: ev.body, summary: `Noted ${ev.body}.`, tags: ['body', ev.bodyType] };
          return null;
        }
        default: return null;
      }
    case 'touchdown':
      if (!ev.first) return null;
      return { w: 0.42, v: 0.6, subject: `landing on ${ev.body}`, summary: `First landing on ${ev.body}: ${ev.gravity} g, ${Math.round(ev.tempK - 273)} °C.`, tags: ['landing', ev.bodyType] };
    case 'eva_end': {
      const f = ev.features || [];
      const special = f.find((k) => ['bio_mat', 'crystalline_spires', 'patterned_vents', 'geyser', 'fumarole', 'ice_ridge'].includes(k));
      if (!special && (ev.walkedM || 0) < 1200) return null;
      const w = special === 'bio_mat' ? 0.6 : special ? 0.4 : 0.28;
      return { w, v: 0.7, subject: special ? `the ${FEATURE[special]} on ${ev.body}` : `the long walk on ${ev.body}`, summary: `Walked ${Math.round(ev.walkedM)} m on ${ev.body}${special ? ` out to the ${FEATURE[special]}` : ''}.`, tags: ['eva', special || 'walk'] };
    }
    case 'docked':
      if (!ev.first) return null;
      return { w: 0.45, v: 0.6, subject: `putting in at ${ev.station}`, summary: `Docked at ${ev.station} in ${ev.system}, a ${ev.faction} ${ev.kind === 'outpost' ? 'outpost' : 'station'}.`, tags: ['port', 'people'] };
    case 'port_visit':
      if ((ev.met || 0) < 2) return null;
      return { w: 0.32, v: 0.65, subject: `an evening at the bar on ${ev.station}`, summary: `Talked with ${ev.met} people at the bar on ${ev.station}.`, tags: ['port', 'people'] };
    case 'conversation':
      if (ev.met < 2 && !ev.topic) return null;
      return { w: ev.met >= 3 ? 0.42 : 0.3, v: 0.65, subject: `talking with ${ev.who}`, summary: ev.met >= 2 ? `${ev.who} again${ev.topic ? `: we talked about ${ev.topic}` : ''}.` : `Met ${ev.who}${ev.topic ? ` and told them about ${ev.topic}` : ''}.`, tags: ['people', ev.role] };
    case 'mission_complete': return { w: 0.4, v: 0.6, subject: ev.title, summary: `Delivered: ${ev.title}, for ${ev.reward.toLocaleString('en-US')} credits.`, tags: ['mission', ev.kind] };
    case 'mission_fail': return { w: 0.38, v: -0.6, subject: ev.title, summary: ev.reason === 'caught' ? `Caught with the cargo at ${ev.station}: ${ev.title}. Fined ${ev.fine} credits.` : `Ran out of time: ${ev.title}.`, tags: ['mission', 'hardship'] };
    case 'rover_end': {
      const f = ev.features || [];
      const special = f.find((k) => ['bio_mat', 'crystalline_spires', 'patterned_vents', 'geyser', 'fumarole', 'ice_ridge', 'scarp', 'ejecta_ray'].includes(k));
      if (!special && (ev.km || 0) < 4) return null;
      const w = special === 'bio_mat' ? 0.6 : special ? 0.42 : 0.32;
      return { w, v: 0.7, subject: special ? `the drive out to the ${FEATURE[special] || special.replace(/_/g, ' ')} on ${ev.body}` : `the long drive on ${ev.body}`, summary: `Drove ${ev.km} km in the rover on ${ev.body}${special ? ` out to the ${FEATURE[special] || special.replace(/_/g, ' ')}` : ''}.`, tags: ['rover', special || 'drive'] };
    }
    case 'awe': return { w: 0.34, v: 0.8, subject: ev.name ? `${ev.name} from the window` : 'the view from the window', summary: `Stopped to watch ${ev.name || 'the view'}.`, tags: ['awe', ev.subject] };
    case 'torpor_end': return { w: 0.55, v: 0, subject: `the ${Math.round(ev.years)}-year crossing`, summary: `Crossed ${ev.ly} ly of void in torpor; ${ev.years} years passed.`, tags: ['torpor'] };
    case 'heat_damage': return { w: 0.4, v: -0.7, subject: `running the scoop too hot at ${sys}`, summary: `Took heat damage scooping at ${sys}.`, tags: ['scoop', 'damage'] };
    case 'emergency_reserve':
      if (ev.resource === 'rations') return { w: 0.55, v: -0.6, subject: 'breaking the seal on the emergency rations', summary: 'Opened the emergency ration crate.', tags: ['food', 'hardship'] };
      return { w: 0.45, v: -0.6, subject: 'drawing on the reserve water tank', summary: 'Drew on the sealed water reserve.', tags: ['water', 'hardship'] };
    case 'power_mode': return ev.mode === 'limp' ? { w: 0.4, v: -0.6, subject: 'the night on limp power', summary: 'Ship dropped into limp mode.', tags: ['power', 'hardship'] } : null;
    case 'collapse': return { w: 0.4, v: -0.6, subject: `passing out in the ${ev.room}`, summary: `Fell asleep on my feet in the ${ev.room}.`, tags: ['body', 'hardship'] };
    case 'repair':
      if (ev.severity !== 'major') return null;
      return { w: 0.26, v: 0.3, subject: `fixing the ${ev.name || ev.component}`, summary: `Repaired a major fault in the ${ev.name || ev.component}${ev.juryRig ? ' with improvised parts' : ''}.`, tags: ['repair'] };
    case 'book_finished': return { w: 0.2, v: 0.5, subject: `finishing ${ev.title}`, summary: `Finished reading ${ev.title}.`, tags: ['book'] };
    default: return null;
  }
}

/**
 * Called for each notable event. Returns a memory_formed payload (or null).
 * Very similar memories within two days merge instead of piling up.
 */
export function observe(state, ev) {
  const mem = state.memory;
  if (!mem) return null;
  const a = appraise(state, ev);
  if (!a || a.w < 0.2) return null;
  const sp = state.space || {};
  const dup = mem.records.find((r) => r.event_type === eventType(ev) && r.subject === a.subject && ev.t - r.t < DEDUPE_SECONDS);
  if (dup) {
    dup.emotional_weight = Math.max(dup.emotional_weight, a.w);
    return null;
  }
  const rec = {
    id: mem.nextId++,
    t: state.t,
    timestamp: missionSeconds(state),
    mission_year: missionYear(state),
    day: missionDay(state),
    system_id: sp.systemId || null,
    system_name: sp.systemName || null,
    star_class: sp.starClass || null,
    event_type: eventType(ev),
    emotional_weight: Math.round(a.w * 100) / 100,
    valence: a.v,
    subject: a.subject,
    summary: a.summary,
    tags: a.tags.filter(Boolean),
    callback_count: 0,
    last_recalled_t: null,
  };
  mem.records.push(rec);
  if (mem.records.length > MEMORY_CAP) {
    // forget the faintest: low weight, long ago, never recalled
    let worst = 0;
    let worstScore = Infinity;
    mem.records.forEach((r, i) => {
      const age = (state.t - r.t) / 86400;
      const score = r.emotional_weight * (1 + 0.15 * r.callback_count) / (1 + age / 120);
      if (score < worstScore) { worstScore = score; worst = i; }
    });
    mem.records.splice(worst, 1);
  }
  return rec;
}

export function eventType(ev) {
  return ev.type === 'discovery' ? `discovery_${ev.kind}` : ev.type;
}
