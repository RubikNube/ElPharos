import type { WorldState } from '../protocol';
import type { Camera } from './camera';
import { createLighthouseHover, lighthouseAt, type LighthouseHover } from './lighthouseHover';
import { isDiscovered } from './visibility';
import { wrap } from '../geometry';

type Options = {
  getCamera: () => Camera;
  getWorld: () => WorldState | null;
  render: () => void;
  zoom: (factor: number, x?: number, y?: number) => void;
  reset: () => void;
  onSelect: (id: string | null) => void;
  onContextMenu?: (target: { id: string; x: number; y: number }) => void;
  onMapNavigate?: () => void;
  getSelectedId?: () => string | null;
  onHover?: (hover: LighthouseHover) => void;
  shipAt?: (x: number, y: number) => { id: string; x: number; y: number } | null;
  onShipSelect?: () => void;
  onOrder?: (destination: { x: number; y: number }, lighthouseId: string | null) => void;
  isBoatSelected?: () => boolean;
};

export function attachCameraControls(host: HTMLDivElement, { getCamera, getWorld, render, zoom, reset, onSelect, onContextMenu, onMapNavigate, getSelectedId, onHover = () => {}, shipAt, onShipSelect, onOrder, isBoatSelected }: Options) {
  const hover = createLighthouseHover(host, getWorld, getCamera, onHover, shipAt);
  let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  let longPress: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  const cancelLongPress = () => { clearTimeout(longPress); longPress = undefined; };
  const openMenu = (id: string, clientX: number, clientY: number) => {
    const bounds = host.getBoundingClientRect();
    hover.clear();
    onSelect(id);
    onContextMenu?.({ id, x: clientX - bounds.left, y: clientY - bounds.top });
  };
  const orderAt = (clientX: number, clientY: number) => {
    const world = getWorld();
    if (!world) return;
    const hit = lighthouseAt(host, world, getCamera(), clientX, clientY);
    if (hit) { onOrder?.(hit.position, hit.id); return; }
    const bounds = host.getBoundingClientRect();
    onOrder?.({ x: wrap((clientX - bounds.left - getCamera().x) / getCamera().zoom, world.width),
      y: wrap((clientY - bounds.top - getCamera().y) / getCamera().zoom, world.height) }, null);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    onMapNavigate?.();
    hover.clear();
    host.focus();
    host.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    longPressed = false;
    if (event.pointerType === 'touch' && getWorld()) {
      const hit = lighthouseAt(host, getWorld(), getCamera(), event.clientX, event.clientY);
      if (hit) longPress = setTimeout(() => {
        longPress = undefined;
        longPressed = true;
        openMenu(hit.id, event.clientX, event.clientY);
      }, 500);
    }
    host.classList.add('dragging');
  };
  const move = (event: PointerEvent) => {
    if (!drag) { hover.move(event); return; }
    if (drag.id !== event.pointerId) return;
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    if (drag.moved) cancelLongPress();
    getCamera().x += event.clientX - drag.x;
    getCamera().y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    render();
  };
  const up = (event: PointerEvent) => {
    cancelLongPress();
    if (event.type !== 'pointerup') hover.clear();
    if (drag?.id !== event.pointerId) return;
    if (event.type === 'pointerup' && !drag.moved && !longPressed && getWorld()) {
      if (shipAt?.(event.clientX, event.clientY)?.id === 'expedition') {
        onShipSelect?.();
      } else if (event.pointerType === 'touch' && isBoatSelected?.()) {
        orderAt(event.clientX, event.clientY);
      } else {
      const hit = lighthouseAt(host, getWorld(), getCamera(), event.clientX, event.clientY);
      onSelect(hit?.id ?? null);
      }
    }
    drag = null;
    longPressed = false;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    host.classList.remove('dragging');
  };
  const wheel = (event: WheelEvent) => {
    cancelLongPress();
    onMapNavigate?.();
    hover.clear();
    event.preventDefault();
    const bounds = host.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
    zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015), event.clientX - bounds.left, event.clientY - bounds.top);
  };
  const key = (event: KeyboardEvent) => {
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      const world = getWorld();
      const light = world?.lighthouses.find(light => light.id === getSelectedId?.() && isDiscovered(world, light.position));
      if (light) {
        event.preventDefault();
        const bounds = host.getBoundingClientRect();
        const x = Math.max(8, Math.min(bounds.width - 8, getCamera().x + light.position.x * getCamera().zoom));
        const y = Math.max(8, Math.min(bounds.height - 8, getCamera().y + light.position.y * getCamera().zoom));
        openMenu(light.id, bounds.left + x, bounds.top + y);
      }
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0'].includes(event.key)) onMapNavigate?.();
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
  const contextMenu = (event: MouseEvent) => {
    const hit = lighthouseAt(host, getWorld(), getCamera(), event.clientX, event.clientY);
    if (hit) {
      event.preventDefault();
      openMenu(hit.id, event.clientX, event.clientY);
    } else if (isBoatSelected?.()) {
      event.preventDefault();
      orderAt(event.clientX, event.clientY);
    }
  };
  host.ownerDocument?.addEventListener('keydown', escape);
  host.addEventListener('pointerdown', down);
  host.addEventListener('contextmenu', contextMenu);
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
      host.removeEventListener('contextmenu', contextMenu);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('lostpointercapture', up);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('keydown', key);
    if (drag && host.hasPointerCapture(drag.id)) host.releasePointerCapture(drag.id);
    cancelLongPress();
    host.classList.remove('dragging');
  }, { clearHover: hover.clear, revalidateHover: hover.revalidate });
}
