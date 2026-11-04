# El Pharos

A lighthouse-network strategy game about bringing light to a dark ocean.
The [handover](El_Pharos_Project_Handover.md) is the project vision; the
[implementation plan](docs/implementation-plan.md) explains this session's scope,
decisions, protocol, and acceptance criteria.

New games contain six islands, including two salvage yards with automatic cargo
deliveries. See **Salvage and cargo expansion** below for the new economy.
Older saves retain the original four-island scenario described in the following
legacy gameplay sections. The playable archipelago is server-owned.
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

Drag the chart to pan; scroll to zoom around the pointer. Use the visible zoom
and reset controls, or focus the map and press arrow keys, `+`, `-`, and `0`.
Select a lighthouse by clicking its marker or its button in the side panel.
Use **Extinguish beacon / Light the beacon** to change its illumination.
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
New saves use format 4 and persist facilities rather than derived production. Wire protocol 6 requires matching client and server versions.

## Connected shipping and scenario goal

First Light anchors the network. Active beacons connect automatically when their
circles overlap or touch, including through chains of other active beacons.
Golden links and moving ships show these safe corridors; shipping has no cargo
inventories, travel delay, or fleet controls. Restored remote facilities stop
producing when their beacon goes dark or loses its connection. Relighting the
chain resumes production on the next tick. Connectivity and effective production
are derived after every change and after loading; existing saves adopt these rules.

Restore all three remote facilities and connect all four active beacons with
nonnegative net fuel to complete the scenario. The objective panel tracks progress;
completion reflects the current network and play continues afterward.

## Structure and responsibilities

```text
ElPharos/
├── El_Pharos_Project_Handover.md
├── Cargo.toml / Cargo.lock
├── package.json / package-lock.json
├── apps/
│   ├── server/
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── domain.rs                 # World models and mutations
│   │       ├── protocol.rs               # Versioned JSON commands/snapshots
│   │       ├── lib.rs                    # Axum routes and WebSocket sessions
│   │       └── main.rs                   # Bind address, logging, shutdown
│   └── web/
│       ├── package.json
│       ├── index.html
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── eslint.config.js
│       └── src/
│           ├── main.tsx / App.tsx / styles.css
│           ├── protocol.ts / protocol.test.ts
│           ├── components/WorldMap.tsx
│           ├── network/connection.ts
│           ├── state/worldStore.ts
│           └── rendering/
│               ├── scene.ts
│               └── camera.ts / camera.test.ts
├── docs/implementation-plan.md
└── tests/websocket.mjs
```

Rust owns entity IDs, positions, geometry, beacon activation, and world revision.
Axum sends a snapshot on connection and after commands; Tokio watch channels
publish the latest world to all clients. Zustand stores validated snapshots and
connection status. React owns the interface; Pixi owns the map and camera. No
simulation or default world is duplicated in the client.

World geometry uses arbitrary world units, with positive y pointing down. The
camera is local presentation state and never changes the domain. Pixi renders on
demand except while shipping links animate. Shipping pauses with the simulation and respects reduced-motion preferences. Its canvas, observers,
listeners, and subscriptions are cleaned up on unmount, including React
StrictMode's asynchronous mount/unmount cycle.

## Verify

```sh
npm run check       # ESLint, client tests, production build, fmt, Clippy, Rust tests
npm run test:ws     # Starts its own Rust server on an ephemeral local port
```

The GitHub Actions **Verify** workflow runs both commands on every push and pull
request, and supports manual runs. It uses Node.js 24 and stable Rust on Linux,
and builds the server before the WebSocket test to avoid compilation consuming
its startup timeout. Browser smoke testing remains a manual check.

The WebSocket test checks health, initial state, malformed commands, unknown IDs,
protocol mismatch, idempotency, broadcast to two clients, concurrent upgrades,
save/load failures, exploration persistence, and loading after a server restart.
It requires permission to bind a local TCP port. Client tests check geometry
validation, zoom bounds, cursor anchoring, and fit-to-world behavior.

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

This is a local prototype with one shared world and an explicit durable save slot. There are no accounts,
general construction, trade, weather, combat, story, or research. Fuel is the first resource system; further economy features remain deferred. For deployment, serve the built client
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

New games now contain six islands. Wreckers' Cove and Iron Shoal offer competing
salvage-yard investments; both are visible in the starting light. **Salvage** is
recovered metal used to reinforce towers and repair yard machinery. First Haven
starts with 100 Salvage (capacity 300), and its salvage operation adds 1 every
10 simulation seconds, including during blackouts. Radius expansions cost 20
Salvage in addition to their ongoing fuel upkeep. Existing fuel facilities still
cost 120 fuel to restore.

Restore a salvage yard for 120 fuel and 40 Salvage under connected illumination.
Wreckers' Cove produces 1 Salvage every 4 seconds; farther Iron Shoal produces 1
every 2 seconds. Yards operate only while their beacon is connected and hold up
to 60 locally. Restoration includes an automatic ship carrying up to 20 Salvage
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

New objectives include restoring both yards and receiving a delivery from each,
as well as restoring the three fuel facilities and connecting all six beacons
with sustainable fuel. Saves use format 5 and preserve production timers and
cargo in transit. Formats 1–4 retain their original map, free expansion, and
objective under a legacy ruleset, which remains in effect after saving again.
Wire protocol 7 requires matching client and server versions. The older sections
above describe the original four-island scenario; these rules supersede them for
new games. Balance constants live in `apps/server/src/salvage.rs` and are included
in snapshots for the interface.
