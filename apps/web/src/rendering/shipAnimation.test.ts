import { afterEach, expect, it, vi } from 'vitest';
import { createShipAnimator, type RenderShip } from './shipAnimation';
import { researchWorldFixture } from '../research.fixture';

afterEach(() => vi.unstubAllGlobals());

it('interpolates cargo for at most one tick and freezes it when paused, blocked, or motion is reduced', () => {
  let now = 0;
  let frame: FrameRequestCallback = () => {};
  const media = Object.assign(new EventTarget(), { matches: false });
  const cancel = vi.fn();
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', vi.fn((next: FrameRequestCallback) => { frame = next; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const position = vi.fn();
  const ship = {
    graphic: { position: { set: position }, rotation: 0 },
    from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, offset: 0, safe: true,
    cargo: { from: 'a', to: 'b', progress: 0.25, yard_id: 'yard', cargo: 10, returning: false, route: ['a', 'b'] },
  } as unknown as RenderShip;
  const world = researchWorldFixture();
  const animator = createShipAnimator(vi.fn());
  animator.update(world, [ship]);
  now = 500;
  frame(now);
  expect(position).toHaveBeenLastCalledWith(80, 0);
  now = 5000;
  frame(now);
  expect(position.mock.lastCall![0]).toBeCloseTo(110);
  world.economy.paused = true;
  animator.update(world, [ship]);
  expect(position).toHaveBeenLastCalledWith(50, 0);
  world.economy.paused = false;
  ship.safe = false;
  animator.update(world, [ship]);
  now += 500;
  frame(now);
  expect(position).toHaveBeenLastCalledWith(50, 0);
  ship.safe = true;
  media.matches = true;
  media.dispatchEvent(new Event('change'));
  expect(position).toHaveBeenLastCalledWith(50, 0);
  animator.dispose();
  const before = position.mock.calls.length;
  media.dispatchEvent(new Event('change'));
  expect(position).toHaveBeenCalledTimes(before);
  expect(cancel).toHaveBeenCalled();
});
