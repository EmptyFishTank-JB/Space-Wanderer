// The traveler's log voice: grounded, observant, understated. Crisp technical
// notes beside quiet wonder; no melodrama. Deterministic per entry: the same
// traveler writes the same words whether watched live or caught up offline.
import { seedRng, rand, hashString } from '../sim/rng.js';
import { formatShipTime } from '../sim/clock.js';
import { pickMemory, markRecalled } from './recall.js';
import { lintLog } from './lint.js';

const CROP = { potato: 'potatoes', soy: 'soybeans', wheat: 'wheat', tomato: 'tomatoes', lettuce: 'lettuce', herbs: 'basil' };
const LIGHT = { M: 'red-orange', K: 'amber', G: 'plain yellow-white', F: 'white', A: 'blue-white', B: 'hard blue', O: 'hard blue', L: 'dim red', T: 'dim magenta', D: 'thin and white', N: 'almost none', BH: 'none' };
const FAULT_PAST = {
  bearing_rattle: 'started rattling at the bearing', pump_seized: 'seized', filter_clog: 'clogged its filter', membrane_tear: 'tore a membrane',
  cartridge_saturation: 'saturated its cartridge', seal_leak: 'started leaking at the seal', electrode_scaling: 'scaled up', cell_failure: 'lost its cell',
  condensate_drip: 'started dripping', fan_seized: 'seized its fan', ballast_flicker: 'started flickering', bank_failure: 'went dark',
  bubbler_clog: 'clogged', bubbler_failure: 'stopped bubbling', flicker: 'started flickering', dark_section: 'went dark in one section',
  arcing: 'started arcing', breaker_trip: 'tripped', element_weak: 'went weak', element_out: 'burned out',
  calibration_drift: 'drifted out of calibration', array_offline: 'went offline', nozzle_clog: 'clogged at the nozzle', extruder_jam: 'jammed',
  coolant_pump_vibration: 'started vibrating', coolant_pump_failure: 'lost its pump', vent_clog: 'clogged up', vent_blockage: 'blocked up',
  coil_harmonic: 'picked up a harmonic', coil_failure: 'failed', manifold_leak: 'started weeping', manifold_rupture: 'ruptured',
  micrometeorite_pitting: 'took some pitting', plating_breach: 'breached', seal_creep: 'started creeping', seal_failure: 'failed',
};
const PAST = { swap: 'swapped', replace: 'replaced', reseat: 'reseated', clear: 'cleared', descale: 'descaled', clean: 'cleaned', retorque: 'retorqued', recalibrate: 'recalibrated', rebalance: 'rebalanced', reseal: 'resealed', patch: 'patched' };
const BODY_COLOUR = {
  gas_giant: ['copper', 'rust and cream', 'ochre', 'pale tan'], ice_giant: ['grey-blue', 'pale cyan', 'slate'], earth_like: ['blue and green', 'blue, with white weather'],
  water_world: ['deep blue', 'dark teal'], ammonia: ['olive', 'dull gold'], icy: ['ivory', 'blue-white'], rocky: ['grey-brown', 'dun'], metal_rich: ['dark rust', 'iron grey'], high_metal: ['brown-grey', 'bronze'],
};
const FEATURE = { geyser: 'geysers', fumarole: 'fumaroles', ice_ridge: 'ice ridge', crystalline_spires: 'crystal spires', bio_mat: 'mats', patterned_vents: 'vents', dune: 'dunes', crater_rim: 'crater rim', outcrop: 'outcrop', regolith_plain: 'flats' };

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const kg = (x) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));
const numWord = (n) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][n] ?? String(n);
const listJoin = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function pastFix(label) {
  const [verb, ...rest] = label.split(' ');
  return `${PAST[verb] || verb + 'ed'} the ${rest.join(' ')}`.replace(/\bthe the\b/, 'the');
}

/**
 * Build a log entry. ctx: { state, data, facts, entry, skills, books }
 * Returns { header, sentences, text, callback }.
 */
