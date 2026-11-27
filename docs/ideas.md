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

### Also built (2026-11-27)

- **Planetside bases:** about half the settled systems also have a settlement on a landable world. The traveler lands at its pad, goes ashore into the base hall, and lifts off again. The domes show on the horizon.
- **People:** each station has a bartender, a clerk and regulars, all with names, faces, manners and trades. The same people are there on every visit. Conversations are remembered on both sides (how often they've met, rapport, what they talked about), and later visits pick up the thread.
- **Passengers:**
  - they live aboard in their cabins, with a day of their own: sleep, meals in the lounge, the galleries, reading, walks;
  - the traveler talks with them;
  - they go ashore at the destination.
- **Mission rooms in the game:** the galleries, passenger cabins and lounge, brig, secure cargo, bio lab and xeno containment are real rooms with their own cameras.
- **Combat, first version:**
  - pirates interdict in inhabited space;
  - the traveler fights from the helm, and the shield and hull take the damage;
  - they run with the jump drive when outmatched; the worst outcome is losing the cargo;
  - bounty contracts on named pilots; vouchers paid at ports.
- **Combat with more to it:**
  - pirates come with one or two wingmen in lighter ships, more often on the frontier; a gunship on a bounty contract always has an escort, a raider sometimes does;
  - the traveler shoots the weakest first to thin the incoming fire; when the leader goes down, the wing runs;
  - in settled systems, system security sometimes answers the call and flies in on our side (less often at outposts);
  - the traveler weighs up the fight at the helm and again when the shield fails. Outgunned, they either run for it or submit: they cut the drive and drop the cargo, or pay a toll if the hold is empty. The pirates hold their fire and go. Contraband and valuable contracts make submitting less likely; stress and a battered hull make it more likely;
  - fire control, the armory and the magazine are real rooms with cameras (CAM-33 to CAM-35). The fire-control screens show the shield, the hardpoints and the contacts plot. The magazine racks empty as the guns fire, and the hoist runs during a fight;
  - firing uses ammunition. With the magazine empty only the lasers fire. Ports refill it;
  - after a fight the traveler goes to fire control to realign the gimbals and reseat the shield capacitors. Until then the guns shoot a little worse.

### Still to come

- Prisoners in the brig, for bounties that want the target alive.
- Passengers with their own small stories: requests, complaints, a farewell.
