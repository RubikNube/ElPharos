import { afterEach, expect, it, vi } from 'vitest';
import { researchWorldFixture } from '../research.fixture';
import { attachCameraControls } from './cameraControls';

function setup() {
  vi.useFakeTimers();
  const world = researchWorldFixture();
  world.lighthouses = [100, 250, 900].map((x, i) => ({
    id: `beacon-${i}`, island_id: `island-${i}`, name: `Light ${i}`, position: { x, y: 100 },
    active: true, connected: true, radius: 290, effective_radius: 290, sick: false, immune_until: 300, explored_radius: i === 0 ? 290 : 0,
    specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25,
  }));
  const host = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => false,
    classList: { add: vi.fn(), remove: vi.fn() },
  }) as unknown as HTMLDivElement;
  const onHover = vi.fn(), onSelect = vi.fn(), onContextMenu = vi.fn(), onMapNavigate = vi.fn();
  const camera = { x: 0, y: 0, zoom: 1 };
  const controls = attachCameraControls(host, { getCamera: () => camera, getWorld: () => world, render: vi.fn(), zoom: vi.fn(), reset: vi.fn(), onHover, onSelect, onContextMenu, onMapNavigate, getSelectedId: () => 'beacon-0' });
  function event(type: string, x = 110, extra = {}) {
    host.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: 120, pointerId: 1, button: 0, pointerType: 'mouse', ...extra }));
  }
  return { world, camera, controls, event, onHover, onSelect, onContextMenu, onMapNavigate };
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

it('opens actions on a discovered marker with right click or keyboard and keeps the browser menu elsewhere', () => {
  const s = setup();
  const rightClick = new Event('contextmenu', { cancelable: true });
  s.event('contextmenu', 110, { clientY: 120, preventDefault: () => rightClick.preventDefault() });
  expect(rightClick.defaultPrevented).toBe(true);
  expect(s.onContextMenu).toHaveBeenLastCalledWith({ id: 'beacon-0', x: 100, y: 100 });
  expect(s.onSelect).toHaveBeenLastCalledWith('beacon-0');
  s.onContextMenu.mockClear();
  s.event('contextmenu', 910);
  expect(s.onContextMenu).not.toHaveBeenCalled();
  s.event('keydown', 110, { key: 'F10', shiftKey: true });
  expect(s.onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'beacon-0' }));
  s.controls();
});

it('opens on touch long press, but cancels for drag, release, and disposal', () => {
  const s = setup();
  s.event('pointerdown', 110, { pointerType: 'touch' });
  vi.advanceTimersByTime(500);
  expect(s.onContextMenu).toHaveBeenCalledExactlyOnceWith({ id: 'beacon-0', x: 100, y: 100 });
  s.event('pointerup', 110, { pointerType: 'touch' });
  expect(s.onSelect).toHaveBeenCalledTimes(1);
  s.onContextMenu.mockClear();
  s.event('pointerdown', 110, { pointerType: 'touch' });
  s.event('pointermove', 210, { pointerType: 'touch' });
  vi.advanceTimersByTime(500);
  expect(s.onContextMenu).not.toHaveBeenCalled();
  s.event('pointerup', 210, { pointerType: 'touch' });
  s.event('pointerdown', 110, { pointerType: 'touch' });
  s.event('pointerup', 110, { pointerType: 'touch' });
  vi.advanceTimersByTime(500);
  expect(s.onContextMenu).not.toHaveBeenCalled();
  s.event('pointerdown', 110, { pointerType: 'touch' });
  s.controls();
  vi.advanceTimersByTime(500);
  expect(s.onContextMenu).not.toHaveBeenCalled();
});

it('anchors hover and selection to the visible periodic copy', () => {
  const s = setup();
  s.event('pointermove', 110 + s.world.width);
  vi.advanceTimersByTime(600);
  expect(s.onHover).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'beacon-0', x: 100+s.world.width, y: 100 }));
  s.event('pointerdown', 110 + s.world.width);
  s.event('pointerup', 110 + s.world.width);
  expect(s.onSelect).toHaveBeenLastCalledWith('beacon-0');
  s.controls();
});

it('prioritizes a ship under the pointer and shows it after a short hover', () => {
  vi.useFakeTimers();
  const world = researchWorldFixture();
  const host = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => false,
    classList: { add: vi.fn(), remove: vi.fn() },
  }) as unknown as HTMLDivElement;
  const onHover = vi.fn();
  const controls = attachCameraControls(host, {
    getCamera: () => ({ x: 0, y: 0, zoom: 1 }), getWorld: () => world,
    render: vi.fn(), zoom: vi.fn(), reset: vi.fn(), onSelect: vi.fn(), onHover,
    shipAt: (x, y) => x === 110 && y === 120 ? { id: 'voyage:1', x: 100, y: 100 } : null,
  });
  host.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 110, clientY: 120, pointerType: 'mouse' }));
  vi.advanceTimersByTime(149);
  expect(onHover).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'ship' }));
  vi.advanceTimersByTime(1);
  expect(onHover).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'ship', id: 'voyage:1' }));
  host.dispatchEvent(new Event('pointerleave'));
  expect(onHover).toHaveBeenLastCalledWith(null);
  controls();
});
