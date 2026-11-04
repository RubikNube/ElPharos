import { isDiscovered } from './rendering/visibility';
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

  return <main className="app">
    <header><div className="brand"><span className="brand-mark">◈</span><div><h1>EL PHAROS</h1><p>A light across the dark</p></div></div>
      <span className={`connection ${connection}`} role="status">{connection === 'connected' ? 'World connected' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
    </header>
    <div className="workspace"><WorldMap /><aside>
      <p className="eyebrow">LIGHTHOUSE NETWORK</p>
      <h2>{lighthouse?.name ?? 'Select a lighthouse'}</h2>
      <nav aria-label="Lighthouses">{world?.lighthouses.filter(light => isDiscovered(world, light.position)).map(light => <button key={light.id} aria-pressed={selectedId === light.id} onClick={() => useWorldStore.setState({ selectedId: light.id })}>{light.name}</button>)}</nav>
      <p className="intro">Bring light to a quiet corner of the ocean.</p>
      {lighthouse && <>
        <div className="beacon-status"><span className={lighthouse.active ? 'lit' : ''}>◉</span><strong>{lighthouse.active ? 'Beacon illuminated' : 'Beacon extinguished'}</strong></div>
        <dl><div><dt>Island</dt><dd>{world?.islands.find((island) => island.id === lighthouse.island_id && isDiscovered(world, island.position))?.name ?? 'Uncharted island'}</dd></div>
          <div><dt>Light radius</dt><dd>{lighthouse.radius} units</dd></div></dl>
        <button className="primary" disabled={connection !== 'connected'} onClick={() => client.current?.send({
          type: 'set_lighthouse_active', protocol_version: 2, lighthouse_id: lighthouse.id, active: !lighthouse.active,
        })}>{lighthouse.active ? 'Extinguish beacon' : 'Light the beacon'}</button>
        <button className="expand" disabled={connection !== 'connected' || lighthouse.radius >= world!.radius_max} onClick={() => client.current?.send({ type: 'expand_lighthouse_radius', protocol_version: 2, lighthouse_id: lighthouse.id })}>Expand radius (+{world!.radius_step})</button>
        <p className="hint">Maximum radius: {world!.radius_max} units. Upgrades are free.</p>
        <p className="hint">Watch the circle of light change across the ocean.</p>
      </>}
      {!world && <p className="hint">Waiting for the world server…</p>}
      <div className="save-controls">
        <button disabled={connection !== 'connected' || !!pending} onClick={() => client.current?.send({ type: 'save_game', protocol_version: 2, request_id: crypto.randomUUID() })}>Save</button>
        <button disabled={connection !== 'connected' || !!pending} onClick={() => client.current?.send({ type: 'load_game', protocol_version: 2, request_id: crypto.randomUUID() })}>Load</button>
      </div>
      <p className="hint">One server save slot. Load replaces the shared world in every connected tab.</p>
      <p role="status">{pending ? (pending.action === 'save_game' ? 'Saving…' : 'Loading…') : notice}</p>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="field-notes"><p className="eyebrow">CHART CONTROLS</p><p>Drag to explore<br />Scroll to zoom<br />Reset view to return home</p><small>Keyboard: arrow keys, + / −, and 0</small></div>
    </aside></div>
    <footer><span>FIRST LIGHT <span className="footer-divider">/</span> PROTOTYPE 0.1</span><span>{world ? `${world.islands.filter(island => isDiscovered(world, island.position)).length} islands · ${world.lighthouses.filter(light => isDiscovered(world, light.position)).length} beacons` : 'Establishing connection'}</span></footer>
  </main>;
}
