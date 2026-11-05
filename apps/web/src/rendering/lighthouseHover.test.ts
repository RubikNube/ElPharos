import { afterEach, expect, it, vi } from 'vitest';
import { researchWorldFixture } from '../research.fixture';
import { attachCameraControls } from './cameraControls';

function setup() {
  vi.useFakeTimers();
  const world = researchWorldFixture();
  world.lighthouses = [100, 250, 900].map((x, i) => ({
    id: `beacon-${i}`, island_id: `island-${i}`, name: `Light ${i}`, position: { x, y: 100 },
    active: true, connected: true, radius: 290, explored_radius: i === 0 ? 290 : 0,
    specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25,
  }));
  const host = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => false,
    classList: { add: vi.fn(), remove: vi.fn() },
  }) as unknown as HTMLDivElement;
  const onHover = vi.fn(), onSelect = vi.fn();
  const camera = { x: 0, y: 0, zoom: 1 };
  const controls = attachCameraControls(host, { getCamera: () => camera, getWorld: () => world, render: vi.fn(), zoom: vi.fn(), reset: vi.fn(), onHover, onSelect });
  function event(type: string, x = 110, extra = {}) {
    host.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: 120, pointerId: 1, button: 0, pointerType: 'mouse', ...extra }));
  }
  return { world, camera, controls, event, onHover, onSelect };
}
afterEach(() => vi.useRealTimers());

it('waits 600 ms on the same marker, resets for another marker and never selects on hover', () => {
  const s = setup();
  s.event('pointermove');
  vi.advanceTimersByTime(400);
  s.event('pointermove', 115);
  vi.advanceTimersByTime(199);
  expect(s.onHover).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'beacon-0' }));
  vi.advanceTimersByTime(1);
  expect(s.onHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'beacon-0', x: 100, y: 100 }));
  s.event('pointermove', 260);
  expect(s.onHover).toHaveBeenLastCalledWith(null);
  vi.advanceTimersByTime(600);
  expect(s.onHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'beacon-1' }));
  expect(s.onSelect).not.toHaveBeenCalled();
  s.controls();
});

it.each(['pointerleave', 'pointerdown', 'pointercancel', 'lostpointercapture', 'blur', 'wheel', 'keydown'])('cancels a pending hover on %s', type => {
  const s = setup();
  s.event('pointermove');
  s.event(type, 110, { key: 'Escape', deltaY: 0, deltaMode: 0 });
  s.onHover.mockClear();
  vi.advanceTimersByTime(1000);
  expect(s.onHover).not.toHaveBeenCalled();
  s.controls();
});

it('ignores hidden markers and touch hover, and cancels timers on disposal', () => {
  const s = setup();
  s.event('pointermove', 910);
  vi.advanceTimersByTime(600);
  expect(s.onHover).toHaveBeenLastCalledWith(null);
  s.event('pointermove', 110, { pointerType: 'touch' });
  vi.advanceTimersByTime(600);
  expect(s.onHover).toHaveBeenLastCalledWith(null);
  s.event('pointermove');
  s.controls();
  s.onHover.mockClear();
  vi.advanceTimersByTime(600);
  s.event('pointermove');
  expect(s.onHover).not.toHaveBeenCalled();
});

it('keeps a valid hover through ticks but invalidates replaced or no-longer-discovered targets', () => {
  const s = setup();
  s.event('pointermove');
  s.world.revision++;
  s.controls.revalidateHover();
  vi.advanceTimersByTime(600);
  expect(s.onHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'beacon-0' }));
  s.world.lighthouses[0].name = 'Replacement';
  s.controls.revalidateHover();
  expect(s.onHover).toHaveBeenLastCalledWith(null);
  s.event('pointermove');
  s.world.lighthouses[0].explored_radius = 0;
  s.controls.revalidateHover();
  s.onHover.mockClear();
  vi.advanceTimersByTime(600);
  expect(s.onHover).not.toHaveBeenCalled();
  s.controls();
});

it('selects with a click or touch tap but preserves selection while dragging', () => {
  const s = setup();
  s.event('pointerdown');
  s.event('pointerup');
  expect(s.onSelect).toHaveBeenLastCalledWith('beacon-0');
  s.onSelect.mockClear();
  s.event('pointerdown');
  s.event('pointermove', 210);
  s.event('pointerup', 210);
  expect(s.onSelect).not.toHaveBeenCalled();
  s.event('pointerdown', 210, { pointerType: 'touch' });
  s.event('pointerup', 210, { pointerType: 'touch' });
  expect(s.onSelect).toHaveBeenLastCalledWith('beacon-0');
  s.controls();
});
