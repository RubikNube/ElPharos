import type { WorldState } from '../protocol';

export function ObjectivePanel({ world }: { world: WorldState }) {
  const archiveCount = new Set(world.research?.catalog.filter(t => t.discovered).map(t => t.island_id)).size;
  return <section className="objective" aria-label="Scenario objective">
        <h3>{world.objective_complete ? 'Archipelago restored' : 'Reconnect the archipelago'}</h3>
        <p>Restore all remote facilities and connect every beacon to First Haven with nonnegative net fuel.{world.salvage && ' Restore both salvage yards and receive a delivery from each.'}</p>
        <p role="status">{world.islands.filter(island => island.fuel_facility === 'restored').length}/{world.islands.filter(i => i.fuel_facility === 'ruined' || i.fuel_facility === 'restored').length} fuel facilities restored · {world.lighthouses.filter(light => light.connected).length}/{world.lighthouses.length} beacons connected</p>
        {world.salvage && <p>{world.salvage.yards.filter(y => y.delivered).length}/2 yards have delivered cargo.</p>}
        {world.research && <p>{archiveCount}/3 archives discovered · {world.research.completed.length}/6 technologies researched (optional)</p>}
        {world.objective_complete && <p>The shipping network is sustainable. Keep exploring and managing your lights.</p>}
      </section>;
}
