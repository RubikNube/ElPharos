import { Application, Container } from 'pixi.js';
import type { WorldState } from '../protocol';
import { fitWorld, zoomAt, type Camera } from './camera';
import { attachCameraControls } from './cameraControls';
import { buildWorldLayers } from './worldLayers';
import { drawSelection } from './selectionLayer';
import { createShipAnimator } from './shipAnimation';

export async function createScene(host: HTMLDivElement, signal: AbortSignal, onSelect: (id: string | null) => void) {
  const app = new Application();
  await app.init({
    width: host.clientWidth, height: host.clientHeight,
    background: '#081521', antialias: true, autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: 'webgl', autoStart: false,
  });
  if (signal.aborted) { app.destroy(true, { children: true }); return null; }
  host.appendChild(app.canvas);
  const worldLayer = new Container();
  const overlay = new Container();
  app.stage.addChild(worldLayer, overlay);
  let world: WorldState | null = null;
  let selectedId: string | null = null;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let fitted = false;
  let disposed = false;
  const animator = createShipAnimator(render);
  function render() {
    worldLayer.position.set(camera.x, camera.y);
    worldLayer.scale.set(camera.zoom);
    overlay.position.copyFrom(worldLayer.position);
    overlay.scale.copyFrom(worldLayer.scale);
    app.render();
  }
  function reset() {
    if (world) camera = fitWorld(app.screen.width, app.screen.height, world.width, world.height);
    render();
  }
  function zoom(factor: number, x = app.screen.width / 2, y = app.screen.height / 2) {
    camera = zoomAt(camera, x, y, factor);
    render();
  }

  function setWorld(next: WorldState | null) {
    world = next;
    for (const child of worldLayer.removeChildren()) child.destroy({ children: true });
    const layers = world ? buildWorldLayers(world) : null;
    if (layers) worldLayer.addChild(layers.worldLayer);
    drawSelection(overlay, world, selectedId);
    if (world && !fitted) { fitted = true; reset(); }
    animator.update(world, layers?.ships ?? []);
  }
  const removeControls = attachCameraControls(host, { getCamera: () => camera, getWorld: () => world, render, zoom, reset, onSelect });
  const observer = new ResizeObserver(() => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    camera.x += (width - app.screen.width) / 2;
    camera.y += (height - app.screen.height) / 2;
    app.renderer.resize(width, height); render();
  });
  observer.observe(host);
  return {
    reset, zoom, setWorld,
    setSelection(id: string | null) {
      selectedId = id;
      drawSelection(overlay, world, id);
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      animator.dispose();
      observer.disconnect();
      removeControls();
      app.destroy(true, { children: true });
    },
  };
}
