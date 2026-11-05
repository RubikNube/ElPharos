import { useEffect, useRef, useState } from 'react';
import { createScene } from '../rendering/scene';
import { useWorldStore } from '../state/worldStore';

export function WorldMap() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Awaited<ReturnType<typeof createScene>>>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let unsubscribe: (() => void) | undefined;
    void createScene(host.current!, abort.signal, selectedId => useWorldStore.setState({ selectedId })).then((created) => {
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
      aria-label="World map. Drag or use arrow keys to pan. Scroll or press plus and minus to zoom. Press zero to reset." />
    <div className="map-caption"><span>THE OPEN OCEAN</span><small>An archipelago waiting for light.</small></div>
    {error && <p className="map-error" role="alert">{error}</p>}
    <div className="map-controls">
      <button aria-label="Zoom out" onClick={() => scene.current?.zoom(0.8)}>−</button>
      <button onClick={() => scene.current?.reset()}>Reset view</button>
      <button aria-label="Zoom in" onClick={() => scene.current?.zoom(1.25)}>+</button>
    </div>
  </section>;
}
