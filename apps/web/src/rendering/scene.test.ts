import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { researchWorldFixture } from '../research.fixture';

const mocks = vi.hoisted(() => ({
  init: vi.fn(), destroy: vi.fn(), render: vi.fn(), observe: vi.fn(), disconnect: vi.fn(),
  removeControls: vi.fn(), controls: vi.fn(), build: vi.fn(), selection: vi.fn(),
  animate: vi.fn(), stopAnimation: vi.fn(),
}));

vi.mock('pixi.js', () => {
  const point = () => ({ set: vi.fn(), copyFrom: vi.fn() });
  class Container {
    position = point();
    scale = point();
    addChild = vi.fn();
    removeChildren = () => [];
  }
  return {
    Container,
    Application: class {
      init = mocks.init;
      destroy = mocks.destroy;
      render = mocks.render;
      stage = new Container();
      canvas = {};
      screen = { width: 800, height: 600 };
      renderer = { resize: vi.fn() };
    },
  };
});
vi.mock('./cameraControls', () => ({ attachCameraControls: mocks.controls }));
vi.mock('./worldLayers', () => ({ buildWorldLayers: mocks.build }));
vi.mock('./selectionLayer', () => ({ drawSelection: mocks.selection }));
vi.mock('./shipAnimation', () => ({ createShipAnimator: () => ({ update: mocks.animate, dispose: mocks.stopAnimation }) }));

import { createScene } from './scene';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.init.mockResolvedValue(undefined);
  mocks.controls.mockReturnValue(Object.assign(mocks.removeControls, { clearHover: vi.fn(), revalidateHover: vi.fn() }));
  mocks.build.mockReturnValue({ worldLayer: {}, ships: [] });
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
  scene.setSelection('beacon-1');
  scene.zoom(1.25);
  scene.reset();
  expect(mocks.build).toHaveBeenCalledExactlyOnceWith(world);
  expect(mocks.selection).toHaveBeenLastCalledWith(expect.anything(), world, 'beacon-1');
  expect(mocks.animate).toHaveBeenCalledOnce();
  scene.dispose();
  scene.dispose();
  expect(mocks.stopAnimation).toHaveBeenCalledOnce();
  expect(mocks.disconnect).toHaveBeenCalledOnce();
  expect(mocks.removeControls).toHaveBeenCalledOnce();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});
