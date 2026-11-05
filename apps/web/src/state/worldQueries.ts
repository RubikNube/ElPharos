import type { WorldState } from '../protocol';
import { isDiscovered } from '../rendering/visibility';

export function networkUpkeep(world: WorldState) {
  return world.lighthouses.filter(light => light.active).reduce((sum, light) => sum + light.fuel_upkeep, 0);
}

export function isNetworkIlluminated(world: WorldState, position: { x: number; y: number }) {
  return world.lighthouses.some(light => light.connected && Math.hypot(light.position.x - position.x, light.position.y - position.y) <= light.radius);
}

export function lighthouseSelection(world: WorldState, selectedId: string | null) {
  const lighthouse = world.lighthouses.find(light => light.id === selectedId && isDiscovered(world, light.position));
  const island = world.islands.find(island => island.id === lighthouse?.island_id && isDiscovered(world, island.position));
  const yard = world.salvage?.yards.find(yard => yard.island_id === island?.id);
  const ship = world.salvage?.ships.find(ship => ship.yard_id === island?.id);
  return { lighthouse, island, yard, ship };
}

export function facilityBlockedReason(world: WorldState, island: WorldState['islands'][number] | undefined, connected: boolean) {
  if (!connected) return 'Reconnect to restore this facility.';
  if (island && !isNetworkIlluminated(world, island.position)) return 'Connect light from First Haven to this island to restore its facility.';
  if (world.economy.fuel < world.economy.facility_restore_cost) return 'Not enough fuel to restore facility.';
  return null;
}
