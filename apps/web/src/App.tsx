import { isDiscovered, isIlluminated } from './rendering/visibility';
import { useEffect, useRef } from 'react';
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
  const lighthouse = world?.lighthouses.find(light => light.id === selectedId);

  const island = world?.islands.find(island => island.id === lighthouse?.island_id && isDiscovered(world!, island.position));
  const facilityBlock = connection !== 'connected' ? 'Reconnect to restore this facility.' :
    world && island && !isIlluminated(world, island.position) ? 'Illuminate this island to restore its facility.' :
    world && world.economy.fuel < world.economy.facility_restore_cost ? 'Not enough fuel to restore facility.' : null;

  const upkeep = world ? world.lighthouses.filter(light => light.active).reduce((sum, light) => sum + light.fuel_upkeep, 0) : 0;
  const cannotLight = !!world && !!lighthouse && !lighthouse.active && world.economy.fuel < upkeep + lighthouse.fuel_upkeep;

  return <main className="app">
    <header><div className="brand"><span className="brand-mark">◈</span><div><h1>EL PHAROS</h1><p>A light across the dark</p></div></div>
      <span className={`connection ${connection}`} role="status">{connection === 'connected' ? 'World connected' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
    </header>
    <div className="workspace"><WorldMap /><aside>
      {world && <section className="economy" aria-label="Fuel economy">
        <h3>Fuel: {world.economy.fuel} / {world.economy.capacity}</h3>
        <p>Production: +{world.economy.production}/s · Upkeep: −{upkeep}/s · Net: {world.economy.production - upkeep}/s</p>
        <p role="status">{world.economy.paused ? 'Simulation paused' : 'Simulation running'} · {world.economy.elapsed_seconds}s</p>
        <button className="pause" disabled={connection !== 'connected'} onClick={() => client.current?.send({ type: 'set_simulation_paused', protocol_version: 5, paused: !world.economy.paused })}>{world.economy.paused ? 'Resume' : 'Pause'}</button>
        {world.economy.blackout && <p role="status">Fuel shortage extinguished every beacon. Production continues; relight a beacon when fuel is available.</p>}
      </section>}
      <p className="eyebrow">LIGHTHOUSE NETWORK</p>
      <h2>{lighthouse?.name ?? 'Select a lighthouse'}</h2>
      <nav aria-label="Lighthouses">{world?.lighthouses.filter(light => isDiscovered(world, light.position)).map(light => <button key={light.id} aria-pressed={selectedId === light.id} onClick={() => useWorldStore.setState({ selectedId: light.id })}>{light.name}</button>)}</nav>
      <p className="intro">Bring light to a quiet corner of the ocean.</p>
      {lighthouse && <>
        <p className="hint">Beacon upkeep: {lighthouse.fuel_upkeep} fuel/s{!lighthouse.active && ' when lit'}.</p>
        {cannotLight && <p role="status">Not enough fuel for one second of network upkeep.</p>}
        <div className="beacon-status"><span className={lighthouse.active ? 'lit' : ''}>◉</span><strong>{lighthouse.active ? 'Beacon illuminated' : 'Beacon extinguished'}</strong></div>
        <dl><div><dt>Island</dt><dd>{world?.islands.find((island) => island.id === lighthouse.island_id && isDiscovered(world, island.position))?.name ?? 'Uncharted island'}</dd></div>
          <div><dt>Light radius</dt><dd>{lighthouse.radius} units</dd></div></dl>
        <button className="primary" disabled={connection !== 'connected' || cannotLight} onClick={() => client.current?.send({
          type: 'set_lighthouse_active', protocol_version: 5, lighthouse_id: lighthouse.id, active: !lighthouse.active,
        })}>{lighthouse.active ? 'Extinguish beacon' : 'Light the beacon'}</button>
        <button className="expand" disabled={connection !== 'connected' || lighthouse.radius >= world!.radius_max} onClick={() => client.current?.send({ type: 'expand_lighthouse_radius', protocol_version: 5, lighthouse_id: lighthouse.id })}>Expand radius (+{world!.radius_step})</button>
        {lighthouse.next_fuel_upkeep !== null && <p className="upgrade-preview">After expansion: {lighthouse.next_fuel_upkeep} fuel/s when lit.</p>}
        <p className="hint">Maximum radius: {world!.radius_max} units. No upfront cost; larger active beacons consume more fuel.</p>
        {island && <section className="fuel-facility" aria-label="Island fuel facility">
          <h3>Fuel facility</h3>
          <p>{island.fuel_facility === 'ruined' ? 'Ruined · No production' : `Operational · +${island.fuel_production} fuel/s`}</p>
          {island.fuel_facility === 'ruined' ? <>
            <p>Restore for +3 fuel/s. Production continues in darkness.</p>
            <button disabled={!!facilityBlock} onClick={() => client.current?.send({ type: 'restore_fuel_facility', protocol_version: 5, island_id: island.id })}>Restore fuel facility — {world!.economy.facility_restore_cost} fuel</button>
            {facilityBlock && <p role="status">{facilityBlock}</p>}
          </> : <p>Production continues in darkness.</p>}
        </section>}
        <p className="hint">Watch the circle of light change across the ocean.</p>
      </>}
      {!world && <p className="hint">Waiting for the world server…</p>}
      <div className="save-controls">
        <button disabled={connection !== 'connected' || !!pending} onClick={() => client.current?.send({ type: 'save_game', protocol_version: 5, request_id: crypto.randomUUID() })}>Save</button>
        <button disabled={connection !== 'connected' || !!pending} onClick={() => client.current?.send({ type: 'load_game', protocol_version: 5, request_id: crypto.randomUUID() })}>Load</button>
      </div>
      <p className="hint">One server save slot. Load replaces the shared world in every connected tab.</p>
      <p role="status">{pending ? (pending.action === 'save_game' ? 'Saving…' : 'Loading…') : notice}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="field-notes"><p className="eyebrow">CHART CONTROLS</p><p>Drag to explore<br />Scroll to zoom<br />Reset view to return home</p><small>Keyboard: arrow keys, + / −, and 0</small></div>
    </aside></div>
    <footer><span>FIRST LIGHT <span className="footer-divider">/</span> PROTOTYPE 0.1</span><span>{world ? `${world.islands.filter(island => isDiscovered(world, island.position)).length} islands · ${world.lighthouses.filter(light => isDiscovered(world, light.position)).length} beacons` : 'Establishing connection'}</span></footer>
  </main>;
}
