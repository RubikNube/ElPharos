# El Pharos

A lighthouse-network strategy game about bringing light to a dark ocean.
The [handover](El_Pharos_Project_Handover.md) is the project vision; the
[implementation plan](docs/implementation-plan.md) records the original prototype
scope. This README describes current behavior and compatibility.

New games randomly generate 6–12 islands with fuel facilities, salvage yards,
and automatic cargo deliveries. Exactly one salvage island is visible from Haven
at the start. Every island can be discovered, restored, and connected through
successive lighthouse radius upgrades. A connected network at radius 470 is
guaranteed to have sufficient restored fuel production without research or
specializations. A starting expedition boat must visit each new lighthouse before
it can be lit. Islands have separated shorelines and the map fits the generated
archipelago. Startup and Restart generate a fresh layout; loading preserves the
saved map. See **Salvage and cargo expansion** below for the new economy.
Existing saves retain their original layouts; formats 1–4 use the four-island
scenario described in the following legacy gameplay sections. The playable archipelago is server-owned.
Explore ancient island archives to unlock optional research upgrades.
Select discovered beacons on the map or in the side panel, activate them, and
expand their radii to reveal the next island. Connected tabs share the same
world. Exploration remains dimly visible after a beacon is extinguished.

## Run locally

Requirements: Node.js 24+, npm, and a current stable Rust toolchain (edition 2024;
verified with Rust 1.99.1). Install dependencies from the repository root:

```sh
npm ci
cargo build --locked
```

Start the backend in one terminal:

```sh
npm run dev:server
```

