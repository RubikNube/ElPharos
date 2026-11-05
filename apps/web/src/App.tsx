import { cargoStatus } from './shipping';
import { isDiscovered } from './rendering/visibility';
import { useEffect, useRef } from 'react';
import { ResearchPanel } from './components/ResearchPanel';
import { WorldMap } from './components/WorldMap';
import { connectWorld } from './network/connection';
import { useWorldStore } from './state/worldStore';

export function App() {
  const { world, connection, error, selectedId, pending, notice } = useWorldStore();
  const client = useRef<ReturnType<typeof connectWorld> | null>(null);
  useEffect(() => {
    client.current = connectWorld();
    return () => { client.current?.dispose(); client.current = null; };
  }, []);
  const archiveCount = new Set(world?.research?.catalog.filter(t => t.discovered).map(t => t.island_id)).size;
  const lighthouse = world?.lighthouses.find(light => light.id === selectedId);

  const island = world?.islands.find(island => island.id === lighthouse?.island_id && isDiscovered(world!, island.position));
  const facilityBlock = connection !== 'connected' ? 'Reconnect to restore this facility.' :
    world && island && !world.lighthouses.some(light => light.connected && Math.hypot(light.position.x - island.position.x, light.position.y - island.position.y) <= light.radius) ? 'Connect light from First Haven to this island to restore its facility.' :
    world && world.economy.fuel < world.economy.facility_restore_cost ? 'Not enough fuel to restore facility.' : null;

  const upkeep = world ? world.lighthouses.filter(light => light.active).reduce((sum, light) => sum + light.fuel_upkeep, 0) : 0;
  const yard = world?.salvage?.yards.find(y => y.island_id === island?.id);
  const ship = world?.salvage?.ships.find(s => s.yard_id === island?.id);
  const cannotLight = !!world && !!lighthouse && !lighthouse.active && world.economy.fuel < upkeep + lighthouse.fuel_upkeep;

  return <main className="app">
    <header><div className="brand"><span className="brand-mark">◈</span><div><h1>EL PHAROS</h1><p>A light across the dark</p></div></div>
      {world && <div className="resource-bar" role="group" aria-label="Resources">
        <section className="resource fuel" aria-label="Fuel economy" title={`Production: +${world.economy.production}/s · Upkeep: −${upkeep}/s`}>
          <svg className="resource-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C10 5 5 10 5 15a7 7 0 0 0 14 0c0-5-5-10-7-13Zm-3 13a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5Z" /></svg>
          <div><h3>Fuel: <strong>{world.economy.fuel}</strong> <span>/ {world.economy.capacity}</span></h3>
            <p className={world.economy.production - upkeep < 0 ? 'resource-deficit' : 'resource-income'}>Net: {world.economy.production - upkeep >= 0 ? '+' : ''}{world.economy.production - upkeep}/s <span>· +{world.economy.production} / −{upkeep}</span></p></div>
        </section>
        {world.salvage && <section className="resource salvage" aria-label="Salvage economy" title={`Haven salvage operation: +1 every ${world.salvage.rules.haven_period}s. Cargo ships deliver from restored yards.`}>
          <svg className="resource-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 8 5v8l-8 5-8-5V8Z" /><path d="m4 8 8 5 8-5M12 13v8M8 5.5l8 5" /></svg>
          <div><h3>Salvage: <strong>{world.salvage.reserve}</strong> <span>/ {world.salvage.rules.capacity}</span></h3><p>+1 / {world.salvage.rules.haven_period}s <span>· cargo deliveries</span></p></div>
        </section>}
      </div>}
      {world && <div className="simulation-controls">
        <p role="status">{world.economy.paused ? 'Simulation paused' : 'Simulation running'} · {world.economy.elapsed_seconds}s</p>
        <button className="pause" disabled={connection !== 'connected'} onClick={() => client.current?.send({ type: 'set_simulation_paused', protocol_version: 9, paused: !world.economy.paused })}>{world.economy.paused ? 'Resume' : 'Pause'}</button>
      </div>}
      <span className={`connection ${connection}`} role="status">{connection === 'connected' ? 'World connected' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
    </header>
    <div className="workspace"><WorldMap /><aside>
      {world?.economy.blackout && <p role="status" className="error">Fuel shortage extinguished every beacon. First Haven still produces 2 fuel/s; relight the network when fuel is available.</p>}
      {world && <section className="objective" aria-label="Scenario objective">
        <h3>{world.objective_complete ? 'Archipelago restored' : 'Reconnect the archipelago'}</h3>
        <p>Restore all remote facilities and connect every beacon to First Haven with nonnegative net fuel.{world.salvage && ' Restore both salvage yards and receive a delivery from each.'}</p>
        <p role="status">{world.islands.filter(island => island.fuel_facility === 'restored').length}/{world.islands.filter(i => i.fuel_facility === 'ruined' || i.fuel_facility === 'restored').length} fuel facilities restored · {world.lighthouses.filter(light => light.connected).length}/{world.lighthouses.length} beacons connected</p>
        {world.salvage && <p>{world.salvage.yards.filter(y => y.delivered).length}/2 yards have delivered cargo.</p>}
        {world.research && <p>{archiveCount}/3 archives discovered · {world.research.completed.length}/6 technologies researched (optional)</p>}
        {world.objective_complete && <p>The shipping network is sustainable. Keep exploring and managing your lights.</p>}
      </section>}
      {world?.research && <ResearchPanel world={world} connected={connection === 'connected'} onResearch={technology_id => client.current?.send({ type: 'research_technology', protocol_version: 9, technology_id })} />}
      <p className="eyebrow">LIGHTHOUSE NETWORK</p>
      <h2>{lighthouse?.name ?? 'Select a lighthouse'}</h2>
      <nav aria-label="Lighthouses">{world?.lighthouses.filter(light => isDiscovered(world, light.position)).map(light => <button key={light.id} aria-pressed={selectedId === light.id} onClick={() => useWorldStore.setState({ selectedId: light.id })}>{light.name}</button>)}</nav>
      <p className="intro">Bring light to a quiet corner of the ocean.</p>
      {lighthouse && <>
        <p className="hint">{lighthouse.connected ? 'Connected to First Haven' : 'Isolated from First Haven'}</p>
        <p className="hint">Beacon upkeep: {lighthouse.fuel_upkeep} fuel/s{!lighthouse.active && ' when lit'}.</p>
        {cannotLight && <p role="status">Not enough fuel for one second of network upkeep.</p>}
        <div className="beacon-status"><span className={lighthouse.active ? 'lit' : ''}>◉</span><strong>{lighthouse.active ? 'Beacon illuminated' : 'Beacon extinguished'}</strong></div>
        <dl><div><dt>Island</dt><dd>{world?.islands.find((island) => island.id === lighthouse.island_id && isDiscovered(world, island.position))?.name ?? 'Uncharted island'}</dd></div>
          <div><dt>Light radius</dt><dd>{lighthouse.radius} units</dd></div></dl>
        <button className="primary" disabled={connection !== 'connected' || cannotLight} onClick={() => client.current?.send({
          type: 'set_lighthouse_active', protocol_version: 9, lighthouse_id: lighthouse.id, active: !lighthouse.active,
        })}>{lighthouse.active ? 'Extinguish beacon' : 'Light the beacon'}</button>
        <button className="expand" disabled={connection !== 'connected' || lighthouse.radius >= world!.radius_max || (!!world?.salvage && world.salvage.reserve < world.salvage.rules.expand_cost)} onClick={() => client.current?.send({ type: 'expand_lighthouse_radius', protocol_version: 9, lighthouse_id: lighthouse.id })}>Expand radius (+{world!.radius_step}){world?.salvage && ` — ${world.salvage.rules.expand_cost} Salvage`}</button>
        {lighthouse.next_fuel_upkeep !== null && <p className="upgrade-preview">After expansion: {lighthouse.next_fuel_upkeep} fuel/s when lit.</p>}
        <p className="hint">Maximum radius: {world!.radius_max} units. {world?.salvage ? `Each expansion costs ${world.salvage.rules.expand_cost} Salvage.` : 'No upfront cost.'} Larger active beacons consume more fuel.</p>
        {world?.salvage && <section aria-label="Lighthouse specialization">
          <h3>Specialization</h3>
          <p>{lighthouse.specialization === 'efficient_lamp' ? 'Efficient lamp' : lighthouse.specialization === 'navigation_beacon' ? 'Navigation beacon' : 'Empty slot'} · One role per lighthouse</p>
          <p>Efficient lamp saves {world.salvage.rules.efficiency_saving} fuel/s. Navigation beacon makes cargo ships {Math.round((world.salvage.rules.navigation_multiplier - 1) * 100)}% faster on adjoining safe links; bonuses do not stack.</p>
          {(['efficient_lamp', 'navigation_beacon'] as const).map(role => {
            const cost = lighthouse.specialization ? world.salvage!.rules.refit_cost : world.salvage!.rules.specialization_cost;
            const illuminated = world.lighthouses.some(l => l.connected && Math.hypot(l.position.x-lighthouse.position.x, l.position.y-lighthouse.position.y) <= l.radius);
            return <button key={role} disabled={connection !== 'connected' || lighthouse.specialization === role || !illuminated || world.salvage!.reserve < cost} onClick={() => client.current?.send({ type: 'set_lighthouse_specialization', protocol_version: 9, lighthouse_id: lighthouse.id, specialization: role })}>
              {lighthouse.specialization === role ? 'Installed: ' : lighthouse.specialization ? 'Refit: ' : 'Install: '}{role === 'efficient_lamp' ? 'Efficient lamp' : 'Navigation beacon'}{lighthouse.specialization !== role && ` — ${cost} Salvage`}
            </button>;
          })}
          <p className="hint">Fitting requires connected illumination and enough Salvage. Refitting replaces the current role.</p>
        </section>}
        {world?.research?.catalog.some(t => t.island_id === island?.id && t.discovered) && <section aria-label="Island archive"><h3>Ancient archive</h3><p>Archive discovered. Its technologies are available in Research; knowledge survives darkness.</p></section>}
        {yard && <section aria-label="Salvage yard"><h3>Salvage yard</h3><p>{yard.restored ? `Stock: ${yard.stock}/${world!.salvage!.rules.local_capacity} · Produces 1 Salvage every ${yard.period}s while connected.` : `Ruined · Produces 1 Salvage every ${yard.period}s when restored and connected.`}</p>
          {!yard.restored && <><button disabled={connection !== 'connected' || !!facilityBlock || !world?.salvage || world.salvage.reserve < world.salvage.rules.restore_cost} onClick={() => client.current?.send({ type: 'restore_salvage_yard', protocol_version: 9, island_id: yard.island_id })}>Restore salvage yard — {world!.salvage!.rules.restore_fuel} fuel + {world!.salvage!.rules.restore_cost} Salvage</button><p>{facilityBlock ?? (world!.salvage!.reserve < world!.salvage!.rules.restore_cost ? 'Not enough Salvage.' : 'Includes an automatic cargo ship.')}</p></>}
          {ship && <p role="status">Cargo: {ship.cargo}/{world!.salvage!.rules.hold} · {cargoStatus(world!, ship)}</p>}
        </section>}
        {island && island.fuel_facility !== 'none' && <section className="fuel-facility" aria-label="Island fuel facility">
          <h3>Fuel facility</h3>
          <p>{island.fuel_facility === 'ruined' ? 'Ruined · No production' : island.fuel_facility === 'restored' && !lighthouse.connected ? 'Isolated · +0 fuel/s' : `Operational · +${island.fuel_production} fuel/s`}</p>
          {island.fuel_facility === 'ruined' ? <>
            <p>Restore for +{world!.economy.restored_facility_production} fuel/s while this beacon is active and connected to First Haven.</p>
            <button disabled={!!facilityBlock} onClick={() => client.current?.send({ type: 'restore_fuel_facility', protocol_version: 9, island_id: island.id })}>Restore fuel facility — {world!.economy.facility_restore_cost} fuel</button>
            {facilityBlock && <p role="status">{facilityBlock}</p>}
          </> : <p>{island.fuel_facility === 'haven' ? 'First Haven produces even during blackouts.' : lighthouse.connected ? 'Shipping carries fuel through connected light.' : 'Relight this beacon and reconnect overlapping light circles to First Haven to resume production.'}</p>}
        </section>}
        <p className="hint">The mint circle previews your next expansion; mint island rings show discovered islands it would newly reach.</p>
      </>}
      {!world && <p className="hint">Waiting for the world server…</p>}
      <div className="save-controls">
        <button disabled={connection !== 'connected' || !!pending} onClick={() => client.current?.send({ type: 'save_game', protocol_version: 9, request_id: crypto.randomUUID() })}>Save</button>
        <button disabled={connection !== 'connected' || !!pending} onClick={() => client.current?.send({ type: 'load_game', protocol_version: 9, request_id: crypto.randomUUID() })}>Load</button>
      </div>
      <p className="hint">One server save slot. Load replaces the shared world in every connected tab.</p>
      <p role="status">{pending ? (pending.action === 'save_game' ? 'Saving…' : 'Loading…') : notice}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="field-notes"><p className="eyebrow">CHART CONTROLS</p><p>Drag to explore<br />Scroll to zoom<br />Reset view to return home</p><small>Keyboard: arrow keys, + / −, and 0</small></div>
    </aside></div>
    <footer><span>FIRST LIGHT <span className="footer-divider">/</span> PROTOTYPE 0.1</span><span>{world ? `${world.islands.filter(island => isDiscovered(world, island.position)).length} islands · ${world.lighthouses.filter(light => isDiscovered(world, light.position)).length} beacons` : 'Establishing connection'}</span></footer>
  </main>;
}
