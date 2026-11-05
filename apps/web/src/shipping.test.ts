import { expect, it } from 'vitest';
import { cargoStatus } from './shipping';
import { researchWorldFixture } from './research.fixture';

it('updates sailing ETA from effective rules while preserving blocked and paused status', () => {
  const world = researchWorldFixture();
  const light = { id: 'a', island_id: 'island-5', name: 'Light', position: { x: 0, y: 0 }, radius: 290, active: true, explored_radius: 290, specialization: null, connected: true, fuel_upkeep: 1, next_fuel_upkeep: 1.25 };
  world.lighthouses = [light, { ...light, id: 'b', position: { x: 450, y: 0 } }];
  const ship = { yard_id: 'island-5', from: 'a', to: 'b', progress: 0.5, cargo: 20, returning: false, route: ['a', 'b'] };
  expect(cargoStatus(world, ship)).toBe('Delivering to Haven · ETA 4s');
  world.salvage!.rules.speed = 75;
  expect(cargoStatus(world, ship)).toBe('Delivering to Haven · ETA 3s');
  world.lighthouses[1].specialization = 'navigation_beacon';
  expect(cargoStatus(world, ship)).toBe('Delivering to Haven · ETA 2s');
  world.lighthouses[1].connected = false;
  expect(cargoStatus(world, ship)).toContain('Route blocked');
  world.economy.paused = true;
  expect(cargoStatus(world, ship)).toBe('Paused');
});
