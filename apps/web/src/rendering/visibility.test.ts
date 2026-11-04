import { expect, it } from 'vitest';
import { isDiscovered } from './visibility';
import type { WorldState } from '../protocol';

it('uses the union of remembered circles, including extinguished beacons and boundaries', () => {
  const world: WorldState = {
    revision: 0, width: 1000, height: 1000, radius_step: 60, radius_max: 650, islands: [],
    lighthouses: [0, 150].map((x, i) => ({
      id: String(i), island_id: String(i), name: 'Light', position: { x, y: 100 },
      radius: 200, explored_radius: 100, active: false,
    })),
  };
  expect(isDiscovered(world, { x: 75, y: 100 })).toBe(true);
  expect(isDiscovered(world, { x: 250, y: 100 })).toBe(true);
  expect(isDiscovered(world, { x: 251, y: 100 })).toBe(false);
  world.lighthouses[1].explored_radius = 0;
  expect(isDiscovered(world, { x: 150, y: 100 })).toBe(false);
});
