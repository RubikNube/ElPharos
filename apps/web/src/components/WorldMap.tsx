import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createScene } from '../rendering/scene';
import { useWorldStore } from '../state/worldStore';
import type { LighthouseHover } from '../rendering/lighthouseHover';
import { keeperIdentity } from '../state/keeper';
import { isDiscovered } from '../rendering/visibility';
import { LighthouseStatus } from './LighthouseStatus';

function HoverCard({ target }: { target: NonNullable<LighthouseHover> }) {
  const world = useWorldStore(state => state.world);
  const card = useRef<HTMLDivElement>(null);
  const light = world?.lighthouses.find(light => keeperIdentity(light) === target.identity && isDiscovered(world, light.position));
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
  if (!world || !light) return null;
  return <div ref={card} className="lighthouse-tooltip" role="tooltip" aria-label="Lighthouse status">
    <LighthouseStatus world={world} light={light} />
  </div>;
}

export function WorldMap() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Awaited<ReturnType<typeof createScene>>>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<LighthouseHover>(null);
  useEffect(() => {
    const abort = new AbortController();
    let unsubscribe: (() => void) | undefined;
    void createScene(host.current!, abort.signal, selectedId => useWorldStore.setState({ selectedId }), target => {
      if (!abort.signal.aborted) setHover(target);
    }).then((created) => {
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
      aria-label="World map. Hover over a lighthouse for status or click to select. Drag or use arrow keys to pan. Scroll or press plus and minus to zoom. Press zero to reset." />
    {hover && <HoverCard key={hover.identity} target={hover} />}
    <div className="map-caption"><span>THE OPEN OCEAN</span><small>An archipelago waiting for light.</small></div>
    {error && <p className="map-error" role="alert">{error}</p>}
    <div className="map-controls">
      <button aria-label="Zoom out" onClick={() => scene.current?.zoom(0.8)}>−</button>
      <button onClick={() => scene.current?.reset()}>Reset view</button>
      <button aria-label="Zoom in" onClick={() => scene.current?.zoom(1.25)}>+</button>
    </div>
  </section>;
}
