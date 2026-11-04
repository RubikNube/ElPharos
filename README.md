# El Pharos

A lighthouse-network strategy game about bringing light to a dark ocean.
The [handover](El_Pharos_Project_Handover.md) is the project vision; the
[implementation plan](docs/implementation-plan.md) explains this session's scope,
decisions, protocol, and acceptance criteria.

This first playable slice contains one server-owned island and lighthouse, a
visible illumination radius, camera pan/zoom, and a beacon switch. Switching the
beacon sends a command to Rust; all connected clients render the resulting world
snapshot. Restarting the server restores the initial world.

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
Use **Extinguish beacon / Light the beacon** to change its illumination. Open a
second tab to see shared updates.

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
camera is local presentation state and never changes the domain. Pixi runs on
demand instead of maintaining an idle animation loop. Its canvas, observers,
listeners, and subscriptions are cleaned up on unmount, including React
StrictMode's asynchronous mount/unmount cycle.

## Verify

```sh
npm run check       # ESLint, client tests, production build, fmt, Clippy, Rust tests
npm run test:ws     # Starts its own Rust server on an ephemeral local port
```

The WebSocket test checks health, initial state, malformed commands, unknown IDs,
protocol mismatch, idempotency, broadcast to two clients, and reconnect snapshots.
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

This is a local, shared in-memory prototype. There are no accounts, persistence,
resource systems, weather, combat, story, or research. The handover's wider v0.1
save/load and resource goals are deferred. For deployment, serve the built client
and proxy `/ws` to Axum under the same origin, with TLS and appropriate access
control. Vite's development proxy is not part of the production build.

The production build currently emits a bundle-size advisory for the approximately
600 kB main JavaScript chunk (180 kB gzip), which includes the renderer. Splitting
and tuning the renderer bundle is deferred until loading performance is a goal.

The root `minimatch` override selects the patched 11.x release for development
tooling until upstream dependency ranges catch up. Recheck the override on future
ESLint/typescript-eslint upgrades. Lockfiles capture tested dependency versions.
