import type { WorldState } from '../protocol';
import { keeperIdentity } from '../state/keeper';
import type { Camera } from './camera';
import { isDiscovered } from './visibility';

export type LighthouseHover = { id: string; identity: string; x: number; y: number } | null;

export function lighthouseAt(host: HTMLDivElement, world: WorldState | null, camera: Camera, clientX: number, clientY: number) {
  const bounds = host.getBoundingClientRect();
  const x = (clientX - bounds.left - camera.x) / camera.zoom;
  const y = (clientY - bounds.top - camera.y) / camera.zoom;
  return world && [...world.lighthouses].reverse().find(light => isDiscovered(world, light.position) && Math.hypot(light.position.x - x, light.position.y - y) <= 45);
}

export function createLighthouseHover(host: HTMLDivElement, getWorld: () => WorldState | null, getCamera: () => Camera, onHover: (hover: LighthouseHover) => void) {
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
    const light = lighthouseAt(host, getWorld(), getCamera(), pointer.x, pointer.y);
    if (!light || keeperIdentity(light) !== target.identity) clear();
  }
  function move(event: PointerEvent) {
    if (event.pointerType === 'touch') { clear(); return; }
    const light = lighthouseAt(host, getWorld(), getCamera(), event.clientX, event.clientY);
    if (!light) { clear(); return; }
    pointer = { x: event.clientX, y: event.clientY };
    if (target?.identity === keeperIdentity(light)) return;
    clear();
    pointer = { x: event.clientX, y: event.clientY };
    const camera = getCamera();
    target = { id: light.id, identity: keeperIdentity(light), x: camera.x + light.position.x * camera.zoom, y: camera.y + light.position.y * camera.zoom };
    timer = setTimeout(() => { revalidate(); if (target) onHover(target); }, 600);
  }
  return { move, clear, revalidate };
}
