import { Application, Container, Graphics, RenderTexture, Sprite } from 'pixi.js';
import type { WorldState } from '../protocol';
import { focusHaven, normalizeCamera, visibleTiles, zoomAt, type Camera } from './camera';
import { attachCameraControls } from './cameraControls';
import { buildWorldLayers, terrainKey } from './worldLayers';
import { drawSelection } from './selectionLayer';
import { createShipAnimator } from './shipAnimation';
import type { RenderShip } from './shipAnimation';
import type { LighthouseHover } from './lighthouseHover';
import { shipAt } from './shipHover';

export async function createScene(host: HTMLDivElement, signal: AbortSignal, onSelect: (id: string | null) => void, onHover?: (hover: LighthouseHover) => void) {
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
  let terrainTexture: RenderTexture | null = null;
  let textureWidth = 0, textureHeight = 0;
  let cachedTerrainKey: string | null = null;
  function updateTerrain() {
    if (!world) {
      terrainTexture?.destroy(true);
      terrainTexture = null;
      cachedTerrainKey = null;
      return;
    }
    const key = terrainKey(world);
    if (key === cachedTerrainKey) return;
    if (terrainTexture && (textureWidth !== world.width || textureHeight !== world.height)) {
      terrainTexture.destroy(true);
      terrainTexture = null;
    }
    if (!terrainTexture) {
      const renderer = app.renderer;
      const limit = 'gl' in renderer ? renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE) as number : 2048;
      const resolution = Math.min(2, Math.min(2048, limit) / Math.max(world.width, world.height));
      textureWidth = world.width;
      textureHeight = world.height;
      terrainTexture = RenderTexture.create({ width: world.width, height: world.height, resolution, antialias: false });
    }
    const built = buildWorldLayers(world, 'terrain');
    try {
      app.renderer.render({ container: built.worldLayer, target: terrainTexture, clear: true });
      cachedTerrainKey = key;
    } finally {
      built.worldLayer.destroy({ children: true });
      built.shipLayer.destroy({ children: true });
    }
  }
  type Tile = { terrain: Container; selection: Container; ships: RenderShip[] };
  const tiles = new Map<string, Tile>();
  function clearTiles() {
    for (const tile of tiles.values()) {
      tile.terrain.destroy({ children: true });
      tile.selection.destroy({ children: true });
    }
    tiles.clear();
  }
  function clip(content: Container) {
    const container = new Container();
    // A polygon keeps Pixi on stencil masking; nested scissor rectangles leave gaps when panning.
    const mask = new Graphics().poly([0, 0, world!.width, 0, world!.width, world!.height, 0, world!.height]).fill(0xffffff);
    container.addChild(content, mask);
    content.mask = mask;
    return container;
  }
  function syncTiles() {
    if (!world) return;
    const visible = visibleTiles(camera, app.screen.width, app.screen.height, world);
    const keys = new Set(visible.map(tile => `${tile.x},${tile.y}`));
    let changed = false;
    const spare: Tile[] = [];
    for (const [key, tile] of tiles) {
      if (keys.has(key)) continue;
      spare.push(tile);
      tiles.delete(key);
      changed = true;
    }
    for (const position of visible) {
      const key = `${position.x},${position.y}`;
      if (tiles.has(key)) continue;
      let tile = spare.pop();
      if (!tile) {
        const built = buildWorldLayers(world, 'ships');
        built.worldLayer.destroy({ children: true });
        const selectionContent = new Container();
        drawSelection(selectionContent, world, selectedId);
        const content = new Container();
        const sprite = new Sprite(terrainTexture!);
        sprite.width = world.width;
        sprite.height = world.height;
        content.addChild(sprite, built.shipLayer);
        tile = { terrain: clip(content), selection: clip(selectionContent), ships: built.ships };
        worldLayer.addChild(tile.terrain); overlay.addChild(tile.selection);
      }
      tile.terrain.position.set(position.x*world.width, position.y*world.height);
      tile.selection.position.copyFrom(tile.terrain.position);
      tiles.set(key, tile);
      changed = true;
    }
    for (const tile of spare) {
      tile.terrain.destroy({ children: true }); tile.selection.destroy({ children: true });
    }
    if (changed) animator.replaceShips([...tiles.values()].flatMap(tile => tile.ships));
  }
  function render() {
    if (world) camera = normalizeCamera(camera, world);
    syncTiles();
    worldLayer.position.set(camera.x, camera.y);
    worldLayer.scale.set(camera.zoom);
    overlay.position.copyFrom(worldLayer.position);
    overlay.scale.copyFrom(worldLayer.scale);
    app.render();
  }
  function reset() {
    removeControls.clearHover();
    if (world) camera = focusHaven(app.screen.width, app.screen.height, world);
    render();
  }
  function zoom(factor: number, x = app.screen.width / 2, y = app.screen.height / 2) {
    removeControls.clearHover();
    camera = zoomAt(camera, x, y, factor);
    render();
  }

  function setWorld(next: WorldState | null) {
    world = next;
    removeControls.revalidateHover();
    clearTiles();
    updateTerrain();
    if (world && !fitted) { fitted = true; camera = focusHaven(app.screen.width, app.screen.height, world); }
    if (world) camera = normalizeCamera(camera, world);
    syncTiles();
    animator.update(world, [...tiles.values()].flatMap(tile => tile.ships));
  }
  const removeControls = attachCameraControls(host, { getCamera: () => camera, getWorld: () => world, render, zoom, reset, onSelect, onHover,
    shipAt: (x, y) => shipAt([...tiles.values()].map(tile => ({ x: tile.terrain.position.x, y: tile.terrain.position.y, ships: tile.ships })), camera, host.getBoundingClientRect(), x, y) });
  const observer = new ResizeObserver(() => {
    removeControls.clearHover();
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
      for (const tile of tiles.values()) {
        drawSelection(tile.selection.children[0] as Container, world, id);
      }
      render();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      animator.dispose();
      observer.disconnect();
      removeControls();
      clearTiles();
      terrainTexture?.destroy(true);
      terrainTexture = null;
      app.destroy(true, { children: true });
    },
  };
}
