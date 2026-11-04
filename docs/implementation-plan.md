# El Pharos: first playable foundation

## Authority and scope

Read in full: `El_Pharos_Project_Handover.md`. Its central promise is expanding
warm light across a dark ocean. The frontend is primarily a renderer; Rust owns
the world and all gameplay decisions. This session is a deliberately smaller
slice than the document's full v0.1 roadmap.

Deliver one island, one standard beacon, a visible illumination circle, camera
pan/zoom, and a server-authoritative beacon switch. No weather, combat, story,
research, resource simulation, population simulation, persistence, fog of war,
ships, or trade. Fuel and population from the draft models are deferred until
they have behavior. Tailwind is also deferred: a small stylesheet is sufficient.

## Implementation sequence and rationale

1. **Workspaces:** npm workspace at `apps/web`, Cargo workspace at `apps/server`.
   Keep one deployable client and one server; avoid premature shared packages.
   Lock dependencies and provide build/check commands from the repository root.
2. **Domain:** Rust `Point`, `Lighthouse`, `Island`, `WorldState`. Stable IDs,
   island association, dimensions, position, radius, active flag, revision.
   World initialization belongs only to the server. Reject unknown beacon IDs.
3. **Transport:** Axum `/health` and `/ws`; JSON protocol version 1. Send a full
   snapshot immediately and after commands. A Tokio watch channel serializes
   mutations and publishes the newest state to every connected client. Full
   snapshots avoid delta ordering/resynchronization complexity at this scale.
4. **Client data flow:** validate unknown JSON with Zod, then update Zustand.
   React displays connection status; Pixi subscribes to world state. Retry lost
   connections with capped backoff, discard stale world on disconnect, disable
   commands until a valid snapshot arrives. Clean up sockets and timers on unmount.
5. **Rendering:** one Pixi application with ocean, island, illumination, and
   beacon graphics. Use #081521, #0F2234, #FFD34D from the handover. All entity
   placement and illumination distances come from snapshots. Graphics and labels
   are presentation only. No fabricated client world while connecting.
6. **Camera:** separate pure camera math from DOM input. Drag with pointer capture;
   clamp wheel zoom around the cursor; fit/reset to server world dimensions.
   Provide keyboard navigation and visible zoom/reset controls. Resize with the
   host element and release listeners, observers, and GPU resources on unmount.
7. **Playable interaction:** send an idempotent `set_lighthouse_active` command.
   The server publishes the resulting state, and the light circle changes only
   after that snapshot. Multiple tabs share one in-memory world.
8. **Verification:** TypeScript and Vite production build, ESLint, Rust fmt,
   Clippy, domain tests, camera/protocol tests, and a real WebSocket integration
   test for initial state, invalid commands, mutation, and multi-client updates.
   Browser smoke test where browser tooling is available.

## Protocol v1

Server: `{ "type": "world_snapshot", "protocol_version": 1, "world": ... }`

Client: `{ "type": "set_lighthouse_active", "protocol_version": 1,
"lighthouse_id": "beacon-1", "active": false }`

Server error: `{ "type": "error", "protocol_version": 1, "message": "..." }`

Coordinates and radii are world units, y points down. World revision increases
only when a command actually changes state. Errors do not mutate state. The
client and server declare their respective wire types; validation and integration
tests guard the boundary. Generate shared types later if the protocol grows.

## File ownership

```text
apps/server/src/{domain,protocol}.rs       pure domain and wire messages
apps/server/src/lib.rs                   routes and WebSocket sessions
apps/server/src/main.rs                  process startup and shutdown
apps/web/src/protocol.ts                 runtime schemas and inferred types
apps/web/src/network/connection.ts       socket and reconnect lifecycle
apps/web/src/state/worldStore.ts         received world and connection status
apps/web/src/rendering/{camera,scene}.ts  camera mathematics and Pixi scene
apps/web/src/components/WorldMap.tsx     React/Pixi lifecycle boundary
apps/web/src/App.tsx                     player controls and status
tests/websocket.mjs                      real-server protocol integration
```

## Acceptance and operating limits

Run server and Vite, see the server's island and beacon, pan, zoom, reset, and
toggle the light. A second tab sees the same toggle. Restarting the server resets
the world and clients reconnect. Malformed input does not crash the service.

This is a local prototype, bound to loopback by default. There is one shared
world, no authentication, no per-player session, and no persistence. Production
hosting needs TLS termination, same-origin `/ws` proxying, access control, and
explicit session ownership. These are future deployment work, not game systems
to add to this slice.

## Completed verification

- `npm run check`: passed (ESLint, three frontend tests, TypeScript/Vite build,
  Rust formatting, Clippy with warnings denied, and domain test).
- `npm run test:ws`: passed against a real Axum process and multiple clients.
- Headless Chromium: rendered one canvas under StrictMode, switched illumination
  through the backend, exercised drag/wheel/reset, and checked mobile overflow.
  No application browser errors were reported.
- Dependency audit after tooling updates and the documented minimatch override:
  zero reported vulnerabilities.
- Known build advisory: main JavaScript chunk approximately 600 kB / 180 kB gzip.

API references consulted: [PixiJS Graphics](https://pixijs.com/8.x/guides/components/scene-objects/graphics),
[Axum WebSockets](https://docs.rs/axum/latest/axum/extract/ws/),
and [Vite setup](https://vite.dev/guide/).
