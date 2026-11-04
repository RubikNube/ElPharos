# El Pharos - Project Handover / Vision Document

## Elevator Pitch

**El Pharos** is a lighthouse-network strategy game where the player gradually illuminates a dark and mysterious ocean. Civilization survives only within the reach of lighthouse beacons. Players build, upgrade, and connect lighthouses, establish trade routes, explore hidden islands, and push back an intelligent supernatural fog known as **The Veil**.

> Transform an ocean of darkness into a glowing network of light.

---

## Genre

- Strategy
- City/Network Builder
- Exploration
- Light Resource Management

## Inspiration

- Frostpunk
- Against the Storm
- Dredge
- Dorfromantik
- Anno

## Unique Selling Point

Light is not only vision but also:

- Safety
- Infrastructure
- Energy
- Communication
- Exploration

Players literally watch their empire grow through expanding circles of illumination.

---

# Core Gameplay Loop

## Early Game

- One lighthouse
- One island
- Limited fuel
- Small population

Gameplay:
1. Gather resources
2. Produce fuel
3. Keep the beacon active
4. Explore nearby islands

## Mid Game

- Additional islands
- Lighthouse network
- Trade routes
- Specialized structures

Gameplay:
1. Balance light production
2. Connect islands
3. Maintain trade routes
4. Discover ancient technology

## Late Game

- Ocean-wide lighthouse network
- Multiple fleets
- Regional economy

Gameplay:
1. Maintain large beacon systems
2. Fight the spreading Veil
3. Recover relics
4. Construct the Great Pharos

---

# World Lore

## The Great Pharos

A legendary lighthouse once illuminated the world.

## The Veil

A supernatural living fog consumed the oceans and isolated civilization.

The player's mission is to restore the beacon network and relight the Great Pharos.

---

# Resources

## Fuel

Generated from:
- Coal
- Oil
- Biomass
- Ancient crystals

Used by:
- Lighthouses

## Light

Primary strategic resource.

Used by:
- Beacons
- Harbors
- Defenses
- Research
- Communication towers

## Population

Workers required for:
- Mines
- Harbors
- Beacons
- Expeditions

---

# Lighthouse Types

## Standard Beacon
Basic lighthouse.

## Trade Beacon
Improves shipping and trade.

## Watch Beacon
Increases exploration and weather awareness.

## Prism Beacon
Splits light into multiple directions.

## Ancient Beacon
Massive late-game lighthouse technology.

---

# Exploration

Dark regions may contain:

- New islands
- Ancient ruins
- Resources
- Lost technologies
- Story events

Ships that travel beyond safe light coverage risk being lost.

---

# Weather System

- Fog
- Storms
- Hurricanes
- Eclipses
- Aurora events

Weather affects visibility, trading, exploration, and lighthouse performance.

---

# Visual Design

## Color Palette

Primary:
- Deep Ocean Blue (#081521)
- Navy (#0F2234)

Lighting:
- Golden Yellow (#FFD34D)
- Warm White

Fog:
- Blue-Grey
- Purple-Grey

## Visual Rule

The world should look beautiful at night.

Players should enjoy watching:
- Lighthouse beams
- Illuminated islands
- Moving ships
- Trade networks
- Dynamic weather

---

# Technical Architecture

## Frontend

- React
- TypeScript
- Vite
- Zustand
- PixiJS
- TailwindCSS

### Component Structure

```text
App
├── TopBar
├── WorldMap
│   ├── OceanLayer
│   ├── FogLayer
│   ├── IslandLayer
│   ├── LighthouseLayer
│   ├── TradeRouteLayer
│   ├── FleetLayer
│   └── WeatherLayer
├── SidePanel
├── BottomToolbar
└── Notifications
```

## Backend

- Rust
- Axum
- Tokio
- Serde
- WebSockets

Responsibilities:

- Economy simulation
- Population simulation
- Weather
- Trade
- Exploration
- AI
- Savegames

Frontend should remain primarily a renderer.

---

# Rust Data Model (Draft)

```rust
struct Lighthouse {
    id: Uuid,
    name: String,
    position: Point,
    level: u32,
    fuel: f32,
    light_output: f32,
    radius: f32,
}

struct Island {
    id: Uuid,
    name: String,
    population: u32,
}

struct TradeRoute {
    from: Uuid,
    to: Uuid,
    capacity: f32,
}
```

---

# MVP Roadmap

## Version 0.1

- World map
- Single lighthouse
- Single island
- Light radius rendering
- Basic resources
- Save/Load

## Version 0.2

- Multiple islands
- Trade routes
- Moving ships
- Fog of war

## Version 0.3

- Exploration
- Lighthouse specialization
- Research tree

---

# Long-Term Vision

```text
Single Lighthouse
      ↓
Small Archipelago
      ↓
Regional Trade Network
      ↓
Ocean-Wide Beacon Network
      ↓
Restoration of the Great Pharos
      ↓
The Veil Recedes
      ↓
World Fully Illuminated
```

## One-Sentence Vision

**El Pharos is a strategy game about bringing light, safety, and civilization back to a dark ocean, one lighthouse at a time.**
