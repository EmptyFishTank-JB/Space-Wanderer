# Autonomous Deep-Space Terrarium

A passive observation window into the life of a solitary traveler aboard a
deep-space vessel. Not a game: the viewer never steers anything.

**Status: Phases 1–3 complete — life-support simulation, persistence,
Elite Dangerous-scale spaceflight, and the pixel-art observation window.**
Sound arrives in Phase 4. Open with `?debug` for a developer-only inspector, or
`dev/gallery.html` to see every camera feed rendered from staged scenarios.

### Watching

The window is passive. Move the mouse or press a key and a faint feed
selector appears for three seconds; that is the only interface.

| Input | Effect |
|---|---|
| click a feed code, `[` / `]`, ↑ / ↓ | switch camera (`CAM-01 BRIDGE` … `CAM-08 EXT-HULL` … `EVA-POV`) |
| drag, ← / → | pan within the current camera's physical bounds |
| `F` / ⛶ | fullscreen |

After 30 s without camera input the director fades back to the traveler.

## Running

```bash
npm test                                   # 47 tests, ~15 s
node tools/run.mjs --hours 8 --timeline    # watch a slice of life in the terminal
node tools/run.mjs --days 30 --summary     # long run + hours-by-activity
node tools/run.mjs --days 2 --logs         # dump structured log-entry facts
python3 -m http.server 8080                # then http://localhost:8080/  (or /?debug, /dev/gallery.html)
```

No build step, no dependencies. Deploys to GitHub Pages as static files.

## Architecture (Phase 1)

```
data/                 JSON definitions (all tuning lives here)
  ship.json           room graph: rooms, stations (x in metres), hatches
  components.json     wearable hardware, fault ladders, repair/maintenance costs
  crops.json          crops, cycles, yields, spoilage, photoperiod
  routines.json       chained habits (morning, meal, evening, rounds)
  traveler.json       personality traits, schedule, hobby weights
  space.json          galaxy density/rifts, star classes, drive, supercruise, scoop, descent, EVA tuning
  cameras.json        feeds, viewport yaw per room, director timings (linger, min shot, idle return…)
  config.json         tick cadences, catch-up cap, autosave
src/sim/              headless simulation — zero DOM, deterministic
  engine.js           fixed 1 s step; slow (10 s) and hazard (60 s) cadences
  state.js            initial state (pure JSON)
  rng.js              seeded sfc32; generator state lives in the snapshot
  clock.js            mission calendar (base epoch + sim time + torpor)
  events.js           event bus → outbox, notable ring buffer, log digest
  catchup.js          deterministic offline catch-up (+ torpor beyond cap)
  runner.js           live 1:1 wall-clock runner (clock injected)
  boot.js             restore → catch up → persist
  ship/               power+thermal, water+atmosphere, hydroponics+algae, food, wear/faults
  traveler/           physiology & mood drift, room-graph navigation
  ai/                 action library, utility brain with hysteresis, log facts
src/space/            spaceflight & exploration — zero DOM, deterministic
  galaxy.js           hash-seeded star cells, density field with rifts, neighbour search
  system.js           star + planets + moons + belts, Kepler orbits, signals, beauty/rarity
  flight.js           flight modes: supercruise, scooping, charging/hyperspace, descent/ascent
  navigator.js        route plotting (fuel-safe), in-system agendas, rift detection
  discovery.js        survey/scan results, wonder & novelty, keepsakes, confirmed life
  eva.js              suit-up → airlock → surface walk (helmet-cam data) → return
  torpor.js           void crossings: years on the calendar in one long night
  actions.js          flight actions for the utility AI (survey, plot, jump, scoop, land, EVA…)
  view.js             what is outside the viewport and how much it pulls
src/render/           pixel-art renderer — reads the sim, never writes it
  gfx.js              320×180 framebuffer primitives, hash/value noise, 3×5 pixel font
  spaceview.js        true-scale view model: bearings + angular radii from Ls geometry
  celestial.js        starfield, stars (limb darkening, granulation, prominences),
                      textured planets (terminator, atmosphere rim, clouds, rings),
                      hyperspace tunnel, the void
  terrain.js          planetary skies, parallax ridges, ground clutter, EVA features
  rooms.js            twelve compartments: shell, doors, windows, props, diegetic cues
  traveler.js         procedural pixel figure, ~15 poses, walk cycle, yawns, slouch
  actor.js            1 Hz sim → 60 fps: interpolation, facing, pose selection
  feed.js             composition: space behind glass → room → lighting → glare/strobes
  exterior.js         hull camera (radiator glow, shield shimmer, scorch, frost)
  eva.js              helmet cam (visor, suit LED, dust, frost, breath, head-bob)
  director.js         autonomous camera director + viewer feed/pan controls (no DOM)
  app.js              frame loop, integer-scale blit
src/ui/switcher.js    the auto-hiding feed selector
src/persist/          localStorage snapshots (+backup slot), IndexedDB journal, export/import
src/dev/inspector.js  ?debug overlay — QA only, never part of the experience
src/main.js           browser entry
tools/run.mjs         terminal runner
```

