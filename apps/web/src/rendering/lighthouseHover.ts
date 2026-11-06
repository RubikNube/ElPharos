import { distance, nearest } from '../geometry';
import type { WorldState } from '../protocol';
import { keeperIdentity } from '../state/keeper';
import type { Camera } from './camera';
import { isDiscovered } from './visibility';

export type LighthouseHover = { kind: 'lighthouse'; id: string; identity: string; x: number; y: number } | { kind: 'ship'; id: string; identity: string; x: number; y: number } | null;

export function lighthouseAt(host: HTMLDivElement, world: WorldState | null, camera: Camera, clientX: number, clientY: number) {
  const bounds = host.getBoundingClientRect();
  const x = (clientX - bounds.left - camera.x) / camera.zoom;
  const y = (clientY - bounds.top - camera.y) / camera.zoom;
  return world && [...world.lighthouses].reverse().find(light => isDiscovered(world, light.position) && distance(world, light.position, { x, y }) <= 45);
}

export function createLighthouseHover(host: HTMLDivElement, getWorld: () => WorldState | null, getCamera: () => Camera, onHover: (hover: LighthouseHover) => void, shipAt?: (x: number, y: number) => { id: string; x: number; y: number } | null) {
  let target: LighthouseHover = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pointer: { x: number; y: number } | null = null;
  function clear() {
    clearTimeout(timer);
    timer = undefined;
    target = null;
    pointer = null;
    onHover(null);
  }
  function revalidate() {
    if (!pointer || !target) return;
    if (target.kind === 'ship') return;
    const light = lighthouseAt(host, getWorld(), getCamera(), pointer.x, pointer.y);
    if (!light || keeperIdentity(light) !== target.identity) clear();
  }
  function move(event: PointerEvent) {
    if (event.pointerType === 'touch') { clear(); return; }
    const ship = shipAt?.(event.clientX, event.clientY);
    if (ship) {
      if (target?.kind === 'ship' && target.id === ship.id) return;
      clear();
      pointer = { x: event.clientX, y: event.clientY };
      target = { kind: 'ship', id: ship.id, identity: ship.id, x: ship.x, y: ship.y };
      timer = setTimeout(() => { if (target) onHover(target); }, 150);
      return;
    }
    const light = lighthouseAt(host, getWorld(), getCamera(), event.clientX, event.clientY);
    if (!light) { clear(); return; }
    pointer = { x: event.clientX, y: event.clientY };
    if (target?.kind === 'lighthouse' && target.identity === keeperIdentity(light)) return;
    clear();
    pointer = { x: event.clientX, y: event.clientY };
    const camera = getCamera();
    const bounds = host.getBoundingClientRect();
    const copy = nearest(getWorld()!, { x: (event.clientX-bounds.left-camera.x)/camera.zoom, y: (event.clientY-bounds.top-camera.y)/camera.zoom }, light.position);
    target = { kind: 'lighthouse', id: light.id, identity: keeperIdentity(light), x: camera.x + copy.x * camera.zoom, y: camera.y + copy.y * camera.zoom };
    timer = setTimeout(() => { revalidate(); if (target) onHover(target); }, 600);
  }
  return { move, clear, revalidate };
}
