# Ideas on hold

Ideas the project owner has pinned for later.

## Inhabited space, ports and missions (pinned 2026-11-26; first part built 2026-11-27)

The traveler roams the galaxy but is never far from inhabited space. Now and then they could choose to put in at a station or a planetside base and take on work from the people there, Elite Dangerous style.

- **Places:**
  - enormous space ports;
  - planetside bases.

  The ship can land at both, and the traveler can walk around and meet people.
- **Kinds of work:**
  - cargo transport;
  - trading;
  - passenger runs;
  - smuggling;
  - combat;
  - xeno-biology contracts.
  - Maybe bounty hunting. This one is a "maybe".
- **What it would touch:**
  - galaxy generation, for factions, populated systems and station placement;
  - a station/base interior and docking sequence, sized for the survey ship;
  - other people as characters;
  - a mission board;
  - money and reputation;
  - a decision model for when the traveler wants company or work, versus solitude and wandering.

  The ship's weapons, shields and utility mounts in `data/ship3d.json` (rev C) were added with this in mind.

### Rooms already set aside for it

These are in the ship proposal (`data/ship3d.json`), marked `missions: true` and drawn dotted:
- **Passenger cabins 1–3 and a passenger lounge:** off the starboard gallery, for passenger runs. The lifeboats seat four.
- **Secure cargo:** a shielded, scan-resistant vault for valuable cargo, sensitive cargo, or smuggling.
- **Brig:** two detention cells, for bounty hunting or carrying a prisoner.
- **Xeno containment:** sealed enclosures off the biology lab, for xenobiology contracts that want something alive.

The hold already runs out to the belly wall and has room for trade cargo. The comms room is where a station's mission board would come in.

### Built so far

- **Inhabited space:** settled regions lie in patches across the galaxy, with one always near the start. Settled systems have an orbital station, or an outpost on the edge of a region, round one of their worlds. Each belongs to one of four factions.
- **Port calls:** the traveler puts in when there is a reason: a delivery, low supplies, a worn hull, loneliness, no money, or curiosity. Docking runs request, approach, slot and pad; the dock refuels the ship and repairs the hull.
- **Ashore** (the concourse camera, PORT-CAM):
  - the market sells ore, ice, spare samples and survey scans, and restocks spares, filters and food;
  - the bar gives company and a meal for a few credits;
  - the mission board, then the viewing deck, then undocking.
- **Missions:**
  - cargo runs;
  - passengers, in three cabins;
  - xenobiology sample returns;
  - survey scans;
  - smuggling, now and then, which can get caught.

  Each has a deadline, a reward and faction standing. Routes steer toward a mission's destination.
- **Credits and missions** show in telemetry. There are journal entries, memories and daily log lines for all of this.

### Still to come

- Planetside bases: landing at a settlement on a world's surface.
- People as characters: names, faces and conversations that come back on later visits.
- Bounty hunting and combat, still a "maybe". The hardpoints, shield and fire-control room exist in the 3D layout but not in the game.
- Passengers moving about the ship in the cabins and lounge.
- Mission rooms in the game: the passenger cabins, brig, secure cargo and xeno containment exist only in the 3D layout so far.
