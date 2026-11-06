import { distance } from './geometry';
import type { WorldState } from './protocol';

export function cargoStatus(world: WorldState, ship: NonNullable<WorldState['salvage']>['ships'][number]) {
  const from = world.lighthouses.find(l => l.id === ship.from);
  const to = world.lighthouses.find(l => l.id === ship.to);
  if (!from || !to) return 'Awaiting route';
  if (world.economy.paused) return 'Paused';
  if (!from.connected || !to.connected || distance(world, from.position, to.position) > from.effective_radius+to.effective_radius) return 'Route blocked — reconnect the lights';
  if (ship.from === ship.to) return ship.cargo && !ship.returning && from.island_id === world.islands.find(i => i.fuel_facility === 'haven')?.id ? 'Waiting for reserve space' : 'Loading / awaiting departure';
  const remaining = ship.route.slice(1).reduce((sum, id, index) => {
    const a = world.lighthouses.find(l => l.id === ship.route[index]);
    const b = world.lighthouses.find(l => l.id === id);
    return sum + (a && b ? distance(world, a.position, b.position) * (index === 0 ? 1-ship.progress : 1) / cargoSpeed(world, a.id, b.id) : 0);
  }, 0);
  return `${ship.returning ? 'Returning to yard' : 'Delivering to Haven'} · ETA ${Math.ceil(remaining)}s`;
}

export function cargoSpeed(world: WorldState, from: string, to: string): number {
  const rules = world.salvage?.rules;
  const boosted = world.lighthouses.some(l => (l.id === from || l.id === to) && l.specialization === 'navigation_beacon');
  return (rules?.speed ?? 60) * (boosted ? rules?.navigation_multiplier ?? 1 : 1);
}