Start the frontend in another:

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/ws` and `/health` to Axum at
`127.0.0.1:3001`. The client uses the current origin and automatically chooses
`ws` or `wss`. A failed connection shows a status and retries with capped backoff.

The ocean wraps endlessly east–west and north–south. Opposite edges are adjacent
for light, exploration, connections, and voyages, including in existing saves.
Repeated islands are the same places, with shared state. There is no map border.

Drag the chart to pan; scroll to zoom around the pointer. Use the visible zoom
and reset controls, or focus the map and press arrow keys, `+`, `-`, and `0`.
Startup and Reset center on First Haven at a local zoom independent of unexplored
map dimensions. Select a lighthouse by clicking any copy of its marker or its button in the side panel.
Hover over a discovered lighthouse for a short time to see its status and keeper.
Hover over a ship to see its current status and a crew message.
Keeper names remain stable after loading. Their moods reflect darkness, low fuel,
isolation, or a healthy connection, with a random remark suited to each mood.
The selected lighthouse's keeper also appears in the side panel.
Use **Extinguish beacon / Light the beacon** to change its illumination.
Remote beacons require an expedition visit and arrival choice before first lighting.
**Expand radius** adds 60 units with no upfront cost, up to 650 units. Inactive beacons can
be upgraded, but only active illumination reveals new areas.

**Save** writes one shared server slot; **Load** replaces the world in every
connected tab. The default file is `data/savegame.json`, relative to the server
working directory; override it with `EL_PHAROS_SAVE_PATH`. Restart starts a fresh
world; use Load to restore the saved one. Camera and selection are local and are
not saved. Invalid or missing saves leave the world unchanged. Use only one
server process per save path.

## Fuel economy

First Haven starts with an operational fuel facility producing **2 fuel/second** into one shared reserve,
starting at **300**, with capacity **600**. Active beacons start at **1 fuel/second** at radius 290.
Each +60 radius upgrade adds **0.25 fuel/second**, reaching **2.5/s** at radius 650.
Inactive beacons consume nothing; expanding them increases their eventual upkeep.
The expansion preview shows the resulting rate. Expansion has no upfront cost and
is allowed even if reserves cannot cover the increased upkeep. Its new rate applies
on the next tick. Fuel balances are tracked in exact quarter units.

Each other island has one ruined fuel facility. Select its lighthouse to see the
facility controls. **Restore fuel facility** costs **120 fuel** and enables
**3 fuel/second** while its beacon is connected. The island center must currently be inside
a connected beacon's radius; remembered exploration alone is insufficient. Restored
facilities produce only while their own beacon is active and connected to First Light through overlapping active light circles. First Haven always produces 2 fuel/second, including during blackouts. Restoration is allowed
while paused, with production taking effect on the next tick. Repeated restoration
requests never charge twice. There are no further facility levels or refunds.
Connecting all three restored facilities gives **11 fuel/second**, enough for four maximum-radius
beacons at **10 fuel/second**. Fuel capacity remains 600.

The server advances one second at a time while at least one player is connected.
**Pause / Resume** affects everyone; beacon commands and save/load still work
while paused. Disconnecting the last player suspends simulation without changing
the pause setting. Reconnecting resumes after a full second. There is no offline
catch-up, and missed timer ticks are skipped.

Each tick adds production up to capacity, then pays upkeep. If the reserve cannot
pay the whole network, all remaining fuel is consumed and every beacon goes out.
Exploration is preserved and First Haven production continues. Relight beacons manually once
fuel covers one second of the resulting network's upkeep; they do not restart
automatically. The side panel shows fuel, rates, pause status, and shortage feedback.

Saves include fuel, elapsed simulation time, and explicit pause state. Older
format-1 saves migrate on load with the starting economy defaults; format-2 saves
preserve their fuel balances. Both adopt radius-based upkeep. Formats 1–3 migrate with First Haven operational and all other facilities ruined.
New saves use format 12 and persist expeditions, Veil fronts, keeper health, doctor voyages, ambient shipping voyages, facilities, Salvage, specializations, salvage vessels, and
research rather than derived production. Save formats 1–10 remain supported.
Wire protocol 15 requires matching client and server versions.

## Connected shipping and scenario goal

First Light anchors the network. Active beacons connect automatically when their
circles overlap or touch, including through chains of other active beacons.
Golden links and moving ships show these safe corridors; legacy saves use
decorative shipping with no cargo inventories or travel delay. New games use the
automatic cargo system described below; neither mode has fleet controls.
When two or more lights are connected, a family boat or mail ship sets out about
every 30–60 simulation seconds. At most two voyages run at once. They follow
safe links, wait during outages, and resume with the network; family boats visit
and return while mail ships deliver letters. These trips are ambient and do not
change fuel, resources, or keeper moods. Their progress is saved.
Restored remote facilities stop
producing when their beacon goes dark or loses its connection. Relighting the
chain resumes production on the next tick. Connectivity and effective production
are derived after every change and after loading; existing saves adopt these rules.

Restore all three remote facilities and connect all four active beacons with
nonnegative net fuel to complete the scenario. The objective panel tracks progress;
completion reflects the current network and play continues afterward.

## Structure and responsibilities

```text
apps/server/src/
  domain.rs                 World data, commands, and tick ordering
  scenario.rs               Seeded random archipelago generation and playability checks
  rules.rs / research.rs    Effective gameplay rules and archive progression
  network.rs / salvage.rs   Derived connectivity, routing, and cargo simulation
  service.rs                Serialized commands, clock, sessions, and save/load
  lib.rs / main.rs          HTTP/WebSocket transport and process startup
  persistence.rs            Bounded reads and atomic save writes
  persistence/migrations.rs Historical save decoding
  validation.rs             Domain invariants independent of storage
  protocol.rs               Wire commands and derived snapshot serialization
apps/web/src/
  App.tsx / components/     Application composition and presentation panels
  network/                  Connection lifecycle, command builders, React hook
  state/                    Snapshot store and pure presentation queries
  protocol.ts / shipping.ts Validated wire contract and shipping presentation
  rendering/                Scene controller, world/selection layers, camera
                            controls, visibility, and ship animation
apps/server/examples/contract_snapshots.rs
                            Real server messages for contract validation
