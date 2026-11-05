import { cargoSpeed } from './shipping';
import { expect, it } from 'vitest';
import { researchFixture, researchWorldFixture } from './research.fixture';
import { serverMessageSchema, worldSchema } from './protocol';

it('rejects incompatible protocol versions and invalid geometry', () => {
  expect(serverMessageSchema.safeParse({ type: 'error', protocol_version: 119, message: 'test' }).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'world_snapshot', protocol_version: 11, world: {
    research: null, salvage: null, objective_complete: false, shipping_links: [], revision: 0, width: -1, height: 100, islands: [], lighthouses: [],
  } }).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'error', protocol_version: 11, message: 'Unknown lighthouse' }).success).toBe(true);
});

it('validates fuel and simulation state from the authoritative snapshot', () => {
  const economy = { fuel: 300, capacity: 600, production: 2, facility_restore_cost: 120, restored_facility_production: 3, beacon_upkeep: 1, elapsed_seconds: 0, paused: false, blackout: false };
  const world = { doctor: null, doctor_rules: { trip_fuel: 40, speed: 120 }, economy, research: null, salvage: null, objective_complete: false, shipping_links: [], revision: 0, width: 100, height: 100, radius_step: 60, radius_max: 650, islands: [], lighthouses: [] };
  expect(worldSchema.safeParse(world).success).toBe(true);
  for (const fuel of [0, 1.25, 42.5, 599.75, 600]) {
    expect(worldSchema.safeParse({ ...world, economy: { ...economy, fuel } }).success).toBe(true);
  }
  const light = { specialization: null, connected: true, id: 'a', island_id: 'i', name: 'Beacon', position: { x: 10, y: 10 }, radius: 350, effective_radius: 350, sick: false, immune_until: 300, explored_radius: 350, active: true, fuel_upkeep: 1.25, next_fuel_upkeep: 1.5 };
  expect(worldSchema.safeParse({ ...world, lighthouses: [light] }).success).toBe(true);
  expect(worldSchema.safeParse({ ...world, lighthouses: [{ ...light, next_fuel_upkeep: null }] }).success).toBe(true);
  for (const fuel_upkeep of [undefined, 0, 1.1, 3]) {
    expect(worldSchema.safeParse({ ...world, lighthouses: [{ ...light, fuel_upkeep }] }).success).toBe(false);
  }
  for (const fuel of [-1, 601, 1.1]) {
    expect(worldSchema.safeParse({ ...world, economy: { ...economy, fuel } }).success).toBe(false);
  }
  expect(worldSchema.safeParse({ ...world, economy: undefined }).success).toBe(false);
  expect(worldSchema.safeParse({ ...world, economy: { ...economy, elapsed_seconds: Number.MAX_SAFE_INTEGER + 1 } }).success).toBe(false);
});

it('validates facility snapshots and variable production', () => {
  const world = { doctor: null, doctor_rules: { trip_fuel: 40, speed: 120 },
    economy: { fuel: 180, capacity: 600, production: 5, facility_restore_cost: 120, restored_facility_production: 3, beacon_upkeep: 1, elapsed_seconds: 0, paused: false, blackout: false },
    research: null, salvage: null, objective_complete: false, shipping_links: [], revision: 1, width: 2400, height: 1000, radius_step: 60, radius_max: 650,
    islands: [{ id: 'island-2', name: 'Amber Shoal', position: { x: 1250, y: 650 }, radius: 90, fuel_facility: 'restored', fuel_production: 3 }], lighthouses: [],
  };
  expect(worldSchema.safeParse(world).success).toBe(true);
  expect(worldSchema.safeParse({ ...world, islands: [{ ...world.islands[0], fuel_facility: 'unknown' }] }).success).toBe(false);
  expect(worldSchema.safeParse({ ...world, islands: [{ ...world.islands[0], fuel_production: 99 }] }).success).toBe(false);
  expect(worldSchema.safeParse({ ...world, islands: [{ ...world.islands[0], fuel_production: 0 }] }).success).toBe(true);
  expect(worldSchema.safeParse({ ...world, shipping_links: [{ from: 'a', to: 'b' }] }).success).toBe(true);
  expect(worldSchema.safeParse({ ...world, shipping_links: [{ from: 'a' }] }).success).toBe(false);
  expect(worldSchema.safeParse({ ...world, objective_complete: undefined }).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'world_snapshot', protocol_version: 5, world }).success).toBe(false);
});

