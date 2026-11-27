# Autonomous Deep-Space Terrarium

A passive observation window into the life of a solitary traveler aboard a
deep-space vessel. Not a game: the viewer never steers anything.

**Status: all 5 phases complete:** life-support simulation and persistence,
Elite Dangerous-scale spaceflight, the pixel-art observation window, its
procedural soundscape, and the traveler's episodic memory, written logs and
living details. Open with `?debug` for a developer-only inspector, or
`dev/gallery.html` to see every camera feed rendered from staged scenarios. Open `dev/tester.html` to pick any room, activity, flight or surface scene and watch it run live: change speed, switch cameras, step time, select things and read the event stream.

---

## AI Contribution Policy

Notes, reviews, and documentation added by AI assistants other than Claude are considered **final**. They should not be edited afterwards.

The only AI authorized to edit the actual source code of this project is Claude.

### Watching

The window is passive. Move the mouse or press a key and a faint feed
selector appears for three seconds; that is the only interface.

| Input | Effect |
|---|---|
| click a feed code, `[` / `]`, ↑ / ↓ | switch camera (`CAM-01 BRIDGE` … `CAM-08 EXT-HULL` … `EVA-POV`) |
| drag, ← / → | pan within the current camera's physical bounds |
| `F` / ⛶ | fullscreen |
| `M` / `SND` | mute (remembered); the first click anywhere enables sound |

After 30 s without camera input the director fades back to the traveler.

### Walking the ship

Press `W` (or pick **Walk the ship** in the camera menu, or open `/?walk`) to
step into the ship in first person; `Esc` steps back out to the cameras. It is
drawn in the same 320×180 pixel style as the camera feeds: each room's back
wall is its own feed drawing, live, with its furniture standing a little off
the wall, and through the glass you see the same sky and hull as the hull
cameras. The traveler, passengers and prisoners stand where the sim has them.
You are only a visitor: nothing you do changes the voyage.

| Input | Effect |
|---|---|
| `W` `A` `S` `D` / arrows | walk and strafe (← → turn) |
| mouse (click to capture it), drag | look |
| `Shift` | run |
| `C` | crouch / stand |
| `E` | open or shut the door ahead, open or close the shutters of the window ahead, climb up a ladder, ride the lift up, climb up through a duct grille, out of a duct |
| `Q` | climb or ride down, drop through a floor grille |
| `H` | every shutter at once: closed by hand, open by hand, back to automatic |
| `G` | go to wherever the traveler is |
| `P` | the deck plan |
| `T`, `F`, `M` | telemetry, fullscreen, mute, as with the cameras |

The whole 3D layout is walkable: all 56 spaces and 53 doors, the ladder wells
and the freight lift between decks, and the crawlable ductwork (the main-deck
overhead and under-floor runs, the deckhouse roof duct and the lower-deck
crawl) with grilles into the rooms they pass and vent shafts with rungs
between them. In the ducts you crawl. Shutters on their own close for
supercruise, hyperspace, the charge and scooping; set by hand they hold until
you hand them back (`H`), and the hull and room cameras show them too. On a
touch screen there is a stick for walking, the right half of the screen to
look, and buttons for the rest. The tester (`/dev/tester.html`) can walk any
staged scene the same way.

## Running

```bash
npm test                                   # 73 tests, ~25 s
node tools/run.mjs --hours 8 --timeline    # watch a slice of life in the terminal
node tools/run.mjs --days 30 --summary     # long run + hours-by-activity
node tools/run.mjs --days 7 --logs         # read the traveler's log entries as they are written
node tools/run.mjs --days 7 --memories     # watch memories form
python3 -m http.server 8080                # then http://localhost:8080/  (or /?debug, /dev/gallery.html, /dev/tester.html)
```

No build step, no dependencies. Deploys to GitHub Pages as static files.

## Architecture (Phase 1)

