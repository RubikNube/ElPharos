import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createScene } from '../rendering/scene';
import { useWorldStore } from '../state/worldStore';
import type { LighthouseHover } from '../rendering/lighthouseHover';
import { keeperIdentity } from '../state/keeper';
import { isDiscovered } from '../rendering/visibility';
import { LighthouseStatus } from './LighthouseStatus';
import { ShipStatus } from './ShipStatus';
import { LighthouseContextMenu } from './LighthouseContextMenu';
import type { WorldCommands } from '../network/commands';

function HoverCard({ target }: { target: NonNullable<LighthouseHover> }) {
  const world = useWorldStore(state => state.world);
  const card = useRef<HTMLDivElement>(null);
  const light = target.kind === 'lighthouse' ? world?.lighthouses.find(light => keeperIdentity(light) === target.identity && isDiscovered(world, light.position)) : null;
  useLayoutEffect(() => {
    const element = card.current;
    if (!element) return;
    const position = () => {
      const parent = element.parentElement!;
      const x = Math.max(8, Math.min(target.x + 20, parent.clientWidth - element.offsetWidth - 8));
      const preferredY = target.y + 20 + element.offsetHeight <= parent.clientHeight - 8 ? target.y + 20 : target.y - element.offsetHeight - 20;
      const y = Math.max(8, Math.min(preferredY, parent.clientHeight - element.offsetHeight - 8));
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    return () => observer.disconnect();
  }, [target, light?.id]);
  if (!world || (target.kind === 'lighthouse' && !light)) return null;
  return <div ref={card} className="lighthouse-tooltip" role="tooltip" aria-label={target.kind === 'ship' ? 'Ship status' : 'Lighthouse status'}>
    {target.kind === 'ship' ? <ShipStatus world={world} id={target.id} /> : <LighthouseStatus world={world} light={light!} />}
  </div>;
}

export function WorldMap({ commands }: { commands: WorldCommands }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Awaited<ReturnType<typeof createScene>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<LighthouseHover>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const world = useWorldStore(state => state.world);
  const connection = useWorldStore(state => state.connection);
  useEffect(() => {
    if (menu && !world?.lighthouses.some(light => light.id === menu.id && isDiscovered(world, light.position))) setMenu(null);
  }, [menu, world]);
  useEffect(() => {
    if (!menu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target as Element).closest?.('.lighthouse-context-menu')) setMenu(null);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [menu]);
  useEffect(() => {
    const abort = new AbortController();
    let unsubscribe: (() => void) | undefined;
    void createScene(host.current!, abort.signal, selectedId => useWorldStore.setState({ selectedId }), target => {
      if (!abort.signal.aborted) setHover(target);
    }, target => { setHover(null); setMenu(target); }, () => setMenu(null), () => useWorldStore.getState().selectedId).then((created) => {
      if (abort.signal.aborted) { created?.dispose(); return; }
      scene.current = created;
      if (!created) return;
      const state = useWorldStore.getState();
      created.setWorld(state.world);
      created.setSelection(state.selectedId);
      unsubscribe = useWorldStore.subscribe((state, previous) => {
        if (state.world !== previous.world) created.setWorld(state.world);
        if (state.selectedId !== previous.selectedId) created.setSelection(state.selectedId);
      });
    }).catch(() => {
      if (!abort.signal.aborted) setError('The map could not start. Please use a browser with WebGL enabled.');
    });
    return () => { abort.abort(); unsubscribe?.(); scene.current?.dispose(); scene.current = null; };
  }, []);

  return <section className="map-panel" aria-label="Ocean map">
    <div className="map" ref={host} tabIndex={0} role="region"
      aria-label="World map. Hover over a lighthouse or ship for status, click a lighthouse to select, or right click or long press it for actions. Drag or use arrow keys to pan. Scroll or press plus and minus to zoom. Press zero to reset." />
    {hover && !menu && <HoverCard key={hover.identity} target={hover} />}
    {menu && world && <LighthouseContextMenu key={menu.id} world={world} id={menu.id} x={menu.x} y={menu.y} connected={connection === 'connected'} commands={commands} onClose={() => { setMenu(null); host.current?.focus(); }} />}
    <div className="map-caption"><span>THE OPEN OCEAN</span><small>An archipelago waiting for light.</small></div>
    {error && <p className="map-error" role="alert">{error}</p>}
    <div className="map-controls">
      <button aria-label="Zoom out" onClick={() => scene.current?.zoom(0.8)}>−</button>
      <button onClick={() => scene.current?.reset()}>Reset view</button>
      <button aria-label="Zoom in" onClick={() => scene.current?.zoom(1.25)}>+</button>
    </div>
  </section>;
}
