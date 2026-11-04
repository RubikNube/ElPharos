import { useEffect, useRef } from 'react';
import { WorldMap } from './components/WorldMap';
import { connectWorld } from './network/connection';
import { useWorldStore } from './state/worldStore';

export function App() {
  const { world, connection, error } = useWorldStore();
  const client = useRef<ReturnType<typeof connectWorld> | null>(null);
  useEffect(() => {
    client.current = connectWorld();
    return () => { client.current?.dispose(); client.current = null; };
  }, []);
  const lighthouse = world?.lighthouses[0];

  return <main className="app">
    <header><div className="brand"><span className="brand-mark">◈</span><div><h1>EL PHAROS</h1><p>A light across the dark</p></div></div>
      <span className={`connection ${connection}`} role="status">{connection === 'connected' ? 'World connected' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
    </header>
    <div className="workspace"><WorldMap /><aside>
      <p className="eyebrow">THE FIRST BEACON</p>
      <h2>{lighthouse?.name ?? 'Awaiting the world'}</h2>
      <p className="intro">Bring light to a quiet corner of the ocean.</p>
      {lighthouse && <>
        <div className="beacon-status"><span className={lighthouse.active ? 'lit' : ''}>◉</span><strong>{lighthouse.active ? 'Beacon illuminated' : 'Beacon extinguished'}</strong></div>
        <dl><div><dt>Island</dt><dd>{world?.islands.find((island) => island.id === lighthouse.island_id)?.name ?? 'Unknown'}</dd></div>
          <div><dt>Light radius</dt><dd>{lighthouse.radius} units</dd></div></dl>
        <button className="primary" disabled={connection !== 'connected'} onClick={() => client.current?.send({
          type: 'set_lighthouse_active', protocol_version: 1, lighthouse_id: lighthouse.id, active: !lighthouse.active,
        })}>{lighthouse.active ? 'Extinguish beacon' : 'Light the beacon'}</button>
        <p className="hint">Watch the circle of light change across the ocean.</p>
      </>}
      {!world && <p className="hint">Waiting for the world server…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="field-notes"><p className="eyebrow">CHART CONTROLS</p><p>Drag to explore<br />Scroll to zoom<br />Reset view to return home</p><small>Keyboard: arrow keys, + / −, and 0</small></div>
    </aside></div>
    <footer><span>FIRST LIGHT <span className="footer-divider">/</span> PROTOTYPE 0.1</span><span>{world ? `${world.islands.length} island · ${world.lighthouses.length} beacon` : 'Establishing connection'}</span></footer>
  </main>;
}