```
data/                 JSON definitions (all tuning lives here)
  ship.json           room graph: rooms, stations (x in meters), hatches
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
  galaxy.js           hash-seeded star cells, density field with rifts, neighbor search
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
src/audio/            procedural Web Audio — no samples
  mix.js              pure acoustic model: per-layer gain/low-pass for the camera being watched
  synth.js            noise buffers, room impulse responses, one-shot recipes (footsteps by floor…)
  music.js            generative music for the in-room speaker, seeded by track
  engine.js           ~30 continuous layers + one-shot buses; applies the mix every frame
src/memory/           episodic memory and the log voice — deterministic, in the sim
  observe.js          appraises notable events into weighted memory records
  recall.js           picks memories to come back to (weight, echo, novelty)
  logwriter.js        grounded log prose from the day's facts, with callbacks
  lint.js             anti-cliché rules enforced on every entry
  captions.js         which sentence is being typed right now
src/ui/captions.js    quiet subtitles while an entry is being written
src/ui/switcher.js    the auto-hiding camera menu (sectioned; T telemetry, F fullscreen, C menu)
src/ui/telemetry.js   the ship-telemetry overlay (off by default; camera, location, traveler, ship)
src/ui/select.js      selection mode (S): [brackets] on anything with data, click to pin its details
src/render/picks.js   what is selectable in the current frame, and what it reports
src/ui/sound.js       click-to-enable hint, mute toggle
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
  * **Hydroponics:** crop stages by species, water gauges, grow-lamp color and ballast flicker, misting, condensation on the bay glass.
  * **Life support:** status LEDs per machine, the OGS bubbling, the dehumidifier fan stopping when it seizes.
  * **Wear and faults:** flickering corridor lights, sparks at the junction box, juddering pumps and reactor, scorch on the hull.
  * **Traveler:** slouch and yawns when tired, clutter on desk and counters, keepsakes on the quarters shelf, sketches pinned in the lounge.
  * **Logs:** text typing on the terminal while a log is written.
* **Lighting.** Circadian dimming, a dark quarters while the traveler sleeps
  (just the bunk lamp and the porthole), red emergency light in limp mode, and
  pink grow-lamp spill in the bay.

### The soundscape (Phase 4)

Everything is synthesised live with the Web Audio API from noise,
oscillators, filters and envelopes. There are no audio files.

* **Listening follows the camera.** Each source belongs to a room. In the
  watched room it is clear, one bulkhead away it is low-passed to about
  900 Hz at roughly a quarter of the level, and further away it fades to
  bleed. So the traveler's footsteps are muffled when you watch an empty
  room next door. The hull camera hears structure-borne propulsion; the
  helmet cam hears only the suit.
* **Vessel bed.**
  * Reactor sub-bass: strongest in engineering, deadened in the quarters, tracking reactor output.
  * Ventilation and electrical hum.
  * Thermal bulkhead creaks, more of them when the ship runs hot.
* **Room systems.**
  * Hydroponics: water circulation, misting cycles, grow-lamp ballast hum.
  * Bridge: console chirps, relay clicks, scanner sweeps.
  * Galley: heater and kettle.
  * Workshop: fabricator whir.
  * Life support: rhythmic recycler pumps and OGS bubbles.
  * Engineering: radiator hiss with heat.
  * Faults you can hear: a rattling pump bearing, an arcing junction box, a buzzing light strip.
* **Traveler foley.** Footsteps by floor material (grating, damp deck,
  padded, tile, deck plate), pneumatic hatch cycles, chair creaks, typing,
  utensils, water at the sink, wrench clanks during repairs, rowing strokes,
  a sigh with each yawn.
* **Propulsion.**
  * Drive charge: a rising spool-up whine.
  * Hyperspace: a roar.
  * Supercruise: a harmonic hum whose pitch and brightness track speed, so it sinks as the ship slows near a mass.
  * Scooping: plasma rumble and crackle that grow with heat, hull groans, and the bridge warning chime.
  * Atmospheric entry: wind shear and buffeting rumble, with a thump at touchdown.
* **EVA.** Inhale/exhale breathing paced by exertion and fatigue, suit hum,
  comms hiss with dropouts, regolith crunch per step, outside wind muffled
  through the helmet (only where there is air), and airlock depressurisation.
* **Music.** When the traveler plays a recording, the room's speaker plays
  a generative piece seeded by the track number, through a small-speaker
  filter and the room's acoustics.
* **Room acoustics.** A synthetic convolution reverb sized to each room:
  tight quarters, ringing corridors and engineering.

### Memory, logs and living details (Phase 5)

* **Episodic memory.** Notable events are appraised into structured records
  with the spec's fields (`timestamp`, `mission_year`, `system_id`,
  `star_class`, `event_type`, `emotional_weight`, `summary`,
  `callback_count`), plus valence, tags and a subject phrase.
  * Weights run from about 1.0 for confirmed life and 0.85 for an anomaly,
    through first landings, geysers and awe at a ringed giant, down to small
    things like a finished book.
  * Hardships (emergency rations, limp power, a cooked scoop manifold) are
    remembered too, with negative valence.
  * The heaviest 100 stay in the snapshot. All of them are written to
    IndexedDB `memories`, which keeps the callback counts current.
* **Logs.** The entry is composed when the traveler sits down, from the facts
  since the last one, then typed out on the terminal.
  * The voice is plain: crisp technical notes ("Hydroponic pump 2 started
    rattling at the bearing; swapped the pump 2 bearing seal before it got
    worse."), the racks and the galley, the day's finds, at most one line of
    quiet wonder drawn from the actual world's type, color and rings, and a
    little personal life.
  * Entries run 2–8 sentences, shorter on quiet days.
  * Generation is seeded per entry, so live play and offline catch-up write
    identical words.
  * `lint.js` bans melodrama (no "vast", "infinite", "tapestry", "the stars
    whisper", exclamation marks or run-on sentences). Tests check this over
    hundreds of real and fuzzed entries.
* **Callbacks and reflection.** About a third of entries return to an older,
  weightier memory, preferring ones that echo the day ("Thought about the ice
  ridges on Nadir 8987 g 3 again today."). The `reflect` activity recalls one
  too: good memories ease weariness, hard ones add a little stress. Both
  increment `callback_count`.
* **Captions.** Quiet subtitles under the feed, shown only while an entry is
  being written and only when the camera is in that room. The text types
  sentence by sentence in step with the terminal. Turn them off with
  `"captions": false` in `cameras.json`.
* **Living details.**
  * The traveler reads through a shelf of invented books.
  * Instrument, sketching and chess skills improve with practice.
  * The instrument is audible from the quarters, with wrong notes and
    hesitations that fade as the skill grows.
  * Sketches pinned in the lounge are of remembered sights, cleaner as the
    hand improves.
  * Keepsakes collect on the quarters shelf and a star chart goes up over the
    desk.

### Persistence

* `localStorage`: snapshot of the full simulation state (including RNG).
* IndexedDB: event journal, memories, and system records.
* Backup export/import via Ctrl+Alt+Shift+E / Ctrl+Alt+Shift+I.
