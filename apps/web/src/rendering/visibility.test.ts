import { expect, it } from 'vitest';
import { isDiscovered, isIlluminated } from './visibility';
import type { WorldState } from '../protocol';

it('uses the union of remembered circles, including extinguished beacons and boundaries', () => {
  const world: WorldState = {
    economy: { fuel: 300, capacity: 600, production: 2, facility_restore_cost: 120, beacon_upkeep: 1, elapsed_seconds: 0, paused: false, blackout: false },
    salvage: null, objective_complete: false, shipping_links: [], revision: 0, width: 1000, height: 1000, radius_step: 60, radius_max: 650, islands: [],
    lighthouses: [0, 150].map((x, i) => ({
      connected: false, fuel_upkeep: 1, next_fuel_upkeep: 1.25, id: String(i), island_id: String(i), name: 'Light', position: { x, y: 100 },
      radius: 200, explored_radius: 100, active: false,
    })),
  };
  expect(isDiscovered(world, { x: 75, y: 100 })).toBe(true);
  expect(isDiscovered(world, { x: 250, y: 100 })).toBe(true);
  expect(isDiscovered(world, { x: 251, y: 100 })).toBe(false);
  expect(isIlluminated(world, { x: 250, y: 100 })).toBe(false);
  world.lighthouses[1].active = true;
  expect(isIlluminated(world, { x: 350, y: 100 })).toBe(true);
  expect(isIlluminated(world, { x: 351, y: 100 })).toBe(false);
  world.lighthouses[1].explored_radius = 0;
  expect(isDiscovered(world, { x: 150, y: 100 })).toBe(false);
});
