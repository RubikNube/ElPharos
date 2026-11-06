import { expect, it } from 'vitest';
import { displacement, distance, images, nearest, wrap } from './geometry';
import { focusHaven, normalizeCamera, visibleTiles } from './rendering/camera';
import { researchWorldFixture } from './research.fixture';
import { isDiscovered, isIlluminated } from './rendering/visibility';
import type { WorldState } from './protocol';
import { lighthouseAt } from './rendering/lighthouseHover';

function populatedWorld(): WorldState {
  const world = researchWorldFixture();
  world.islands[0].fuel_facility = 'haven';
  world.lighthouses = [{ id: 'beacon-1', island_id: world.islands[0].id, name: 'First Light', position: { x: 400, y: 400 }, radius: 290, effective_radius: 290, explored_radius: 290, active: true, connected: true, sick: false, immune_until: 300, visited: true, secured: false, specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25 }];
  return world;
}
it('wraps axes, corners, negative positions, multiple spans, and half-span ties', () => {
  const world = { width: 100, height: 100 };
  expect(wrap(-201, 100)).toBe(99);
  expect(distance(world, { x: 97, y: 96 }, { x: 0, y: 0 })).toBe(5);
  expect(displacement(world, { x: 0, y: 0 }, { x: -250, y: 350 })).toEqual({ x: -50, y: 50 });
  expect(nearest(world, { x: 299, y: -199 }, { x: 1, y: 99 })).toEqual({ x: 301, y: -201 });
  expect(images(world, { x: 0, y: 0 }, -1, -1, 201, 201)).toHaveLength(9);
});
it('covers large viewports and normalizes without changing the apparent world', () => {
  const world = { width: 100, height: 100 };
  const camera = { x: -30001, y: 40001, zoom: 0.5 };
  const normalized = normalizeCamera(camera, world);
  expect((camera.x-normalized.x)/(world.width*camera.zoom)).toBeCloseTo(Math.round((camera.x-normalized.x)/(world.width*camera.zoom)));
  expect(visibleTiles(normalized, 800, 600, world).length).toBeGreaterThan(9);
  expect(normalizeCamera(normalized, world)).toEqual(normalized);
});
it('focuses Haven independently of unexplored map dimensions', () => {
  const world = populatedWorld();
  const camera = focusHaven(800, 600, world);
  expect(focusHaven(800, 600, { ...world, width: world.width*2, height: world.height*2 })).toEqual(camera);
  const haven = world.lighthouses[0];
  expect(camera.x+haven.position.x*camera.zoom).toBe(400);
  expect(camera.y+haven.position.y*camera.zoom).toBe(300);
});
it('discovers, illuminates, and selects repeated lighthouse copies across a corner', () => {
  const world = populatedWorld();
  world.width = 1000; world.height = 1000;
  world.lighthouses = [world.lighthouses[0]];
  world.lighthouses[0].position = { x: 997, y: 996 };
  const host = { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as HTMLDivElement;
  expect(isDiscovered(world, { x: 0, y: 0 })).toBe(true);
  expect(isIlluminated(world, { x: 0, y: 0 })).toBe(true);
  expect(lighthouseAt(host, world, { x: 0, y: 0, zoom: 1 }, -3, -4)?.id).toBe(world.lighthouses[0].id);
  expect(lighthouseAt(host, world, { x: 0, y: 0, zoom: 1 }, 2997, 2996)?.id).toBe(world.lighthouses[0].id);
});
