import type { TechnologyId, WorldState } from '../protocol';

type Props = {
  world: WorldState;
  connected: boolean;
  onResearch: (id: TechnologyId) => void;
};

export function ResearchPanel({ world, connected, onResearch }: Props) {
  const research = world.research;
  if (!research) return null;
  const archives = [...new Set(research.catalog.map(t => t.island_id))];
  return <section className="research" aria-label="Research">
    <details>
      <summary>Research · {research.completed.length}/{research.catalog.length}</summary>
      <p className="hint">Explore ancient archives to reveal technologies. Spend shared Salvage for permanent upgrades. Research is optional and works while paused or in darkness.</p>
      {archives.map(islandId => {
        const technologies = research.catalog.filter(t => t.island_id === islandId);
        const discovered = technologies.some(t => t.discovered);
        const island = world.islands.find(i => i.id === islandId);
        return <section className="archive" key={islandId}>
          <h3>{discovered ? `${island?.name ?? 'Discovered island'} archive` : 'Uncharted archive'}</h3>
          {!discovered && <p className="hint">Explore further to recover this archive.</p>}
          {discovered && technologies.map(tech => {
            const completed = research.completed.includes(tech.id);
            const reason = completed ? 'Researched' : !connected ? 'Reconnect to research.' : tech.blocked_reason;
            const prerequisite = research.catalog.find(t => t.id === tech.prerequisite);
            return <article className="technology" key={tech.id} data-technology={tech.id}>
              <h4>{tech.name}</h4>
              <p>{tech.effect}</p>
              {prerequisite && <p>Requires: {prerequisite.name}</p>}
              <button disabled={!connected || !tech.available || completed} onClick={() => onResearch(tech.id)} aria-describedby={`${tech.id}-status`}>
                {completed ? `Researched: ${tech.name}` : `Research ${tech.name} — ${tech.cost} Salvage`}
              </button>
              <p id={`${tech.id}-status`} role="status">{reason ?? 'Available'}</p>
            </article>;
          })}
        </section>;
      })}
    </details>
  </section>;
}
