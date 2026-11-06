import type { WorldState } from '../protocol';
import type { WorldCommands } from '../network/commands';
import { isDiscovered } from '../rendering/visibility';
import { isNetworkIlluminated } from '../state/worldQueries';
import { useWorldStore } from '../state/worldStore';

export function ExpeditionPanel({ world, connected, commands }: { world: WorldState; connected: boolean; commands: WorldCommands }) {
  const selected = useWorldStore(state => state.boatSelected);
  const boat = world.expedition;
  const busy = !!boat.pending_choice || !!boat.securing;
  const canMove = connected && !busy && isNetworkIlluminated(world, boat.position);
  const pending = world.lighthouses.find(light => light.id === boat.pending_choice);
  return <section aria-label="Expedition boat" className="expedition-panel">
    <h3>Expedition boat</h3>
    <button aria-pressed={selected} onClick={() => useWorldStore.setState({ boatSelected: !selected })}>{selected ? 'Boat selected' : 'Select boat'}</button>
    <p role="status">{pending ? `Arrived at ${pending.name}. Choose what to do.` : boat.securing ? `Securing lighthouse: ${boat.secure_remaining}s remaining.` : boat.blocked ? 'Route interrupted. Waiting for connected light.' : boat.destination ? 'Sailing to destination.' : 'Waiting for orders.'}</p>
    {pending && <div className="expedition-choice">
      <button disabled={!connected} onClick={() => commands.chooseExpedition(pending.id, 'explore')}>Explore — collect up to 20 {world.salvage ? 'Salvage' : 'fuel'}</button>
      <button disabled={!connected} onClick={() => commands.chooseExpedition(pending.id, 'secure')}>Secure — 30s, then −0.25 fuel/s upkeep</button>
      <p>Either choice unlocks this lighthouse for lighting.</p>
    </div>}
    <p className="hint">Select the boat, then right-click lit water to move. Right-click a lighthouse and choose Send expedition here. On touch, tap a destination. A new order replaces the current route.</p>
    <div aria-label="Expedition destinations"><strong>Send to lighthouse</strong>
      {world.lighthouses.filter(light => isDiscovered(world, light.position)).map(light => <button key={light.id}
        disabled={!canMove || !isNetworkIlluminated(world, light.position)}
        onClick={() => commands.orderExpedition(light.position, light.id)}>{light.name}{light.visited ? ' · Visited' : ' · Unvisited'}</button>)}
    </div>
  </section>;
}