tests/                      Protocol contract, WebSocket, and browser checks
```

Rust owns entity IDs, positions, geometry, beacon activation, and world revision.
Axum sends a snapshot on connection and after commands; Tokio watch channels
publish the latest world to all clients. Zustand stores validated snapshots and
connection status. React owns the interface; Pixi owns the map and camera. No
simulation or default world is duplicated in the client. Components use named
commands and pure presentation queries; the React map adapter passes snapshots
and selection to Pixi explicitly. Selection redraws only its overlay.

The game service serializes mutations, persistence, and ticks through one gate.
Each snapshot builds one operation-local network view, shared by connectivity,
production, objectives, and shipping links. Cargo routing shares the post-fuel
network view during each tick, so a blackout stops shipping immediately.
Effective rules collect research effects without changing the stored world or
wire representation. Save migrations preserve the original scenario and ruleset.

World geometry uses arbitrary world units, with positive y pointing down. The
camera is local presentation state and never changes the domain. Pixi renders on
demand except while shipping links animate. Shipping pauses with the simulation and respects reduced-motion preferences. Its canvas, observers,
listeners, and subscriptions are cleaned up on unmount, including React
StrictMode's asynchronous mount/unmount cycle.

## Verify

```sh
npm run check       # ESLint, client tests/build, fmt, Clippy, Rust tests, wire contract
npm run test:ws     # Starts its own Rust server on an ephemeral local port
python3 tests/browser_smoke.py  # Requires Chromium and ChromeDriver
```

The GitHub Actions **Verify** workflow runs both commands on every push and pull
request, and supports manual runs. It uses Node.js 24 and stable Rust on Linux,
and builds the server before the WebSocket test to avoid compilation consuming
its startup timeout. Browser smoke testing remains a manual check.

The WebSocket test checks health, initial state, malformed commands, unknown IDs,
protocol mismatch, idempotency, broadcast to two clients, concurrent upgrades,
save/load failures, exploration persistence, and loading after a server restart.
It requires permission to bind a local TCP port. Client tests check protocol
validation, zoom bounds, cursor anchoring, connection
backoff and disposal, scene cancellation and overlay updates, and ship motion
under pause, blockage, and reduced-motion preferences. The contract check feeds
actual Rust messages (new, legacy, researched, paused, and blackout worlds) into
the frontend Zod schema. Rust tests cover revision-limit atomicity, migration
of every supported save format, thousands of map-generation seeds, progressive
exploration, sustainable completion, and generated-map save/load round trips.

Browser smoke validation was also performed in headless Chromium: one canvas
under StrictMode, active/inactive beacon rendering, dragging, wheel zoom, reset,
and mobile layout without horizontal overflow or browser errors.

## Build and operating limits

```sh
npm run build
cargo build --release --locked
```

Frontend output is `apps/web/dist`; backend output is
`target/release/el-pharos-server`. `EL_PHAROS_BIND` overrides the default backend
bind address; `RUST_LOG` configures tracing. If changing the backend port during
development, also update the Vite proxy targets.

This is a local prototype with one shared world and an explicit durable save slot.
Fuel, Salvage, automatic cargo shipping, lighthouse specializations, and archive
research are implemented. Accounts, general construction, trade, weather, combat,
and story remain deferred. For deployment, serve the built client
and proxy `/ws` to Axum under the same origin, with TLS and appropriate access
control. Vite's development proxy is not part of the production build.

The production build currently emits a bundle-size advisory for the approximately
600 kB main JavaScript chunk (180 kB gzip), which includes the renderer. Splitting
and tuning the renderer bundle is deferred until loading performance is a goal.

The root `minimatch` override selects the patched 11.x release for development
tooling until upstream dependency ranges catch up. Recheck the override on future
ESLint/typescript-eslint upgrades. Lockfiles capture tested dependency versions.

## Milestone browser smoke test

With Python 3, Chromium at `/usr/bin/chromium`, and `chromedriver` installed:

```sh
python3 tests/browser_smoke.py
```

This starts local services on isolated temporary ports, uses an isolated
temporary save slot, and checks discovery, selection, expansion, save/load,
camera interaction, fuel display, shared pause, blackout recovery, StrictMode cleanup, and mobile overflow. Screenshots and process logs are written under `/tmp/el-pharos-*`.

## Salvage and cargo expansion

New games contain 6–12 randomly placed islands, including at least three fuel
islands and two salvage islands. Wreckers' Cove is visible in the starting light;
Iron Shoal and any additional salvage yards require exploration. The three named
fuel islands retain their research archives. Resource counts vary with map size
while ensuring enough fuel for a sustainable completed network. **Salvage** is
recovered metal used to reinforce towers and repair yard machinery. First Haven
starts with 100 Salvage (capacity 300), and its salvage operation adds 1 every
10 simulation seconds, including during blackouts. Radius expansions cost 20
Salvage in addition to their ongoing fuel upkeep. Existing fuel facilities still
cost 120 fuel to restore.

Restore a salvage yard for 120 fuel and 40 Salvage under connected illumination.
Wreckers' Cove produces 1 Salvage every 4 seconds; Iron Shoal produces 1
every 2 seconds. Additional yards use either production cycle. Yards operate only
while their beacon is connected and hold up to 60 locally. Restoration includes an automatic ship carrying up to 20 Salvage
to Haven at 60 world units/second, returning empty. Ships depart with any cargo
available and follow the shortest safe path through the beacon network. Production
at a full inventory is discarded. A ship retains cargo if Haven storage is full.
Disconnected shipping legs freeze in place and resume when safe. Routes are
recalculated at beacon arrivals; partial-tick travel remaining after arrival is
discarded. Cargo delivery/unloading occurs on the following simulation tick.

The panel shows stock, cargo, estimated sailing time, and route interruptions.
The mint outline around a selected beacon previews the next expansion, with
rings around discovered islands that it would newly reach. Gold ships carry
cargo; pale blue ships are empty. Ships interpolate at most one tick beyond the
latest server snapshot and respect pause and reduced-motion preferences.

New objectives include restoring every yard and receiving a delivery from each,
as well as restoring every fuel facility and connecting all beacons
with sustainable fuel. Production timers and cargo in transit are saved.
Formats 1–4 retain their original map, free expansion, and objective under a
legacy ruleset, which remains in effect after saving again. Current saves use
format 12 and matching clients and servers use wire protocol 15. The older sections
above describe the original four-island scenario; these rules supersede them for
new games. Base Salvage constants live in `apps/server/src/salvage.rs`;
`apps/server/src/rules.rs` collects effective rules for simulation and snapshots.

## Salvage expeditions

Select First Haven's lighthouse to build one large **salvage vessel for 200 fuel**,
with no Salvage construction cost. Automatic expeditions start enabled. Each trip
loads **120 fuel** before departure, sails out for 5 seconds, recovers **40 Salvage**
over 80 seconds, and returns in 5 seconds. Fuel payment happens after lighthouse
upkeep. Departures require at least **240 fuel**, leaving **120 fuel** in reserve,
and room for a full 40 Salvage in Haven's existing store.

The vessel searches nearby water independently of lighthouse coverage, including
during blackouts, without revealing terrain or discovering islands. Global pause
freezes expeditions. If Haven fills during a trip, the vessel unloads what fits
and keeps the remainder aboard until space opens. **Stop automatic expeditions**
finishes the current trip and prevents another departure; unloading continues.
The panel shows cargo, trip progress, and fuel/storage waiting reasons.

The larger ship appears on the map with pause-aware animation and reduced-motion
support. Research bonuses apply to yard cargo ships only. Expeditions do not count
as deliveries from salvage yards. Saves preserve every expedition phase; formats
1–7 migrate with no vessel built, and legacy games without Salvage retain their
original rules.

## Lighthouse specializations

Select a lighthouse to install one specialization for **40 Salvage**, or refit
an existing specialization for **20 Salvage**. Fitting requires the beacon's
position to be under connected illumination; it works while paused or while
that beacon is inactive. Repeating the installed choice costs nothing.

- **Efficient lamp:** reduces upkeep by **0.5 fuel/second**, including after radius upgrades.
- **Navigation beacon:** cargo travels **50% faster** on safe links touching
  this beacon, in either direction. Two navigation beacons on a link do not stack.

Radius upgrades remain separate. Navigation affects travel, not production,
loading, or capacity. Ships still use shortest-distance routes and stop on unsafe
links; refitting affects their current leg on the next tick. The UI previews
benefits and costs, and cargo animation and ETA reflect navigation bonuses.

The specialization milestone introduced format **6**, preserving specializations. Formats 1–5 migrate
with empty slots; legacy games without Salvage keep their original rules and
cannot buy specializations. Research introduced save format **7** and wire protocol **9**; salvage vessels advance these to **8** and **10**.


## Research and ancient archives

Explore the centers of **Amber Shoal**, **Quiet Reach**, and **Last Anchorage** to
recover their archives. Discovery uses remembered exploration, so knowledge
survives extinguished or disconnected beacons. Open **Research** below the
objective panel to purchase permanent, shared upgrades with Salvage. Each branch
has two technologies; its second requires its first. All three branches can be
completed independently.

| Archive | Technology | Salvage | Benefit |
| --- | --- | ---: | --- |
| Amber Shoal | Reinforced foundations | 40 | Radius expansion costs 15 instead of 20 Salvage. |
| Amber Shoal | Modular fittings | 80 | Specialization installation costs 30 instead of 40; refitting costs 15 instead of 20. |
| Quiet Reach | Streamlined hulls | 40 | Base cargo speed increases from 60 to 75 units/second. |
| Quiet Reach | Expanded holds | 80 | Ship capacity increases from 20 to 30 Salvage. |
| Last Anchorage | Precision lenses | 40 | Efficient lamps save 0.75 instead of 0.5 fuel/second. |
| Last Anchorage | Improved refining | 80 | Connected restored fuel facilities produce 4 instead of 3 fuel/second. Haven remains at 2. |

Purchases complete instantly and work while paused or during blackouts. They
require discovery, prerequisites, and sufficient shared Salvage, without current
illumination. Repeated purchases never charge twice. There are no research timers,
refunds, resets, or additional resources. Research is optional; the existing
archipelago objective remains sufficient to win, and research progress is shown
separately.

Upgrades apply to existing and future assets. Navigation's existing ×1.5 bonus
combines with researched ship speed for **112.5 units/second**, without stacking
multiple navigation beacons. Speed changes affect ships on their current leg on
the next tick. Expanded holds affect subsequent loading and do not create extra
cargo in ships already sailing. Fuel, costs, previews, cargo animation, and ETA
all reflect effective server rules.

New saves use **format 12**, persisting expedition state, Veil fronts, keeper health, doctor voyages, ambient shipping voyages, and completed technology IDs alongside the
existing world. Loading formats 5–6 adds empty research to Salvage worlds and
reveals archives already covered by exploration. Formats 1–4 and resaved worlds
without Salvage retain their legacy gameplay with no research. Matching clients
and servers use **wire protocol 15**. These rules supersede earlier version and
balance descriptions above where an upgrade applies.

Use **Restart** beside Save and Load to start a fresh shared game. Confirming resets progress for every connected tab and keeps the existing save slot. When all scenario objectives are met, a victory notification appears. Choose **Continue playing** to dismiss it and keep managing the archipelago; the simulation continues after victory.


## Keeper sickness and doctor visits

Previously lit keepers have a 5% chance of sickness each simulation minute after
five minutes of initial safety. Sickness reduces effective light range by 25%,
which can disconnect production and shipping. Discovered terrain and range
upgrades are retained, and fuel upkeep stays based on normal range.

Select a sick keeper and choose **Send doctor — 40 fuel**. One shared doctor ship
travels from First Haven at 120 world units/second, treats the keeper on arrival,
and returns before another dispatch. The fare covers both legs. It can reach
isolated lighthouses and operates through blackouts without revealing terrain.
First Haven receives immediate local treatment for the same fare. Treatment
restores full range and grants five minutes of immunity. Illness and voyages
advance only with simulation time; saves preserve their state.

Keeper health introduces **save format 9** and **wire protocol 12**. Older saves
load with healthy keepers, five minutes of immunity, and an idle doctor ship.

## Veil fronts

After a remote beacon joins First Haven's connected network, the Veil periodically
targets an active, connected remote beacon. A purple ring closes around the target
for 60 simulation seconds. Select that lighthouse to **Ward beacon** for 40 fuel;
the ward lasts 90 simulation seconds and works while paused. A defended strike
requires the target to remain active and connected at impact. Without a defense,
the strike extinguishes it, stopping any dependent production and shipping until
you relight it. Exploration is retained. The next front waits 120 simulation
seconds after impact and rotates among eligible targets.

Defending three fronts completes a separate, permanent Veil objective. Fronts
continue after completion. Veil timers freeze with the shared simulation pause
or when all players disconnect. The current front, ward, and progress survive
save/load; Restart starts fresh. Legacy worlds without Salvage retain their
original rules. This milestone uses save format **11** and wire protocol **14**.

## Player expedition boat

Each new game starts with one player-controlled boat at First Haven, separate from
automatic cargo, salvage, doctor, and ambient ships. Select the boat on the map or
in the Expedition panel. Right-click lit water to order it there, or right-click
a lighthouse and choose **Send expedition here** from its context menu. On touch,
tap the destination while the boat is selected. The panel also
lists lighthouse destinations for keyboard use. A new order replaces the old one.
The boat travels at 75 world units per simulation second through the connected
light network, including across wrapped map edges. It waits if an outage removes
its route, then resumes when a route returns. Movement and securing stop while
paused or when no players are connected.

On first arrival at a lighthouse, choose **Explore** for up to 20 Salvage (20 fuel
in old games without Salvage), limited by storage capacity, or **Secure** to hold
the boat there for 30 seconds and permanently reduce that beacon's upkeep by 0.25
fuel/second. Either choice immediately and permanently permits lighting it; the
boat stays until ordered again. First Haven is already visited. Older saves mark
previously lit beacons as visited from their exploration history, while unlit
beacons require a visit. Save format **12** and wire protocol **15** include this
state.
