import type { WorldState } from '../protocol';
import { networkUpkeep } from '../state/worldQueries';

export function ResourceBar({ world }: { world: WorldState }) {
  const upkeep = networkUpkeep(world);
  return <div className="resource-bar" role="group" aria-label="Resources">
        <section className="resource fuel" aria-label="Fuel economy" title={`Production: +${world.economy.production}/s · Upkeep: −${upkeep}/s`}>
          <svg className="resource-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C10 5 5 10 5 15a7 7 0 0 0 14 0c0-5-5-10-7-13Zm-3 13a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5Z" /></svg>
          <div><h3>Fuel: <strong>{world.economy.fuel}</strong> <span>/ {world.economy.capacity}</span></h3>
            <p className={world.economy.production - upkeep < 0 ? 'resource-deficit' : 'resource-income'}>Net: {world.economy.production - upkeep >= 0 ? '+' : ''}{world.economy.production - upkeep}/s <span>· +{world.economy.production} / −{upkeep}</span></p></div>
        </section>
        {world.salvage && <section className="resource salvage" aria-label="Salvage economy" title={`Haven salvage operation: +1 every ${world.salvage.rules.haven_period}s. Cargo ships deliver from restored yards.`}>
          <svg className="resource-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 8 5v8l-8 5-8-5V8Z" /><path d="m4 8 8 5 8-5M12 13v8M8 5.5l8 5" /></svg>
          <div><h3>Salvage: <strong>{world.salvage.reserve}</strong> <span>/ {world.salvage.rules.capacity}</span></h3><p>+1 / {world.salvage.rules.haven_period}s <span>· cargo deliveries</span></p></div>
        </section>}
      </div>;
}