export function writeLog({ state, data, facts, entry }) {
  const st = seedRng(hashString(`${state.seed}|log|${entry}`));
  const r = () => rand(st);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const v = facts.voyage || {};
  const name = (id) => (data.components[id] ? data.components[id].name : id);
  const lines = { travel: [], tech: [], food: [], find: [], wonder: [], self: [] };

  // ── travel ──
  if (v.torpor) {
    lines.travel.push(pick([
      `Out of the pod. The calendar says ${v.torpor.years} years; we are ${v.torpor.ly} ly further on.`,
      `Torpor crossing done: ${v.torpor.years} years, ${v.torpor.ly} ly. Joints stiff, eyes slow to focus.`,
    ]));
    lines.travel.push(pick(['The bay came back without losses. Watered everything twice.', 'Coffee took three tries to get right.', 'New sky. None of the old reference stars in the right places.']));
  }
  const jumps = (v.arrivals || []).filter((a) => a.via === 'jump');
  if (jumps.length === 1) {
    const j = jumps[0];
    lines.travel.push(pick([`Jumped ${Math.round(j.ly)} ly to ${j.system}, a ${j.label}.`, `One jump today, ${Math.round(j.ly)} ly, to a ${j.label} called ${j.system}.`, `Arrived at ${j.system} after a ${Math.round(j.ly)} ly jump.`]));
  } else if (jumps.length > 1) {
    const ly = Math.round(jumps.reduce((s, a) => s + a.ly, 0));
    const last = jumps[jumps.length - 1];
    lines.travel.push(pick([`${cap(numWord(jumps.length))} jumps, ${ly} ly. Now at ${last.system}, a ${last.label}.`, `Covered ${ly} ly in ${numWord(jumps.length)} jumps. Ended the day at ${last.system}.`, `Made ${numWord(jumps.length)} jumps along the heading, ${ly} ly in all.`]));
  } else if (!v.torpor && r() < 0.5) {
    lines.travel.push(pick([`Stayed in ${v.system} today.`, `No jumps. Still at ${v.system}.`]));
  }
  for (const s of (v.scoops || []).slice(0, 1)) {
    if (s.reason === 'overheat' || s.reason === 'auto_overheat' || v.heatDamage) lines.tech.push(pick([`Went too deep on the scoop and the manifold took heat. Pulled out at ${Math.round(s.peakHeat * 100)}% of limit.`, `Misjudged the corona. Heat went past the limit before I backed off; manifold needs looking at.`]));
    else if (s.tons > 1 && (s.peakHeat > 0.85 || r() < 0.55)) lines.tech.push(pick([`Scooped ${kg(s.tons)} t. Heat peaked at ${Math.round(s.peakHeat * 100)}% of limit.`, `Topped the tank from the star: ${kg(s.tons)} t, heat to ${Math.round(s.peakHeat * 100)}%.`, `Took on ${kg(s.tons)} t of fuel.${s.peakHeat > 0.85 ? ' Ran it close on heat.' : ''}`, `Fuel scoop, ${kg(s.tons)} t. Cabin smelled of hot metal afterwards.`]));
  }

  // ── ship (technical) ──
  const repairs = facts.repairs || [];
  for (const rep of repairs.slice(0, 2)) {
    const comp = name(rep.component);
    const def = data.components[rep.component];
    const what = FAULT_PAST[rep.fault] || 'faulted';
    if (rep.juryRig) lines.tech.push(`${cap(comp)} ${what}. No spares, so I patched it with what was in the bin. Needs doing properly.`);
    else if (def && r() < 0.6) lines.tech.push(`${cap(comp)} ${what}; ${pastFix(def.maintain.label)} before it got worse.`);
    else lines.tech.push(`${cap(comp)} ${what}. Fixed it.`);
  }
  if (facts.mistakes > 0) lines.tech.push(pick(['Botched a repair from tiredness and had to redo it.', 'Made a mess of the first attempt at a repair. Too tired; slept on it.']));
  const maint = (facts.maintenance || []).filter((id) => data.components[id]);
  if (maint.length && lines.tech.length < 2) lines.tech.push(`${cap(pastFix(data.components[maint[0]].maintain.label))}${maint.length > 1 ? ` and ${numWord(maint.length - 1)} other small job${maint.length > 2 ? 's' : ''}` : ''}.`);
  const open = (facts.openFaults || []).filter((f) => f.severity === 'major');
  if (open.length) lines.tech.push(`Still have to deal with the ${open[0].component}.`);
  if ((facts.powerModes || []).includes('limp')) lines.tech.push('Power dropped to limp mode for a while. Lamps off, cabin lights down to emergency red.');
  else if ((facts.powerModes || []).includes('conserve')) lines.tech.push('Ran in power conserve for part of the day.');
  if (facts.co2 > 1800) lines.tech.push(`CO2 at ${facts.co2} ppm. Headache by evening.`);
  const fab = facts.fabricated || {};
  const fabParts = Object.entries(fab).filter(([, n]) => n > 0).map(([k, n]) => `${numWord(n)} ${n === 1 ? k.replace(/s$/, '') : k}`);
  if (fabParts.length && r() < 0.6) lines.tech.push(`Printed ${listJoin(fabParts)}.`);
  if (facts.salvageKg > 1 && r() < 0.5) lines.tech.push(`Pulled ${kg(facts.salvageKg)} kg of scrap out of stores for the fabricator.`);

  // ── racks & galley ──
  const hv = facts.harvests || [];
  if (hv.length) {
    const byCrop = {};
    for (const h of hv) byCrop[h.crop] = (byCrop[h.crop] || 0) + h.kg;
    const parts = Object.entries(byCrop).map(([c, k]) => `${kg(k)} kg of ${CROP[c] || c}`);
    lines.food.push(`Took ${listJoin(parts)} off the racks.${facts.plantings && facts.plantings.length ? ` Replanted with ${listJoin([...new Set(facts.plantings.map((c) => CROP[c] || c))])}.` : ''}`);
  }
  if (facts.deadTrays > 0) lines.food.push(`Lost a rack. ${pick(['Should have caught it sooner.', 'Composted what was left.'])}`);
  if (facts.spoiledKg > 1) lines.food.push(`${kg(facts.spoiledKg)} kg of greens went over before I could use them.`);
  if (facts.algaeHeavyMeals >= 2) lines.food.push(`Mostly algae paste today. Pantry is at ${facts.pantryDays} days.`);
  else if (facts.pantryDays < 15 && r() < 0.5) lines.food.push(`Pantry down to ${facts.pantryDays} days of stores.`);
  if (facts.avgMealQuality > 0.68 && r() < 0.4) lines.food.push(pick(['Fresh tomatoes with dinner. Small thing; it helped.', 'Ate well tonight.', 'Basil on the potatoes. Worth growing.']));

  // ── finds ──
  // Chronology: when the entry ends at a later system, finds from an earlier
  // stop that day get an explicit time reference instead of reading as "here".
  const here = v.system || '';
  const elsewhere = (sysName, bodyName) => {
    const s0 = sysName || (bodyName && here && !bodyName.startsWith(here) ? bodyName : '');
    return !!(s0 && here && !s0.startsWith(here) && jumps.length > 0);
  };
  const earlier = (line, sysName, bodyName) => (elsewhere(sysName, bodyName) ? `Earlier, ${line.charAt(0).toLowerCase()}${line.slice(1)}` : line);
  for (const d of (v.discoveries || []).slice(0, 3)) {
    const before = elsewhere(d.system, d.body);
    if (d.kind === 'life') lines.find.push(before ? `Earlier, on ${d.body}: the mats there are alive. Took a sealed sample.` : pick([`The mats on ${d.body} are alive. Took a sealed sample. Checked the seal three times.`, `Confirmed it: ${d.body} has life. Microbial mats in a sheltered hollow, slow and green-brown.`]));
    else if (d.kind === 'anomaly') lines.find.push(before ? `Earlier, on ${d.body}: something the sensors wouldn't classify. Logged it.` : `Something on ${d.body} the sensors won't classify. Logged it, will look again.`);
    else if (d.kind === 'bio_signal') lines.find.push(before ? `Picked up bio signals on ${d.body} before we moved on.` : `Bio signals on ${d.body}. Want a closer look before we leave.`);
    else if (d.kind === 'body' && d.bodyType === 'earth_like') lines.find.push(before ? `Earlier we passed ${d.body}, an earth-like world: open water, a nitrogen-oxygen atmosphere.` : `${d.body} reads as earth-like: open water, a nitrogen-oxygen atmosphere.`);
    else if (d.kind === 'body' && d.bodyType === 'water_world') lines.find.push(before ? `Earlier, ${d.body} turned out to be a water world. No land on the scans.` : `${d.body} is a water world. No land anywhere on the scans.`);
    else if (d.kind === 'body' && d.rings) lines.find.push(before ? `Earlier, ${d.body} had rings: narrow, dust-grey, with a gap near the inner edge.` : `${d.body} has rings. Narrow, dust-grey, with a gap near the inner edge.`);
    else if (d.kind === 'star' && d.label) {
      const named = out0(lines.travel).includes(d.system) && !before;
      if (d.first) lines.find.push(before ? `Earlier, at ${d.system}: my first ${d.label} up close.` : named ? `Never been near a ${d.label} before.` : pick([`First ${d.label} I've seen up close, at ${d.system}.`, `${d.system} is a ${d.label}. Never been near one before.`]));
      else lines.find.push(before ? `Passed another ${d.label} at ${d.system} on the way.` : pick([`Another ${d.label}. They still make me stop and look.`, `${named ? 'The' : `${d.system}'s`} ${d.label} is worth the detour.`]));
    }
  }
  for (const l of (v.landings || []).slice(0, 1)) lines.find.push(earlier(`Set down on ${l.body}. ${l.gravity} g, ${Math.round(l.tempK - 273)} °C outside.`, null, l.body));
  for (const e of (v.evas || []).slice(0, 1)) {
    const feats = (e.features || []).filter((f) => FEATURE[f]).map((f) => FEATURE[f]);
    const samples = [];
    if (e.samples && e.samples.ore > 0) samples.push(`${kg(e.samples.ore)} kg of ore`);
    if (e.samples && e.samples.ice > 0) samples.push(`${kg(e.samples.ice)} kg of ice`);
    lines.find.push(`Walked ${Math.round(e.walkedM)} m out${feats.length ? ` to the ${feats[feats.length - 1]}` : ''} and back.${samples.length ? ` Brought in ${listJoin(samples)}.` : ''}`);
  }

  // ── quiet wonder (at most one) ──
  const at = v.atBody;
  if ((v.awe || []).length || (at && at.beauty > 0.6 && r() < 0.5)) {
    if (at) {
      const col = pick(BODY_COLOUR[at.type] || ['grey']);
      const opts = [`Watched ${at.name} turn under us for ${20 + Math.floor(r() * 40)} minutes. The colour is ${col} from this altitude.`,
        `Drifted above the terminator line for a while. ${at.name} goes from ${col} to nothing at the edge.`];
      if (at.rings) opts.push(`The rings throw a thin shadow across ${at.name}. Sketched it twice and got it wrong both times.`);
      if (at.atmosphere === 'thick') opts.push(`Weather moving on ${at.name}; long ${col} bands, slow from up here.`);
      lines.wonder.push(pick(opts));
    } else if (v.starClass) {
      lines.wonder.push(pick([`Sat in the lounge with the lights off. The ${v.star} puts ${LIGHT[v.starClass] || 'pale'} light across the floor.`, `Watched the ${v.star} from the bridge for a while after the scans.`]));
    }
  }

  // ── personal ──
  const hob = facts.hobbies || {};
  if (facts.sleep && facts.sleep.hours < 6) lines.self.push(`Slept badly. ${facts.sleep.hours.toFixed(1)} hours.`);
  for (const b of (facts.books || []).slice(0, 1)) lines.self.push(`Finished ${b}. ${pick(['Will start the next one tomorrow.', 'Good ending.', 'Slow middle, worth it.'])}`);
  if (facts.sketch && hob.sketch) lines.self.push(`Finished a sketch of ${facts.sketch}. ${pick(['Pinned it up.', 'Better than the last one.', 'The proportions are off.'])}`);
  if (hob.play_instrument && r() < 0.5) {
    const sk = (facts.skills && facts.skills.instrument) || 0;
    lines.self.push(sk < 0.35 ? pick(['Practised the instrument. Still clumsy on the changes.', 'Half an hour of scales. Fingers slow.', 'Tried the slow piece again. Not yet.'])
      : sk < 0.65 ? pick(['Practised the instrument. The slow piece is getting there.', 'Got through the slow piece twice without stopping.'])
        : pick(['Played for a while after dinner. It sounds like music now, most nights.', 'Played the slow piece for the racks. They did not complain.']));
  }
  if (hob.listen_music && r() < 0.5) lines.self.push(pick(['Put the old recordings on after dinner.', 'Music on in the lounge while I cleaned up.']));
  if (hob.play_solitaire && r() < 0.4) lines.self.push(`Worked through ${numWord(1 + Math.floor(r() * 4))} of the chess problems.`);
  if (!facts.exercised && r() < 0.3) lines.self.push('Skipped the rower again.');
  const m = facts.mood || {};
  if (m.weariness > 0.5 && facts.daysSinceNovelty > 4) lines.self.push(pick(['Another quiet system. Kept to the routine; it helps.', 'Not much new out here lately. Kept busy.']));
  if (m.solitude > 0.6 && r() < 0.6) lines.self.push(pick(['Read back through some old entries before bed.', 'Talked to the plants while I watered them. Habit now.']));

  // ── assemble: technical first, wonder rare, short on quiet days ──
  const out = [];
  // a sentence budget (not a line budget): busy days still read as a short entry
  const sentenceCount = (x) => x.split(/(?<=[.?])\s+/).length;
  const budget = 5 + Math.floor(r() * 3);
  let used = 0;
  const take = (arr, n) => {
    for (const x of arr.slice(0, n)) {
      const k = sentenceCount(x);
      if (used + k > budget && out.length) continue;
      out.push(x);
      used += k;
    }
  };
  // now and then a personal detail carries the entry instead of the itinerary
  if (!v.torpor && lines.self.length && r() < 0.18) take([lines.self.splice(Math.floor(r() * lines.self.length), 1)[0]], 1);
  take(lines.travel, v.torpor ? 2 : 1);
  take(lines.find, 2);
  take(lines.tech, 2);
  take(lines.wonder, 1);
  take(lines.food, 1);
  take(shuffle(lines.self, r), 2);
  if (out.length < 2) out.push(pick(['Quiet day. Racks watered, filters fine.', 'Routine day. Nothing to report from the systems.', 'Ship ran clean today.', 'Nothing broke. Wrote that down because it is rare.']));

  // ── a callback, sometimes ──
  let callback = null;
  if (r() < 0.38) {
    const tags = [...(v.discoveries || []).map((d) => d.bodyType || d.kind), ...(v.landings || []).map((l) => l.bodyType), ...(v.evas || []).length ? ['eva'] : []];
    const rec = pickMemory(state, r(), { tags, minAgeDays: 5, minWeight: 0.4 });
    if (rec) {
      callback = rec;
      const daysAgo = Math.max(1, Math.round((state.t - rec.t) / 86400));
      const opts = [`Thought about ${rec.subject} again today.`, `${cap(String(daysAgo))} days since ${rec.subject}. Still think about it.`];
      if (rec.tags.includes('life') || rec.tags.includes('anomaly')) opts.push(`Checked the sample from ${rec.subject.replace(/^the [a-z ]+ on /, '')} on the shelf. Seal still good.`);
      if (rec.valence < 0) opts.push(`Better than ${rec.subject}, anyway.`);
      if (rec.tags.includes('body') || rec.tags.includes('awe')) opts.push(`Compared today's scans against ${rec.subject}. Nothing like it.`);
      out.push(pick(opts));
    }
  }

  const header = `${formatShipTime(state)} · ${v.system || 'in transit'}${v.at ? `, ${v.mode === 'landed' ? 'on' : 'orbiting'} ${v.at}` : ''}`;
  const sentences = out.filter((s) => lintLog(s).length === 0);
  return { header, sentences, text: sentences.join(' '), callback };
}

const out0 = (arr) => arr.join(' ');

function shuffle(a, r) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

export { markRecalled };
