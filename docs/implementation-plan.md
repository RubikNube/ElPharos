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

## Wire protocol 6

Every command includes `protocol_version: 6`.

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
must be within the inclusive radius of a beacon connected to First Light. Exploration alone does
not qualify. Unknown IDs, insufficient reserves, and darkness leave state unchanged;
already operational facilities succeed without a charge or revision. Production
requires the facility’s active beacon to connect to First Light. Haven production
continues through blackouts. All production follows existing pause/session rules.
The contextual lighthouse panel shows its island's facility and blocking reasons.

Format 4 stores facility states and omits derived production. Formats 1–3 migrate
with their first island designated Haven and the others ruined, preserving the
previous geometry, fuel, and simulation state. Original legacy production must be
2/s before conversion. No facility upgrade tiers, shipping, radius pricing, or
scenario objectives are included in this milestone.

## Automatic connected shipping milestone

Server snapshots now derive `connected` for each lighthouse, effective island
`fuel_production`, `shipping_links` (`from`/`to` beacon IDs), and
`objective_complete`. All active overlapping pairs in First Light's connected
component form shipping links; boundary contact counts. Isolated light still
reveals terrain but cannot enable restoration. Restored facilities require their
own connected active beacon; Haven always produces 2/s. No new persisted state or
save format change is needed. Old saves recompute production under these rules.

The objective requires all facilities restored, all beacons connected and active,
and production at least equal to upkeep. It is a live condition, not a latched win.
Ships move along links as presentation only, pause with simulation, and respect
reduced motion. There are no inventories, travel delays, or fleet commands.

## Strategic Salvage expansion milestone

Implemented the six-island economy with a persistent optional Salvage ruleset.
`salvage: null` selects legacy behavior; new games contain two specialized yards,
a Haven recovery producer, and paid radius expansion. Rust owns local and shared
inventories, production timers, shortest-path routing, and cargo progress. The
snapshot adds centralized construction/shipping rules alongside Salvage state;
the client validates protocol 7 and renders ships from that state. Save format 5
preserves deliveries in transit. Loading formats 1–4 explicitly selects legacy
rules without inserting new islands or charging for old expansion actions.

Yard restoration and spending run under the existing simulation mutex. A repeated
restoration is a no-op. Ships freeze on unsafe legs and keep their cargo; full
Haven storage blocks unloading. Pause, disconnected-session suspension, and
save/load use the existing simulation lifecycle. Domain playthrough tests cover
both fuel-first and salvage-first strategies, recovery from spent construction
reserves, interrupted deliveries, storage limits, and transit save/load.


## Research tree milestone

Implemented six permanent technologies in three independent archive branches:
Amber Shoal has Reinforced foundations (40 Salvage, expansion 20→15) followed by
Modular fittings (80, installation 40→30 and refit 20→15); Quiet Reach has
Streamlined hulls (40, base speed 60→75) followed by Expanded holds (80, hold
20→30); Last Anchorage has Precision lenses (40, efficient lamp saving 0.5→0.75)
followed by Improved refining (80, connected restored fuel production 3→4).
Haven stays at 2 fuel/s. Navigation multiplies researched speed by 1.5 to 112.5
without stacking. Branches do not exclude one another, and research is optional
for scenario completion.

Archive discovery derives from an island center lying within the inclusive union
of historically explored circles. No separate discovery counter is persisted.
Purchases require discovery, the branch prerequisite, and shared Salvage; pause,
blackout, and current connectivity do not block them. Rust serializes purchases
under the existing gate; duplicate requests are no-ops, and rejected requests
preserve state. Existing assets receive bonuses immediately, with new tick rates
on the next tick and larger cargo holds on subsequent loading. Cargo rules are
captured before Salvage is temporarily removed during a tick.

`research.rs` owns the catalog, research purchases, validation, exploration checks,
and effective rules. Server snapshots include authoritative costs, upkeep and
upgrade previews, effective fuel production and restoration preview, and cargo
speed/capacity. The client consumes these values for controls, animation, and ETA.
A collapsible keyboard-accessible Research panel reveals discovered branches and
explains prerequisites and blocked actions; the objective tracks archive and
technology counts without requiring research to win.

Wire protocol **9** adds `research_technology` with `technology_id` from the closed
snake-case technology enum. Snapshots add `research: null` for legacy worlds, or
`{ completed, catalog }` for Salvage worlds; catalog entries provide ID, name,
archive island ID, prerequisite, cost, effect, discovery, availability, and blocking
reason. Economy snapshots add `restored_facility_production` for restoration
previews. Existing Salvage `rules` report effective values.

Save format **7** persists only completed research IDs in `world.research`.
Formats 1–6 migrate through the existing chain, then receive empty research if
Salvage is enabled, or null otherwise. Remembered exploration reveals previously
found archives. Current saves require the research field. Validation rejects
unknown/duplicate IDs, missing prerequisites, undiscovered completed technologies,
and mismatched rulesets; larger cargo loads require the upgraded hold.

Verification includes unit tests for discovery boundaries, atomic purchases,
pause/blackout behavior, all bonuses and their combinations, interrupted cargo,
full storage, upgraded cargo persistence, migration, malformed saves, and researched
and unresearched playthroughs. WebSocket tests cover shared purchases, duplicate
and competing requests, malformed IDs, protocol mismatch, persistence, and failed
loads preserving live state. Frontend tests cover research wire validation,
branch visibility, availability, effective capacity/speed, and ETA. Browser smoke
checks exercise expansion-driven archive discovery, keyboard purchases, effective
costs, research save/load, and mobile overflow.