it('validates authoritative cargo and Salvage rules', () => {
  const base = { doctor: null, doctor_rules: { trip_fuel: 40, speed: 120 },
    research: researchFixture(),
    economy: { fuel: 180, capacity: 600, production: 2, facility_restore_cost: 120, restored_facility_production: 3, beacon_upkeep: 1, elapsed_seconds: 1, paused: false, blackout: false },
    objective_complete: false, shipping_links: [], revision: 1, width: 2400, height: 1000, radius_step: 60, radius_max: 650, islands: [], lighthouses: [],
  };
  const salvage = {
    vessel: null, vessel_route: null,
    rules: { vessel: { build_fuel: 200, trip_fuel: 120, fuel_reserve: 120, hold: 40, travel_seconds: 5, salvage_period: 2 }, specialization_cost: 40, refit_cost: 20, efficiency_saving: 0.5, navigation_multiplier: 1.5, capacity: 300, expand_cost: 20, restore_cost: 40, restore_fuel: 120, speed: 60, hold: 20, local_capacity: 60, haven_period: 10 },
    reserve: 60, haven_timer: 1,
    yards: [{ island_id: 'island-5', period: 4, restored: true, stock: 3, timer: 1, delivered: false }],
    ships: [{ yard_id: 'island-5', from: 'beacon-5', to: 'beacon-1', progress: 0.25, cargo: 10, returning: false, route: ['beacon-5', 'beacon-1'] }],
  };
  expect(worldSchema.safeParse({ ...base, salvage }).success).toBe(true);
  for (const reserve of [-1, 301, 1.5]) expect(worldSchema.safeParse({ ...base, salvage: { ...salvage, reserve } }).success).toBe(false);
  for (const cargo of [-1, 21, 1.5]) expect(worldSchema.safeParse({ ...base, salvage: { ...salvage, ships: [{ ...salvage.ships[0], cargo }] } }).success).toBe(false);
  expect(worldSchema.safeParse({ ...base, salvage: { ...salvage, ships: [{ ...salvage.ships[0], progress: 1 }] } }).success).toBe(false);
  expect(worldSchema.safeParse(base).success).toBe(false);
});

it('validates research catalog, prerequisites, discovery, and effective cargo capacity', () => {
  const world = researchWorldFixture();
  expect(worldSchema.safeParse(world).success).toBe(true);
  expect(worldSchema.safeParse({ ...world, research: undefined }).success).toBe(false);
  expect(worldSchema.safeParse({ ...world, research: null }).success).toBe(false);
  expect(worldSchema.safeParse({ ...world, salvage: null }).success).toBe(false);
  for (const completed of [['unknown'], ['reinforced_foundations', 'reinforced_foundations'], ['modular_fittings'], ['streamlined_hulls']]) {
    expect(worldSchema.safeParse({ ...world, research: { ...world.research, completed } }).success).toBe(false);
  }
  const bad = researchFixture();
  bad.catalog[1].available = true;
  bad.catalog[1].blocked_reason = null;
  expect(worldSchema.safeParse({ ...world, research: bad }).success).toBe(false);
  world.research!.completed.push('reinforced_foundations');
  world.research!.catalog[0].available = false;
  world.research!.catalog[0].blocked_reason = 'Already researched';
  world.salvage!.rules.expand_cost = 15;
  world.salvage!.rules.hold = 30;
  const ship = { yard_id: 'island-5', from: 'a', to: 'b', progress: 0.5, cargo: 30, returning: false, route: ['a', 'b'] };
  world.salvage!.ships.push(ship);
  expect(worldSchema.safeParse(world).success).toBe(true);
  world.salvage!.rules.hold = 20;
  expect(worldSchema.safeParse(world).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'world_snapshot', protocol_version: 8, world }).success).toBe(false);
});

it('uses researched shipping speed with non-stacking navigation bonuses', () => {
  const world = researchWorldFixture();
  const light = { id: 'a', island_id: 'island-2', name: 'Light', position: { x: 0, y: 0 }, radius: 290, effective_radius: 290, sick: false, immune_until: 300, active: true, explored_radius: 290, specialization: null, connected: true, fuel_upkeep: 1, next_fuel_upkeep: 1.25 };
  world.lighthouses = [light, { ...light, id: 'b', position: { x: 200, y: 0 } }];
  expect(cargoSpeed(world, 'a', 'b')).toBe(60);
  world.salvage!.rules.speed = 75;
  expect(cargoSpeed(world, 'a', 'b')).toBe(75);
  world.lighthouses[0].specialization = 'navigation_beacon';
  expect(cargoSpeed(world, 'a', 'b')).toBe(112.5);
  world.lighthouses[1].specialization = 'navigation_beacon';
  expect(cargoSpeed(world, 'b', 'a')).toBe(112.5);
});

it('rejects inconsistent expedition phases and missing vessel routes', async () => {
  const { researchWorldFixture } = await import('./research.fixture');
  const world = researchWorldFixture();
  const s = world.salvage!;
  s.vessel_route = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  s.vessel = { enabled: true, phase: 'searching', timer: 21, cargo: 10 };
  expect(worldSchema.safeParse(world).success).toBe(true);
  s.vessel.cargo = 11;
  expect(worldSchema.safeParse(world).success).toBe(false);
  s.vessel = { enabled: false, phase: 'returning', timer: 4, cargo: 40 };
  expect(worldSchema.safeParse(world).success).toBe(true);
  s.vessel.timer = 5;
  expect(worldSchema.safeParse(world).success).toBe(false);
  s.vessel = { enabled: true, phase: 'docked', timer: 0, cargo: 41 };
  expect(worldSchema.safeParse(world).success).toBe(false);
  s.vessel.cargo = 0;
  s.vessel_route = null;
  expect(worldSchema.safeParse(world).success).toBe(false);
});
