import type { Camera } from './camera';
import type { RenderShip } from './shipAnimation';

type ShipTile = { x: number; y: number; ships: RenderShip[] };

export function shipAt(tiles: ShipTile[], camera: Camera, bounds: { left: number; top: number }, clientX: number, clientY: number) {
  const x = (clientX - bounds.left - camera.x) / camera.zoom;
  const y = (clientY - bounds.top - camera.y) / camera.zoom;
  for (const tile of [...tiles].reverse()) for (const ship of [...tile.ships].reverse()) {
    if (!ship.id) continue;
    const sx = ship.graphic.position.x + tile.x;
    const sy = ship.graphic.position.y + tile.y;
    if (Math.hypot(x - sx, y - sy) <= Math.max(17, 12 / camera.zoom)) {
      return { id: ship.id, x: camera.x + sx * camera.zoom, y: camera.y + sy * camera.zoom };
    }
  }
  return null;
}