### Determinism

`step(state, data)` depends on nothing but its arguments. All randomness
comes from a seeded PRNG whose state is serialized with everything else, so:

* the same seed gives the same life,
* a snapshot restored mid-run continues the identical timeline, and
* **catch-up equals live**: a tab closed for six hours replays exactly the six
  hours the viewer would have watched (tested against an irregularly pumped
  live runner).

Absences longer than `config.catchup.maxDays` (120) are booked as a torpor
stretch on the mission calendar rather than simulated tick by tick. 120 days
catches up in about 5 s in Node.

### The closed loop

| System | Depends on | Feeds |
|---|---|---|
| Reactor & battery | fuel, coolant loop wear, heat | every load; sheds grow lamps → lighting → galley/fabricator in *conserve* / *limp* modes |
| Thermal | reactor output, vent wear | component wear rate, reactor throttling, traveler stress |
| Water | recycler filter, dehumidifier, OGS draw | drinking, washing, tray irrigation, coolant purges |
| Atmosphere | plants & algae under lamps, OGS, scrubber cartridge | CO₂ → fatigue/stress, sleep quality |
| Hydroponics | lamps, pumps, humidity, CO₂, *tending* | O₂, food, seeds, morale |
| Food | harvests, algae vat, pantry, sealed emergency crate | hunger, meal quality → mood |
| Wear | run hours × heat | faults (minor → major), repairs, parts, feedstock |
| Traveler | all of the above | fatigue slows work and causes repair mistakes; stress, solitude, wonder/weariness |

Failsafes keep the ship from ever bricking: jury-rigs without parts, an algae
culture that never dies, a sealed water reserve and O₂ tanks, solar trickle in
limp mode, and a body-condition floor. Shortages become recovery chapters.

### Traveler AI

Utility scoring over ~35 actions with **task inertia**: an activity can only
be interrupted by urgent categories (critical, repair, needs, sleep), and only
by beating its score plus a commitment bonus plus a switching margin. Alarms
cut through sleep. Near-ties are chosen by weighted chance; distance costs a
little; leisure suffers from boredom; routines chain habits (wake → stretch →
water → wash → breakfast → dishes → scans → racks). Typical day: wake ~07:00,
three meals, ~2 interrupts, bed ~22:45.

### Spaceflight (Phase 2)

Nothing about the galaxy is stored: stars are regenerated from
`(galaxySeed, cell)` and systems from `(galaxySeed, starId)`. Only what the
traveler did and found goes into the snapshot (~40–70 KB after months).

* **Scale.** In-system distances in light-seconds, between stars in
  light-years. Planets follow Kepler orbits against mission time.
* **Supercruise.** Exponential acceleration, gravity-well speed caps
  (`v ≤ 2001c · ((r−R)/well)^1.5`), and a 7-second approach rule. The ship flies
  in the destination's frame, steers around the star, and arrives in orbital
  cruise. Trips take 2–7 real minutes for inner worlds and longer for outer ones.
* **Hyperspace.** Preflight at the helm (1.5–3 min), 20 s charge, 32–48 s
  transit, emergence ~6 stellar radii from the new star. Fuel cost is
  `8 t · (d/range)^2.45`. The drive coil wears per jump.
* **Fuel scooping** (KGBFOAM stars). The traveler dives to ~1.55 radii and flies
  a heat ceiling (~0.84), checking more slowly when tired. Misjudged dives and
  lapses of attention push heat past 1.0, which damages the scoop manifold,
  hull, vents and sensors. The ship's computer cuts out when the tank is full,
  heat exceeds 1.1, or nobody is at the helm. Scoops typically peak at 0.8 heat
  and take 10–20 min.
* **Planetary approach.** Orbital cruise (4–7 min) → atmospheric entry with
  heating and buffeting → glide, or a powered descent on airless worlds →
  touchdown. About 10–17 min in real time. Ascent takes 5–8 min.
* **EVA.** Suit-up and airlock cycle, then a surface walk past features
  (outcrops, ice ridges, geysers, bio mats, anomalies) at 0.9 m/s. The traveler
  collects ore and ice, turns back on suit O₂, fatigue or a ship alarm, and may
  patch the hull while outside. Ore is refined into feedstock and ice is melted
  into the water loop, which closes Phase 1's slow feedstock drain.
* **Autonomous decisions.** A survey after each arrival builds an agenda
  (scoop, visit/scan/land/EVA, linger at beautiful worlds) weighted by
  curiosity, weariness, fatigue and fuel. Sleep and meals still win, so the
  ship holds orbit overnight. Wanderlust grows over the hours after arrival,
  giving roughly 2–3 systems per day.
* **Route plotting.** Prefers progress along the mission heading and rare
  stars, and never jumps to a non-scoopable star without fuel for two more
  jumps. If somehow stranded, a collector trickle refuels the ship.
