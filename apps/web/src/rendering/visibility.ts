import { distance } from '../geometry';
import type { WorldState } from '../protocol';

export function isDiscovered(world: WorldState, position: { x: number; y: number }) {
  return world.lighthouses.some(light => light.explored_radius > 0 &&
    distance(world, position, light.position) <= light.explored_radius);
}

export function isIlluminated(world: WorldState, position: { x: number; y: number }) {
  return world.lighthouses.some(light => light.active &&
    distance(world, position, light.position) <= light.effective_radius);
}
