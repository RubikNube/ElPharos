# El Pharos: archipelago and fuel milestone

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

## Wire protocol 5

Every command includes `protocol_version: 5`.

- `restore_fuel_facility`: `island_id` (atomic 120-fuel restoration; already operational is a no-op).
- `set_simulation_paused`: `paused` (shared, idempotent).
- `set_lighthouse_active`: `lighthouse_id`, `active`.
- `expand_lighthouse_radius`: `lighthouse_id`.
- `save_game` and `load_game`: `request_id`.

Snapshots include `radius_step`, `radius_max`, and each lighthouse's
`explored_radius`, alongside existing geometry and activation fields. Each lighthouse
also includes derived `fuel_upkeep` and `next_fuel_upkeep` (null at maximum radius).
These rates are calculated by Rust when serializing snapshots and are not persisted.
Save/load return `command_result` with `request_id`, `success`, and `message`.
Successful commands also return an authoritative snapshot; mutations broadcast.
Errors preserve the world; capped upgrades and unchanged toggles are no-ops.
Clients do not replay requests after reconnect. Interrupted save/load feedback
explicitly states that the outcome is unknown.

## Persistence

One server slot, default `data/savegame.json`, overridden by
`EL_PHAROS_SAVE_PATH`. JSON envelope: `save_version: 4` and `world`. Format 1 loads through a legacy
migration that preserves existing world data and supplies the starting economy.
Format 2 preserves its whole fuel balance. Both adopt the new radius-based rates.
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

The local shared-world prototype has a basic fuel economy, but no accounts or general construction,
trade, or procedural generation. The existing bundle-size advisory
remains; production access control and deployment are outside this milestone.


## Fuel and simulation

Rust owns a shared stockpile: 300 starting fuel, 600 capacity, facility production
starting at 2/s from First Haven, and base 1/s upkeep per active beacon. These constants are
included in the snapshot's `economy` object alongside `fuel`, `elapsed_seconds`,
`paused`, and persistent `blackout` feedback. Each +60 radius upgrade adds 0.25/s,
from 1/s at radius 290 to 2.5/s at radius 650. The formula is
`1 + 0.25 * ceil(max(0, radius - 290) / 60)`; intermediate legacy radii round up
to the next tier and smaller radii retain base upkeep. Inactive beacons consume
nothing. Fuel uses finite quarter-unit values, which are exactly representable in
binary; validation rejects negative, over-capacity, and non-quarter balances.

Expansion has no upfront charge or affordability restriction. The new rate applies
on the next tick, and the sidebar previews it before expansion. Activation checks
and tick consumption sum each active beacon's individual rate. Upgrade pricing
remains deferred.

Each deterministic tick adds production up to capacity, then pays all upkeep.
Insufficient fuel consumes the remainder and extinguishes all beacons without
altering exploration. Production continues and relighting is manual. Activation
requires one second of the resulting active network's upkeep in reserve.

One task per application advances once per second, with no missed-tick or offline
catch-up. A weak state reference and shutdown notification release the task when
the application is dropped. Session guards track connected players; no clients
means suspension, independently of explicit shared pause. Resume, reconnect, and
load reset the next tick to a full second. Repeated pause requests are no-ops.
Ticks, commands, and save/load share the existing mutex, acquired on the blocking
pool. Mutations broadcast full snapshots; paused and suspended worlds do not tick.

The sidebar displays reserve/capacity, production, upkeep, net rate, elapsed time,
and shared pause status. Shortage feedback survives tick snapshots until manual
relighting; command errors survive ticks until the next player command.


## Island fuel facilities

Each island persists a `fuel_facility` state: `haven` (2/s), `ruined` (0/s), or
`restored` (3/s). Exactly one Haven facility is required. Total production is
computed by Rust from facilities; it is never independently persisted. Snapshots
retain `economy.production`, add `economy.facility_restore_cost` (120), and include
each island's state and derived `fuel_production`.

Restoration deducts 120 fuel once under the simulation mutex. The island center
must be within the inclusive radius of any active beacon. Exploration alone does
not qualify. Unknown IDs, insufficient reserves, and darkness leave state unchanged;
already operational facilities succeed without a charge or revision. Production
continues through darkness and blackouts and follows existing pause/session rules.
The contextual lighthouse panel shows its island's facility and blocking reasons.

Format 4 stores facility states and omits derived production. Formats 1–3 migrate
with their first island designated Haven and the others ruined, preserving the
previous geometry, fuel, and simulation state. Original legacy production must be
2/s before conversion. No facility upgrade tiers, shipping, radius pricing, or
scenario objectives are included in this milestone.
