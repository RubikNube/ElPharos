import { expect, it } from 'vitest';
import { serverMessageSchema, worldSchema } from './protocol';

it('rejects incompatible protocol versions and invalid geometry', () => {
  expect(serverMessageSchema.safeParse({ type: 'error', protocol_version: 99, message: 'test' }).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'world_snapshot', protocol_version: 6, world: {
    objective_complete: false, shipping_links: [], revision: 0, width: -1, height: 100, islands: [], lighthouses: [],
  } }).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'error', protocol_version: 6, message: 'Unknown lighthouse' }).success).toBe(true);
});

it('validates fuel and simulation state from the authoritative snapshot', () => {
  const economy = { fuel: 300, capacity: 600, production: 2, facility_restore_cost: 120, beacon_upkeep: 1, elapsed_seconds: 0, paused: false, blackout: false };
  const world = { economy, objective_complete: false, shipping_links: [], revision: 0, width: 100, height: 100, radius_step: 60, radius_max: 650, islands: [], lighthouses: [] };
  expect(worldSchema.safeParse(world).success).toBe(true);
  for (const fuel of [0, 1.25, 42.5, 599.75, 600]) {
    expect(worldSchema.safeParse({ ...world, economy: { ...economy, fuel } }).success).toBe(true);
  }
  const light = { connected: true, id: 'a', island_id: 'i', name: 'Beacon', position: { x: 10, y: 10 }, radius: 350, explored_radius: 350, active: true, fuel_upkeep: 1.25, next_fuel_upkeep: 1.5 };
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
  const world = {
    economy: { fuel: 180, capacity: 600, production: 5, facility_restore_cost: 120, beacon_upkeep: 1, elapsed_seconds: 0, paused: false, blackout: false },
    objective_complete: false, shipping_links: [], revision: 1, width: 2400, height: 1000, radius_step: 60, radius_max: 650,
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
