import { cargoSpeed, type WorldState } from './protocol';

export function cargoStatus(world: WorldState, ship: NonNullable<WorldState['salvage']>['ships'][number]) {
  const from = world.lighthouses.find(l => l.id === ship.from);
  const to = world.lighthouses.find(l => l.id === ship.to);
  if (!from || !to) return 'Awaiting route';
  if (world.economy.paused) return 'Paused';
  if (!from.connected || !to.connected || Math.hypot(from.position.x-to.position.x, from.position.y-to.position.y) > from.radius+to.radius) return 'Route blocked — reconnect the lights';
  if (ship.from === ship.to) return ship.cargo && !ship.returning && from.island_id === world.islands.find(i => i.fuel_facility === 'haven')?.id ? 'Waiting for reserve space' : 'Loading / awaiting departure';
  const remaining = ship.route.slice(1).reduce((sum, id, index) => {
    const a = world.lighthouses.find(l => l.id === ship.route[index]);
    const b = world.lighthouses.find(l => l.id === id);
    return sum + (a && b ? Math.hypot(a.position.x-b.position.x, a.position.y-b.position.y) * (index === 0 ? 1-ship.progress : 1) / cargoSpeed(world, a.id, b.id) : 0);
  }, 0);
  return `${ship.returning ? 'Returning to yard' : 'Delivering to Haven'} · ETA ${Math.ceil(remaining)}s`;
}
