import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { researchWorldFixture } from '../research.fixture';

const mocks = vi.hoisted(() => ({
  init: vi.fn(), destroy: vi.fn(), render: vi.fn(), observe: vi.fn(), disconnect: vi.fn(),
  removeControls: vi.fn(), controls: vi.fn(), build: vi.fn(), selection: vi.fn(),
  textureCreate: vi.fn(), textureRender: vi.fn(), replaceShips: vi.fn(), animate: vi.fn(), stopAnimation: vi.fn(),
}));

vi.mock('pixi.js', () => {
  const point = () => ({ set: vi.fn(), copyFrom: vi.fn() });
  class Container {
    position = point();
    scale = point();
    children: unknown[] = [];
    addChild = (...children: unknown[]) => { this.children.push(...children); };
    destroy = vi.fn();
    cacheAsTexture = vi.fn();
    removeChildren = () => [];
  }
  return {
    Container,
    Sprite: class extends Container { constructor(public texture: unknown) { super(); } },
    RenderTexture: { create: mocks.textureCreate },
    Graphics: class { poly() { return this; } fill() { return this; } },
    Application: class {
      init = mocks.init;
      destroy = mocks.destroy;
      render = mocks.render;
      stage = new Container();
      canvas = {};
      screen = { width: 800, height: 600 };
      renderer = { resize: vi.fn(), render: mocks.textureRender };
    },
  };
});
vi.mock('./cameraControls', () => ({ attachCameraControls: mocks.controls }));
vi.mock('./worldLayers', async importOriginal => ({ ...await importOriginal<typeof import('./worldLayers')>(), buildWorldLayers: mocks.build }));
vi.mock('./selectionLayer', () => ({ drawSelection: mocks.selection }));
vi.mock('./shipAnimation', () => ({ createShipAnimator: () => ({ replaceShips: mocks.replaceShips, update: mocks.animate, dispose: mocks.stopAnimation }) }));

import { createScene } from './scene';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.init.mockResolvedValue(undefined);
  mocks.controls.mockReturnValue(Object.assign(mocks.removeControls, { clearHover: vi.fn(), revalidateHover: vi.fn() }));
  mocks.build.mockReturnValue({ worldLayer: { destroy: vi.fn() }, shipLayer: { destroy: vi.fn() }, ships: [] });
  mocks.textureCreate.mockImplementation(options => ({ ...options, destroy: vi.fn() }));
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe = mocks.observe; disconnect = mocks.disconnect; });
});
afterEach(() => vi.unstubAllGlobals());

it('destroys an initialization cancelled during StrictMode unmount without attaching resources', async () => {
  let finish!: () => void;
  mocks.init.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const host = { clientWidth: 800, clientHeight: 600, appendChild: vi.fn() };
  const abort = new AbortController();
  const pending = createScene(host as unknown as HTMLDivElement, abort.signal, vi.fn());
  abort.abort();
  finish();
  expect(await pending).toBeNull();
  expect(host.appendChild).not.toHaveBeenCalled();
  expect(mocks.controls).not.toHaveBeenCalled();
  expect(mocks.observe).not.toHaveBeenCalled();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it('updates selection and camera without rebuilding terrain and disposes resources once', async () => {
  const host = { clientWidth: 800, clientHeight: 600, appendChild: vi.fn() };
  const scene = (await createScene(host as unknown as HTMLDivElement, new AbortController().signal, vi.fn()))!;
  const world = researchWorldFixture();
  scene.setWorld(world);
  const builds = mocks.build.mock.calls.length;
  scene.setSelection('beacon-1');
  expect(mocks.build).toHaveBeenCalledTimes(builds);
  const controls = mocks.controls.mock.calls[0][1];
  controls.getCamera().x += world.width*controls.getCamera().zoom*10;
  controls.getCamera().y -= world.height*controls.getCamera().zoom*10;
  controls.render();
  expect(mocks.build).toHaveBeenCalledTimes(builds);
  scene.zoom(1.25);
  scene.reset();
  expect(mocks.build).toHaveBeenCalledWith(world, 'terrain');
  expect(mocks.selection).toHaveBeenLastCalledWith(expect.anything(), world, 'beacon-1');
  expect(mocks.animate).toHaveBeenCalledOnce();
  scene.dispose();
  scene.dispose();
  expect(mocks.stopAnimation).toHaveBeenCalledOnce();
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  expect(mocks.removeControls).toHaveBeenCalledOnce();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

it('shares bounded terrain across copies and reuses it through ticks and zoom', async () => {
  const host = { clientWidth: 800, clientHeight: 600, appendChild: vi.fn() };
  const scene = (await createScene(host as unknown as HTMLDivElement, new AbortController().signal, vi.fn()))!;
  const world = researchWorldFixture();
  scene.setWorld(world);
  const texture = mocks.textureCreate.mock.results[0].value;
  expect(texture.width * texture.resolution).toBeLessThanOrEqual(2048);
  expect(texture.height * texture.resolution).toBeLessThanOrEqual(2048);
  expect(texture.antialias).toBe(false);
  scene.zoom(0.01);
  for (let i = 0; i < 10; i++) scene.setWorld({ ...world, revision: i, economy: { ...world.economy, elapsed_seconds: i } });
  expect(mocks.textureCreate).toHaveBeenCalledTimes(1);
  expect(mocks.textureRender).toHaveBeenCalledTimes(1);
  expect(texture.destroy).not.toHaveBeenCalled();
  const changed = structuredClone(world);
  changed.radius_max += 10;
  scene.setWorld(changed);
  expect(mocks.textureRender).toHaveBeenCalledTimes(2);
  expect(mocks.textureCreate).toHaveBeenCalledTimes(1);
  scene.setWorld({ ...changed, width: changed.width + 100 });
  expect(texture.destroy).toHaveBeenCalledExactlyOnceWith(true);
  const replacement = mocks.textureCreate.mock.results[1].value;
  scene.setWorld(null);
  expect(replacement.destroy).toHaveBeenCalledExactlyOnceWith(true);
  scene.dispose();
  expect(replacement.destroy).toHaveBeenCalledTimes(1);
});
