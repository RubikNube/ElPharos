import { expect, it } from 'vitest';
import { researchWorldFixture } from '../research.fixture';
import { keeperIdentity, keeperMood, keeperName, pickRemark, remarks, type Lighthouse } from './keeper';

const light: Lighthouse = {
  id: 'beacon-1', island_id: 'island-1', name: 'First Light', position: { x: 100, y: 100 },
  active: true, connected: true, radius: 290, explored_radius: 290,
  specialization: null, fuel_upkeep: 1.25, next_fuel_upkeep: 1.5,
};

it('keeps keeper identity and name stable across snapshots and save round trips', () => {
  const loaded = JSON.parse(JSON.stringify(light)) as Lighthouse;
  loaded.active = false;
  loaded.radius = 650;
  expect(keeperIdentity(loaded)).toBe(keeperIdentity(light));
  expect(keeperName(loaded)).toBe(keeperName(light));
  expect(keeperName(light)).toMatch(/^\w+ \w+$/);
  expect(keeperIdentity({ ...light, position: { x: 200, y: 100 } })).not.toBe(keeperIdentity(light));
});

it('prioritizes darkness, blackout and low fuel over isolation, with an exact ten-second threshold', () => {
  const world = researchWorldFixture();
  world.lighthouses = [{ ...light }, { ...light, id: 'beacon-2', fuel_upkeep: 2 }];
  const selected = world.lighthouses[0];
  world.economy.fuel = 32.5;
  expect(keeperMood(world, selected)).toBe('Cheerful');
  selected.connected = false;
  expect(keeperMood(world, selected)).toBe('Lonely');
  world.economy.fuel = 32.25;
  expect(keeperMood(world, selected)).toBe('Worried');
  world.economy.fuel = 300;
  world.economy.blackout = true;
  expect(keeperMood(world, selected)).toBe('Worried');
  world.economy.blackout = false;
  selected.active = false;
  selected.connected = true;
  expect(keeperMood(world, selected)).toBe('Worried');
});

it('offers varied mood-specific remarks and excludes the previous sentence', () => {
  for (const mood of ['Worried', 'Lonely', 'Cheerful'] as const) {
    expect(remarks[mood].length).toBeGreaterThanOrEqual(4);
    const first = pickRemark(mood, undefined, () => 0);
    expect(remarks[mood]).toContain(first);
    expect(pickRemark(mood, first, () => 0)).not.toBe(first);
    expect(pickRemark(mood, undefined, () => 0.99)).not.toBe(first);
  }
});
