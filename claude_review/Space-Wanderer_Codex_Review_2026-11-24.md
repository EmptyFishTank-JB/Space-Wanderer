# Space Wanderer — Codex review for Claude

**Audience:** Claude and the project author  
**Reviewed revision:** `main` at `50caa69`  
**Companion:** [Grok's review](Space-Wanderer_Review_2026-11-24_2216_CST.md)

## Recommended order

1. Fix catch-up checkpoints and complete backup coverage.
2. Prototype one expressive bridge sequence around fuel scooping.
3. Give returning viewers a small, read-only Ship Log and improve the continuity of its entries.

Grok makes a good case for bringing the traveler and cockpit forward. My priority is to protect the continuity of the voyage first. A traveler who has a life while nobody is watching is the project's distinctive premise. Then make one ordinary operation expressive enough that a viewer can understand what the traveler is doing from the room itself.

## 1. Save a consistent checkpoint during catch-up

**Reproduced in Node.** `LiveRunner.pump()` starts an asynchronous catch-up that advances the simulation before updating `state.wallMs`. Browser autosave and `pagehide` can serialize during that interval. With an injected clock 2,000 seconds ahead, an uninterrupted run advanced 2,000 ticks. A snapshot serialized while catch-up was pending contained the 2,000 advanced ticks and the old timestamp. Restoring it and pumping against the same clock yielded 4,000 ticks.

Give save and export a consistent view of the simulated state and its wall-clock timestamp. One approach is to advance the timestamp with each completed chunk and handle the torpor remainder explicitly. Another is to save the last complete checkpoint while catch-up is in progress. In either design, check what happens when journal writes are ahead of the saved checkpoint and the same events are replayed.

**Acceptance:** Suspend catch-up at a yield point, save, reopen, and compare the final state and journal to an uninterrupted run. Cover a gap that spans multiple chunks and one that exceeds the cap. [Live runner](../src/sim/runner.js) · [Catch-up](../src/sim/catchup.js) · [Browser save hooks](../src/main.js)

## 2. Round-trip the full voyage archive

**Reproduced with the in-memory journal.** Export packages the snapshot and journal events. The journal also stores systems and archived memories separately, and import replaces only the event store. I exported a voyage with one log, one system, and one archived memory. A clean import had the log and zero records in either archive. A browser with an existing voyage can retain its previous archive records because those stores are outside the replacement transaction.

Version the backup payload and include all three stores. Restore the journal stores in one IndexedDB transaction, deliberately coordinate activation of the snapshot with that transaction, and keep legacy payloads readable. Decide how legacy imports represent history they cannot recover. Make a failed import leave a usable voyage.

**Acceptance:** Round-trip into both an empty destination and a destination containing a different voyage. Include a memory outside the snapshot's working set and one with a callback count. Compare the restored stores with the source and simulate a write failure. [Backup format](../src/persist/backup.js) · [Journal](../src/persist/journal.js) · [Persistence tests](../tests/persistence.test.mjs)

## 3. Develop one bridge scene at the current resolution

Start with fuel scooping. It already has a changing heat level, increasing fuel, failure conditions, distinctive audio, and an exterior camera cue. A focused sequence can show all of that through a few small changes.

- In the bridge feed, give the traveler one recognizable control interaction as the scoop starts and a glance toward the heat readout when it reaches the existing caution threshold. Reuse the live heat and fuel values. The bridge already has a heat-reactive waveform, and engineering already renders heat and fuel bars.
- Let the current exterior cut establish the operation, then show the traveler responding on the bridge. Check that a manual camera selection still behaves as expected. If this works, use the same approach for touchdown by tuning the existing exterior hold. Give the surface a moment before the feed follows the traveler again.
- Stage the sequence in the existing gallery. Compare the ordinary, warning, and recovery states at 320×180, then watch the scene at a typical window size. Judge it by whether someone can tell that the traveler is watching the heat and acting on it. Profile the heaviest gallery scenarios on a representative device before changing texture resolution or moving rendering into a worker.

Use posture and deliberate actions to convey fatigue or weariness. Room lighting already communicates ship time and operational conditions, so changing the entire palette with mood could make those physical cues harder to read. [Rooms](../src/render/rooms.js) · [Traveler rendering](../src/render/traveler.js) · [Director](../src/render/director.js) · [Gallery](../dev/gallery.html)

## 4. Make the voyage legible on return

Add an optional **Ship Log** to the existing camera controls. Start with a few dated entries from `journal.recent(limit, 'log_entry')`. Keep the feed as the default view. If the first version feels useful, add a short list of events since the viewer's last visit. The default `voyager` seed generated 18 jumps, four landings, four EVAs, and seven daily entries in one simulated week. Most of that is easy to miss because live captions require the right camera at the right time.

Tighten chronology in the generated prose before making it easier to browse. One entry opened at Dray 7813, a white dwarf, then described Brask 4212, also a white dwarf, with “Never been near one before.” The structured facts placed Brask first. Give that earlier encounter an explicit time reference when the entry opens at the later arrival. Let a good personal detail carry an entry sometimes. “The proportions are off,” after a sketch of planetary rings, gives the recollection a character of its own.

Pair the log with a short first-visit hint and a visible catch-up status. The browser already receives catch-up progress. Surfacing it would give returning viewers a reason for a temporarily blank feed. [Camera controls](../src/ui/switcher.js) · [Captions](../src/ui/captions.js) · [Log writer](../src/memory/logwriter.js) · [Browser entry](../src/main.js)

## Verification

All 73 tests passed on the original Phase 5 revision `4d0942d`. The commits through `50caa69` changed documentation only. The catch-up and archive findings were reproduced separately in Node. The earlier browser smoke check was inconclusive, so the visual proposals are based on source and should be evaluated in the gallery. The existing eight-hour activity benchmark already covers an ordinary waking day. Add targeted coverage for the specific persistence and writing regressions above. [Waking-day benchmark](../tests/life.test.mjs)
