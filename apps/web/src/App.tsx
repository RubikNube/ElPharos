import { isDiscovered } from './rendering/visibility';
import { ResearchPanel } from './components/ResearchPanel';
import { ResourceBar } from './components/ResourceBar';
import { ObjectivePanel } from './components/ObjectivePanel';
import { LighthousePanel } from './components/LighthousePanel';
import { SaveControls } from './components/SaveControls';
import { WorldMap } from './components/WorldMap';
import { useWorldClient } from './network/useWorldClient';
import { useWorldStore } from './state/worldStore';

export function App() {
  const { world, connection, error, selectedId, pending, notice, victoryNotice } = useWorldStore();
  const commands = useWorldClient();

  return <main className="app">
    <header><div className="brand"><span className="brand-mark">◈</span><div><h1>EL PHAROS</h1><p>A light across the dark</p></div></div>
      {world && <ResourceBar world={world} />}
      {world && <div className="simulation-controls">
        <p role="status">{world.economy.paused ? 'Simulation paused' : 'Simulation running'} · {world.economy.elapsed_seconds}s</p>
        <button className="pause" disabled={connection !== 'connected'} onClick={() => commands.setPaused(!world.economy.paused)}>{world.economy.paused ? 'Resume' : 'Pause'}</button>
      </div>}
      <span className={`connection ${connection}`} role="status">{connection === 'connected' ? 'World connected' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</span>
    </header>
    {world && victoryNotice && <section className="victory-notice" aria-label="Victory notification">
      <div role="status"><strong>Archipelago restored — you won!</strong><p>All win conditions are met. You can keep exploring and managing your lights.</p></div>
      <button onClick={() => useWorldStore.setState({ victoryNotice: false })}>Continue playing</button>
    </section>}
    <div className="workspace"><WorldMap /><aside>
      {world?.economy.blackout && <p role="status" className="error">Fuel shortage extinguished every beacon. First Haven still produces 2 fuel/s; relight the network when fuel is available.</p>}
      {world && <ObjectivePanel world={world} />}
      {world?.research && <ResearchPanel world={world} connected={connection === 'connected'} onResearch={commands.research} />}
      {world && <LighthousePanel world={world} selectedId={selectedId} connection={connection} commands={commands} onSelect={id => useWorldStore.setState({ selectedId: id })} />}
      {!world && <p className="hint">Waiting for the world server…</p>}
      <SaveControls connection={connection} pending={pending} notice={notice} error={error} commands={commands} />
      <div className="field-notes"><p className="eyebrow">CHART CONTROLS</p><p>Drag to explore<br />Scroll to zoom<br />Reset view to return home</p><small>Keyboard: arrow keys, + / −, and 0</small></div>
    </aside></div>
    <footer><span>FIRST LIGHT <span className="footer-divider">/</span> PROTOTYPE 0.1</span><span>{world ? `${world.islands.filter(island => isDiscovered(world, island.position)).length} islands · ${world.lighthouses.filter(light => isDiscovered(world, light.position)).length} beacons` : 'Establishing connection'}</span></footer>
  </main>;
}
