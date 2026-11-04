# El Pharos: archipelago milestone

Implemented in runnable increments: four-island world; local selection and
contextual panel; authoritative radius expansion; remembered fog; durable save/load.
React owns controls, Zustand stores snapshots and local selection, Pixi renders,
and Rust owns all gameplay changes.

## World and discovery

Four deterministic islands form an eastward chain from First Haven. Only First
Light starts active. Radius upgrades add 60 units to a maximum of 650, including
on inactive beacons. Maximum historically active radius is stored per lighthouse.
Because lighthouses do not move and radii only grow, these circles fully describe
exploration without a grid. Future movement or shrinking must revise this model.

Pixi masks render the union of explored circles dimly and currently illuminated
circles at full brightness. Undiscovered entities are omitted from labels and
selection. Discovery is based on entity centers. Full snapshots include hidden
geometry; this prototype's fog is presentation, not multiplayer secrecy.

Selection is client-local. Map clicks use a six-pixel movement threshold; dragging
does not select. The accessible panel list offers the same selections. Selection
survives snapshots and reconnects if the entity still exists and is discovered.

## Wire protocol 2

Every command includes `protocol_version: 2`.

- `set_lighthouse_active`: `lighthouse_id`, `active`.
- `expand_lighthouse_radius`: `lighthouse_id`.
- `save_game` and `load_game`: `request_id`.

Snapshots include `radius_step`, `radius_max`, and each lighthouse's
`explored_radius`, alongside existing geometry and activation fields.
Save/load return `command_result` with `request_id`, `success`, and `message`.
Successful commands also return an authoritative snapshot; mutations broadcast.
Errors preserve the world; capped upgrades and unchanged toggles are no-ops.
Clients do not replay requests after reconnect. Interrupted save/load feedback
explicitly states that the outcome is unknown.

## Persistence

One server slot, default `data/savegame.json`, overridden by
`EL_PHAROS_SAVE_PATH`. JSON envelope: `save_version: 1` and `world`.
Save writes and syncs a temporary file, renames it, then syncs the directory.
Load validates version, bounded file size, geometry, IDs, references, rules, and
exploration before replacing the world. Live revision advances on load instead
of adopting the saved revision. Invalid files never replace current state.

A shared mutex serializes all commands, including disk operations executed on
Tokio's blocking pool. One server process owns a save path. Restart starts the
default world; loading is explicit. No camera or selection data is persisted.

## Verification and limits

`npm run check` covers lint, TypeScript/build, frontend geometry and visibility
tests, Rust formatting/Clippy, domain rules, and persistence validation.
`npm run test:ws` covers real clients, malformed requests, shared updates,
concurrent upgrades, save/load errors, and process-restart persistence.
`python3 tests/browser_smoke.py` exercises the UI with Chromium and an isolated
save file, including mobile layout and browser-console checks.

The local shared-world prototype has no economy, accounts, construction,
procedural generation, or simulation loop. The existing bundle-size advisory
remains; production access control and deployment are outside this milestone.
