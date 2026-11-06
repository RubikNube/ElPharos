import type { WorldState } from '../protocol';

export function ObjectivePanel({ world }: { world: WorldState }) {
  const archiveCount = new Set(world.research?.catalog.filter(t => t.discovered).map(t => t.island_id)).size;
  return <section className="objective" aria-label="Scenario objective">
        <h3>{world.objective_complete ? 'Archipelago restored' : 'Reconnect the archipelago'}</h3>
        <p>Restore all remote facilities and connect every beacon to First Haven with nonnegative net fuel.{world.salvage && ' Restore all salvage yards and receive a delivery from each.'}</p>
        <p role="status">{world.islands.filter(island => island.fuel_facility === 'restored').length}/{world.islands.filter(i => i.fuel_facility === 'ruined' || i.fuel_facility === 'restored').length} fuel facilities restored · {world.lighthouses.filter(light => light.connected).length}/{world.lighthouses.length} beacons connected</p>
        {world.salvage && <p>{world.salvage.yards.filter(y => y.delivered).length}/{world.salvage.yards.length} yards have delivered cargo.</p>}
        {world.research && <p>{archiveCount}/3 archives discovered · {world.research.completed.length}/6 technologies researched (optional)</p>}
        {world.objective_complete && <p>The shipping network is sustainable. Keep exploring and managing your lights.</p>}
        {world.veil && <section aria-label="Veil objective"><h3>{world.veil.complete ? 'Veil defended' : 'Defend against the Veil'}</h3>
          <p>{world.veil.defended}/3 fronts defended. {world.veil.complete ? 'The Veil objective is complete; fronts continue.' : 'Ward the targeted beacon before a front strikes.'}</p>
          <p role="status">{world.veil.target ? `Front arrives in ${world.veil.approach_remaining}s at ${world.lighthouses.find(l => l.id === world.veil?.target)?.name ?? 'a beacon'}.` : world.veil.cooldown_remaining > 0 ? `Next front in ${world.veil.cooldown_remaining}s.` : 'The Veil waits for a connected remote beacon.'}</p>
        </section>}
      </section>;
}
