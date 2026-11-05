import type { WorldState } from '../protocol';
import type { WorldStore } from '../state/worldStore';
import type { WorldCommands } from '../network/commands';
import { cargoStatus } from '../shipping';
import { isDiscovered } from '../rendering/visibility';
import { lighthouseSelection, facilityBlockedReason, isNetworkIlluminated, networkUpkeep } from '../state/worldQueries';

type Props = { world: WorldState; selectedId: string | null; connection: WorldStore['connection']; commands: WorldCommands; onSelect: (id: string) => void };

export function LighthousePanel({ world, selectedId, connection, commands, onSelect }: Props) {
  const { lighthouse, island, yard, ship } = lighthouseSelection(world, selectedId);
  const facilityBlock = facilityBlockedReason(world, island, connection === 'connected');
  const cannotLight = !!lighthouse && !lighthouse.active && world.economy.fuel < networkUpkeep(world) + lighthouse.fuel_upkeep;
  return <>
      <p className="eyebrow">LIGHTHOUSE NETWORK</p>
      <h2>{lighthouse?.name ?? 'Select a lighthouse'}</h2>
      <nav aria-label="Lighthouses">{world.lighthouses.filter(light => isDiscovered(world, light.position)).map(light => <button key={light.id} aria-pressed={selectedId === light.id} onClick={() => onSelect(light.id)}>{light.name}</button>)}</nav>
      <p className="intro">Bring light to a quiet corner of the ocean.</p>
      {lighthouse && <>
        <p className="hint">{lighthouse.connected ? 'Connected to First Haven' : 'Isolated from First Haven'}</p>
        <p className="hint">Beacon upkeep: {lighthouse.fuel_upkeep} fuel/s{!lighthouse.active && ' when lit'}.</p>
        {cannotLight && <p role="status">Not enough fuel for one second of network upkeep.</p>}
        <div className="beacon-status"><span className={lighthouse.active ? 'lit' : ''}>◉</span><strong>{lighthouse.active ? 'Beacon illuminated' : 'Beacon extinguished'}</strong></div>
        <dl><div><dt>Island</dt><dd>{world.islands.find((island) => island.id === lighthouse.island_id && isDiscovered(world, island.position))?.name ?? 'Uncharted island'}</dd></div>
          <div><dt>Light radius</dt><dd>{lighthouse.radius} units</dd></div></dl>
        <button className="primary" disabled={connection !== 'connected' || cannotLight} onClick={() => commands.setLighthouseActive(lighthouse.id, !lighthouse.active)}>{lighthouse.active ? 'Extinguish beacon' : 'Light the beacon'}</button>
        <button className="expand" disabled={connection !== 'connected' || lighthouse.radius >= world.radius_max || (!!world.salvage && world.salvage.reserve < world.salvage.rules.expand_cost)} onClick={() => commands.expandLighthouse(lighthouse.id)}>Expand radius (+{world.radius_step}){world.salvage && ` — ${world.salvage.rules.expand_cost} Salvage`}</button>
        {lighthouse.next_fuel_upkeep !== null && <p className="upgrade-preview">After expansion: {lighthouse.next_fuel_upkeep} fuel/s when lit.</p>}
        <p className="hint">Maximum radius: {world.radius_max} units. {world.salvage ? `Each expansion costs ${world.salvage.rules.expand_cost} Salvage.` : 'No upfront cost.'} Larger active beacons consume more fuel.</p>
        {world.salvage && <section aria-label="Lighthouse specialization">
          <h3>Specialization</h3>
          <p>{lighthouse.specialization === 'efficient_lamp' ? 'Efficient lamp' : lighthouse.specialization === 'navigation_beacon' ? 'Navigation beacon' : 'Empty slot'} · One role per lighthouse</p>
          <p>Efficient lamp saves {world.salvage.rules.efficiency_saving} fuel/s. Navigation beacon makes cargo ships {Math.round((world.salvage.rules.navigation_multiplier - 1) * 100)}% faster on adjoining safe links; bonuses do not stack.</p>
          {(['efficient_lamp', 'navigation_beacon'] as const).map(role => {
            const cost = lighthouse.specialization ? world.salvage!.rules.refit_cost : world.salvage!.rules.specialization_cost;
            const illuminated = isNetworkIlluminated(world, lighthouse.position);
            return <button key={role} disabled={connection !== 'connected' || lighthouse.specialization === role || !illuminated || world.salvage!.reserve < cost} onClick={() => commands.specialize(lighthouse.id, role)}>
              {lighthouse.specialization === role ? 'Installed: ' : lighthouse.specialization ? 'Refit: ' : 'Install: '}{role === 'efficient_lamp' ? 'Efficient lamp' : 'Navigation beacon'}{lighthouse.specialization !== role && ` — ${cost} Salvage`}
            </button>;
          })}
          <p className="hint">Fitting requires connected illumination and enough Salvage. Refitting replaces the current role.</p>
        </section>}
        {world.research?.catalog.some(t => t.island_id === island?.id && t.discovered) && <section aria-label="Island archive"><h3>Ancient archive</h3><p>Archive discovered. Its technologies are available in Research; knowledge survives darkness.</p></section>}
        {yard && <section aria-label="Salvage yard"><h3>Salvage yard</h3><p>{yard.restored ? `Stock: ${yard.stock}/${world.salvage!.rules.local_capacity} · Produces 1 Salvage every ${yard.period}s while connected.` : `Ruined · Produces 1 Salvage every ${yard.period}s when restored and connected.`}</p>
          {!yard.restored && <><button disabled={connection !== 'connected' || !!facilityBlock || !world.salvage || world.salvage.reserve < world.salvage.rules.restore_cost} onClick={() => commands.restoreSalvageYard(yard.island_id)}>Restore salvage yard — {world.salvage!.rules.restore_fuel} fuel + {world.salvage!.rules.restore_cost} Salvage</button><p>{facilityBlock ?? (world.salvage!.reserve < world.salvage!.rules.restore_cost ? 'Not enough Salvage.' : 'Includes an automatic cargo ship.')}</p></>}
          {ship && <p role="status">Cargo: {ship.cargo}/{world.salvage!.rules.hold} · {cargoStatus(world, ship)}</p>}
        </section>}
        {island && island.fuel_facility !== 'none' && <section className="fuel-facility" aria-label="Island fuel facility">
          <h3>Fuel facility</h3>
          <p>{island.fuel_facility === 'ruined' ? 'Ruined · No production' : island.fuel_facility === 'restored' && !lighthouse.connected ? 'Isolated · +0 fuel/s' : `Operational · +${island.fuel_production} fuel/s`}</p>
          {island.fuel_facility === 'ruined' ? <>
            <p>Restore for +{world.economy.restored_facility_production} fuel/s while this beacon is active and connected to First Haven.</p>
            <button disabled={!!facilityBlock} onClick={() => commands.restoreFuelFacility(island.id)}>Restore fuel facility — {world.economy.facility_restore_cost} fuel</button>
            {facilityBlock && <p role="status">{facilityBlock}</p>}
          </> : <p>{island.fuel_facility === 'haven' ? 'First Haven produces even during blackouts.' : lighthouse.connected ? 'Shipping carries fuel through connected light.' : 'Relight this beacon and reconnect overlapping light circles to First Haven to resume production.'}</p>}
        </section>}
        <p className="hint">The mint circle previews your next expansion; mint island rings show discovered islands it would newly reach.</p>
      </>}
  </>;
}
