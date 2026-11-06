import { expect, it, vi } from 'vitest';
import { researchWorldFixture } from '../research.fixture';

vi.mock('pixi.js', () => {
  class Container {
    children: Container[] = [];
    addChild(...children: Container[]) { this.children.push(...children); }
    position = { set() {} };
    anchor = { set() {} };
  }
  class Graphics extends Container {
    circles: number[][] = [];
    rect() { return this; }
    fill() { return this; }
    stroke() { return this; }
    ellipse() { return this; }
    poly() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    circle(...args: number[]) { this.circles.push(args); return this; }
  }
  return { Container, Graphics, Text: Container };
});
import { buildWorldLayers, terrainKey } from './worldLayers';

it('draws cross-seam light masks and ships on both sides of the tile', () => {
  const world = researchWorldFixture();
  world.width = 1000; world.height = 1000;
  world.salvage = null;
  world.islands = [];
  world.lighthouses = [10, 990].map((x, index) => ({
    id: String(index), island_id: String(index), name: 'Light', position: { x, y: 500 },
    radius: 290, effective_radius: 290, explored_radius: 290, active: true, connected: true,
    sick: false, immune_until: 300, specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25,
  }));
  world.shipping_links = [{ from: '0', to: '1' }];
  const built = buildWorldLayers(world);
  expect(built.ships.map(ship => [ship.from.x, ship.to.x])).toEqual([[10, -10], [1010, 990]]);
  const masks = built.worldLayer.children.filter(child => 'circles' in child) as unknown as { circles: number[][] }[];
  expect(masks.some(mask => mask.circles.some(([x]) => x === -10))).toBe(true);
  expect(masks.some(mask => mask.circles.some(([x]) => x === 1010))).toBe(true);
});

it('uses the same half-span route direction in every visible copy', () => {
  const world = researchWorldFixture();
  world.width = 1000; world.height = 1000;
  world.salvage = null; world.islands = [];
  world.lighthouses = [0, 500].map((x, index) => ({
    id: String(index), island_id: String(index), name: 'Light', position: { x, y: 500 },
    radius: 290, effective_radius: 290, explored_radius: 290, active: true, connected: true,
    sick: false, immune_until: 300, specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25,
  }));
  world.shipping_links = [{ from: '0', to: '1' }];
  expect(buildWorldLayers(world).ships.every(ship => ship.to.x-ship.from.x === 500)).toBe(true);
});

it('renders an ambient voyage on both copies of a seam crossing', () => {
  const world = researchWorldFixture();
  world.width = 1000; world.height = 1000;
  world.islands = [];
  world.lighthouses = [10, 990].map((x, index) => ({
    id: String(index), island_id: String(index), name: 'Light', position: { x, y: 500 },
    radius: 290, effective_radius: 290, explored_radius: 290, active: true, connected: true,
    sick: false, immune_until: 300, specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25,
  }));
  world.shipping_links = [{ from: '0', to: '1' }];
  world.voyages.ships = [{ id: 1, kind: 'mail', message_id: 0, origin: '0', destination: '1', from: '0', to: '1', progress: 0.5, phase: 'outbound', visit_timer: 0 }];
  const ships = buildWorldLayers(world, 'ships').ships.filter(ship => ship.id === 'voyage:1');
  expect(ships.map(ship => [ship.from.x, ship.to.x])).toEqual([[10, -10], [1010, 990]]);
});

it('draws the Veil warning on each visible copy across the seam', () => {
  const world = researchWorldFixture();
  world.width = 1000; world.height = 1000;
  world.lighthouses = [{
    id: 'target', island_id: 'remote', name: 'Target', position: { x: 10, y: 500 },
    radius: 290, effective_radius: 290, explored_radius: 290, active: true, connected: true,
    sick: false, immune_until: 300, specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25,
  }];
  world.veil!.target = 'target'; world.veil!.approach_remaining = 60;
  const drawn = buildWorldLayers(world, 'ships').shipLayer.children as unknown as { circles: number[][] }[];
  expect(drawn.flatMap(graphic => graphic.circles.map(([x]) => x))).toContain(10);
  expect(drawn.flatMap(graphic => graphic.circles.map(([x]) => x))).toContain(1010);
});

it('separates static and dynamic passes and invalidates visible terrain changes', () => {
  const world = researchWorldFixture();
  world.islands = [{ id: 'haven', name: 'Haven', position: { x: 100, y: 100 }, radius: 50, fuel_facility: 'haven', fuel_production: 2 }];
  const key = terrainKey(world);
  expect(terrainKey({ ...world, revision: 100, economy: { ...world.economy, fuel: 123 } })).toBe(key);
  expect(terrainKey({ ...world, islands: [{ ...world.islands[0], name: 'Renamed' }] })).not.toBe(key);
  expect(buildWorldLayers(world, 'ships').worldLayer.children).toHaveLength(0);
  expect(buildWorldLayers(world, 'terrain').ships).toHaveLength(0);
});
