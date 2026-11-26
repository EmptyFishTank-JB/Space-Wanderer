# Ideas on hold

Ideas the project owner has pinned for later. Nothing here is built or scheduled yet.

## Inhabited space, ports and missions (pinned 2026-11-26)

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
