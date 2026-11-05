import type { WorldState } from '../protocol';
import type { Camera } from './camera';
import { createLighthouseHover, lighthouseAt, type LighthouseHover } from './lighthouseHover';

type Options = {
  getCamera: () => Camera;
  getWorld: () => WorldState | null;
  render: () => void;
  zoom: (factor: number, x?: number, y?: number) => void;
  reset: () => void;
  onSelect: (id: string | null) => void;
  onHover?: (hover: LighthouseHover) => void;
};

export function attachCameraControls(host: HTMLDivElement, { getCamera, getWorld, render, zoom, reset, onSelect, onHover = () => {} }: Options) {
  const hover = createLighthouseHover(host, getWorld, getCamera, onHover);
  let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    hover.clear();
    host.focus();
    host.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    host.classList.add('dragging');
  };
  const move = (event: PointerEvent) => {
    if (!drag) { hover.move(event); return; }
    if (drag.id !== event.pointerId) return;
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    getCamera().x += event.clientX - drag.x;
    getCamera().y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    render();
  };
  const up = (event: PointerEvent) => {
    if (event.type !== 'pointerup') hover.clear();
    if (drag?.id !== event.pointerId) return;
    if (event.type === 'pointerup' && !drag.moved && getWorld()) {
      const hit = lighthouseAt(host, getWorld(), getCamera(), event.clientX, event.clientY);
      onSelect(hit?.id ?? null);
    }
    drag = null;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    host.classList.remove('dragging');
  };
  const wheel = (event: WheelEvent) => {
    hover.clear();
    event.preventDefault();
    const bounds = host.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
    zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015), event.clientX - bounds.left, event.clientY - bounds.top);
  };
  const key = (event: KeyboardEvent) => {
    if (['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0'].includes(event.key)) hover.clear();
    const shifts: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (shifts[event.key]) {
      event.preventDefault();
      const [x, y] = shifts[event.key]; getCamera().x += x; getCamera().y += y; render();
    } else if (['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') reset(); else zoom(event.key === '-' ? 0.8 : 1.25);
    }
  };
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hover.clear(); };
  host.ownerDocument?.addEventListener('keydown', escape);
  host.addEventListener('pointerdown', down);
  host.addEventListener('pointerleave', hover.clear);
  host.addEventListener('blur', hover.clear);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  host.addEventListener('lostpointercapture', up);
  host.addEventListener('wheel', wheel, { passive: false });
  host.addEventListener('keydown', key);
  return Object.assign(() => {
      hover.clear();
      host.ownerDocument?.removeEventListener('keydown', escape);
      host.removeEventListener('pointerleave', hover.clear);
      host.removeEventListener('blur', hover.clear);
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('lostpointercapture', up);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('keydown', key);
    if (drag && host.hasPointerCapture(drag.id)) host.releasePointerCapture(drag.id);
    host.classList.remove('dragging');
  }, { clearHover: hover.clear, revalidateHover: hover.revalidate });
}
