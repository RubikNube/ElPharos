import type { WorldState } from '../protocol';

export function isDiscovered(world: WorldState, position: { x: number; y: number }) {
  return world.lighthouses.some(light => light.explored_radius > 0 &&
    Math.hypot(position.x - light.position.x, position.y - light.position.y) <= light.explored_radius);
}
