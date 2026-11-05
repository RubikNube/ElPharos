import type { WorldState } from '../protocol';
import type { Camera } from './camera';
import { isDiscovered } from './visibility';

type Options = {
  getCamera: () => Camera;
  getWorld: () => WorldState | null;
  render: () => void;
  zoom: (factor: number, x?: number, y?: number) => void;
  reset: () => void;
  onSelect: (id: string | null) => void;
};

export function attachCameraControls(host: HTMLDivElement, { getCamera, getWorld, render, zoom, reset, onSelect }: Options) {
  let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    host.focus();
    host.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    host.classList.add('dragging');
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    getCamera().x += event.clientX - drag.x;
    getCamera().y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    render();
  };
  const up = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    if (event.type === 'pointerup' && !drag.moved && getWorld()) {
      const world = getWorld()!;
      const bounds = host.getBoundingClientRect();
      const x = (event.clientX - bounds.left - getCamera().x) / getCamera().zoom;
      const y = (event.clientY - bounds.top - getCamera().y) / getCamera().zoom;
      const hit = [...world.lighthouses].reverse().find(light => isDiscovered(world!, light.position) && Math.hypot(light.position.x - x, light.position.y - y) <= 45);
      onSelect(hit?.id ?? null);
    }
    drag = null;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    host.classList.remove('dragging');
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const bounds = host.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
    zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015), event.clientX - bounds.left, event.clientY - bounds.top);
  };
  const key = (event: KeyboardEvent) => {
    const shifts: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (shifts[event.key]) {
      event.preventDefault();
      const [x, y] = shifts[event.key]; getCamera().x += x; getCamera().y += y; render();
    } else if (['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') reset(); else zoom(event.key === '-' ? 0.8 : 1.25);
    }
  };
  host.addEventListener('pointerdown', down);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  host.addEventListener('lostpointercapture', up);
  host.addEventListener('wheel', wheel, { passive: false });
  host.addEventListener('keydown', key);
  return () => {
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('lostpointercapture', up);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('keydown', key);
    if (drag && host.hasPointerCapture(drag.id)) host.releasePointerCapture(drag.id);
    host.classList.remove('dragging');
  };
}
