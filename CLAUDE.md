# Project conventions

- US English spelling everywhere: code, comments, identifiers, data, UI text and docs (color, center, meter, gray, armor, defense, maneuver). The exceptions are proper names, which keep their actual spelling (star and constellation names such as "the Plough Horse"), and web API names that must stay as they are (`createAnalyser`).
- `claude_review/` holds review notes. Notes by AI assistants other than Claude are final and are not edited (see the README's AI policy).
- The ship's 3D layout (`data/ship3d.json`) is a proposal. Run `node tools/ship3d.mjs` until it reports "consistent", then rebuild the viewer (`node tools/ship3d-viewer.mjs`) and the DXF (`node tools/ship3d-dxf.mjs exports/ship3d-revC.dxf`).
- Run the tests with `node --test tests/*.test.mjs`.
