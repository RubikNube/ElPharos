import type { WorldState } from '../protocol';
import type { WorldCommands } from '../network/commands';
import type { Lighthouse } from '../state/keeper';

export function doctorBlockedReason(world: WorldState, light: Lighthouse, connected: boolean) {
  if (!connected) return 'Reconnect to send the doctor.';
  if (world.doctor) return world.doctor.destination === light.id && !world.doctor.returning ? 'Doctor is on the way.' : 'Doctor ship is busy.';
  if (!light.sick) return 'Keeper is healthy.';
  if (world.economy.fuel < world.doctor_rules.trip_fuel) return 'Not enough fuel for doctor visit.';
  return null;
}

export function DoctorPanel({ world, light, connected, commands }: { world: WorldState; light: Lighthouse; connected: boolean; commands: WorldCommands }) {
  const blocked = doctorBlockedReason(world, light, connected);
  const destination = world.lighthouses.find(l => l.id === world.doctor?.destination);
  return <section aria-label="Doctor visits">
    {light.sick && <p>The keeper is sick. Light range is reduced by 25% until treated.</p>}
    {world.doctor && <p role="status">Doctor ship: {world.doctor.returning ? `returning from ${destination?.name}` : `outbound to ${destination?.name}`}.</p>}
    {light.sick && <>
      <button disabled={!!blocked} onClick={() => commands.sendDoctor(light.id)}>Send doctor — {world.doctor_rules.trip_fuel} fuel</button>
      <p>{blocked ?? 'Treatment restores full range on arrival. The fare covers the return trip, including through isolated waters.'}</p>
    </>}
  </section>;
}
