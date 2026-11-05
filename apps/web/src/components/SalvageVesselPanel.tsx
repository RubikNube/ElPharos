import type { WorldState } from '../protocol';
import type { WorldCommands } from '../network/commands';

export function vesselStatus(world: WorldState): string {
  const s = world.salvage;
  if (!s?.vessel) return '';
  const v = s.vessel, r = s.rules.vessel;
  if (world.economy.paused) return 'Paused';
  if (v.phase === 'outbound') return `Sailing to nearby waters · ${r.travel_seconds - v.timer}s`;
  if (v.phase === 'searching') return `Searching · ${r.hold * r.salvage_period - v.timer}s until full`;
  if (v.phase === 'returning') return `Returning to First Haven · ${r.travel_seconds - v.timer}s`;
  if (v.cargo > 0) return 'Waiting for reserve space to unload';
  if (!v.enabled) return 'Automatic expeditions disabled';
  if (s.rules.capacity - s.reserve < r.hold) return `Waiting for ${r.hold} free Salvage storage`;
  if (world.economy.fuel < r.trip_fuel + r.fuel_reserve) return `Waiting for ${r.trip_fuel + r.fuel_reserve} fuel`;
  return 'Ready to depart';
}

export function SalvageVesselPanel({ world, connected, commands }: { world: WorldState; connected: boolean; commands: WorldCommands }) {
  const s = world.salvage;
  if (!s) return null;
  const v = s.vessel, r = s.rules.vessel;
  return <section aria-label="Salvage vessel">
    <h3>Salvage vessel</h3>
    <p>Search nearby waters for {r.hold} Salvage per expedition. Each trip costs {r.trip_fuel} fuel and takes {2 * r.travel_seconds + r.hold * r.salvage_period}s.</p>
    <p className="hint">Loads fuel before departure and keeps {r.fuel_reserve} fuel at Haven. Operates through blackouts without revealing islands.</p>
    {!v ? <>
      <button disabled={!connected || world.economy.fuel < r.build_fuel || !s.vessel_route} onClick={commands.buildSalvageVessel}>Build salvage vessel — {r.build_fuel} fuel</button>
      <p>{!connected ? 'Reconnect to build.' : !s.vessel_route ? 'No nearby water route available.' : world.economy.fuel < r.build_fuel ? 'Not enough fuel to build.' : 'Includes automatic expeditions. No Salvage required.'}</p>
    </> : <>
      <p role="status">Cargo: {v.cargo}/{r.hold} · {vesselStatus(world)}</p>
      <button disabled={!connected} aria-pressed={v.enabled} onClick={() => commands.setSalvageVesselEnabled(!v.enabled)}>{v.enabled ? 'Stop automatic expeditions' : 'Enable automatic expeditions'}</button>
      <p className="hint">Stopping finishes the current trip. Departures require room for a full hold; recovered cargo waits aboard if storage fills.</p>
    </>}
  </section>;
}