* **Torpor.** Low-density rifts in the galaxy are crossed in torpor. The
  traveler winterises the hydroponics bay and enters the pod in the evening;
  10–15 real hours later the calendar has advanced years, always in whole
  days. Expect a crossing every few weeks: centuries of mission time over a
  few real years.
* **Mood.** Wonder rises with rare stars, notable worlds, first landings and
  awe at the viewport, with diminishing returns. Weariness is a separate axis:
  it is relieved only by genuine novelty and drifts up through monotony,
  strain and solitude. Microbial life is rare (a few times a season, mostly
  on earth-likes) and is confirmed only in person on an EVA.

### The observation window (Phase 3)

Everything is drawn procedurally into a 320×180 framebuffer at 32 px/m. It is
blitted at the largest whole-number scale (4× at 1280×720, 6× at 1080p) with
no smoothing. There are no image assets.

* **Room cameras.** Fixed side-on views. In rooms wider than the frame
  (hydroponics, engineering, corridors) the camera tracks the traveler with an
  eased, dead-zoned pan. Doors slide open as the traveler cycles a hatch.
* **Director.** When the traveler leaves a room the camera lingers 2–4 s on
  the empty room, then cuts. Corridor transits shorter than the linger are
  skipped. Jumps, arrivals, scooping, orbit insertion, entry, touchdown and
  liftoff cut to the hull camera. Discretionary cuts wait out a 20–90 s
  minimum shot. Every 12–25 min there is a brief hold on a room where
  something is happening (misting racks, an arcing junction box, a fault
  relay). Stepping outside switches to the helmet cam until the airlock
  closes again.
* **True scale through the glass.** Bodies are drawn from their actual
  angular size, so a world 1000 Ls away is a pinpoint and in orbital cruise it
  fills the viewport. Planets are textured spheres lit by their real star
  direction, with atmospheres, drifting clouds, rings and terminators.
* **Diegetic cues (spec §4)**, all drawn in the world:
  * **Scooping:** glare floods the bridge, amber then red caution strobes, waveform spikes, glowing radiator fins and vents, shield shimmer.
  * **Hydroponics:** crop stages by species, water gauges, grow-lamp colour and ballast flicker, misting, condensation on the bay glass.
  * **Life support:** status LEDs per machine, the OGS bubbling, the dehumidifier fan stopping when it seizes.
  * **Wear and faults:** flickering corridor lights, sparks at the junction box, juddering pumps and reactor, scorch on the hull.
  * **Traveler:** slouch and yawns when tired, clutter on desk and counters, keepsakes on the quarters shelf, sketches pinned in the lounge.
  * **Logs:** text typing on the terminal while a log is written.
* **Lighting.** Circadian dimming, a dark quarters while the traveler sleeps
  (just the bunk lamp and the porthole), red emergency light in limp mode, and
  pink grow-lamp spill in the bay.

### Persistence

* `localStorage`: snapshot (~7 KB) with a previous-snapshot backup slot;
  autosave every 30 s, on tab hide, and on `pagehide`.
* `IndexedDB` (`deep-space-terrarium`): `events` (notable events, the raw
  material for Phase 5 memories), `systems` (one record per visited system:
  star, bodies visited/landed, discoveries), and a reserved `memories` store.
* Phase 1 (v1) snapshots upgrade automatically: the coasting ship is placed at
  a home system and keeps its traveler, ship state and history.
* Hidden backup shortcuts: **Ctrl+Alt+Shift+E** export, **Ctrl+Alt+Shift+I** import.

## Hooks left for later phases

* **Phase 3 (done):** see above.
* **Phase 3 hooks used:**
  * Interior: events carry `room`, `station`, `x` and `posture`; `gait()` gives walking speed.
  * Flight: `flight.mode`, `altitudeKm`, `buffeting`, `entryHeat`, `wellRatio` (supercruise speed fraction), `starRadii` and `externalHeat` (glare and caution strobes).
  * Exterior views: `viewSubject()` picks the shot; bodies carry `type`, `rings`, `atmosphere`, `hue` and `beauty`.
  * EVA: the head-cam is the `surface` pseudo-room with `x` in metres; `eva_feature` events say what is being looked at.
* **Phase 4 (audio):**
  * Supercruise: `supercruise_engage`, `wellRatio` for gravitational drag pitch.
  * Hyperspace and scooping: `hyperspace_charge/enter/exit`, `scoop_start`, `heat_warning`, `heat_damage`.
  * Planetary: `descent_phase` (entry wind shear), `touchdown`, `liftoff`.
  * EVA: `eva_phase` for suit breathing and airlock cycling.
* **Phase 5 (memory and logs):**
  * `log_entry.facts.voyage` lists arrivals, discoveries, landings, EVAs, scoops, awe and torpor since the last entry.
  * `traveler.keepsakes` holds mineral specimens, sealed bio vials and anomaly fragments for the quarters shelf.
  * Visited systems are stored in IndexedDB `systems`.
