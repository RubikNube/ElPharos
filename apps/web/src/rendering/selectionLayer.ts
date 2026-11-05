import { Container, Graphics } from 'pixi.js';
import type { WorldState } from '../protocol';
import { isDiscovered } from './visibility';

export function drawSelection(overlay: Container, world: WorldState | null, selectedId: string | null) {
  for (const child of overlay.removeChildren()) child.destroy({ children: true });
  if (!world) return;
    const selected = world.lighthouses.find(light => light.id === selectedId && isDiscovered(world, light.position));
    if (selected) overlay.addChild(new Graphics().circle(selected.position.x, selected.position.y, 45).stroke({ color: 0xffffff, width: 3 }));
    if (selected && selected.radius < world.radius_max) {
      const radius = Math.min(world.radius_max, selected.radius + world.radius_step);
      overlay.addChild(new Graphics().circle(selected.position.x, selected.position.y, radius).stroke({color: 0x9ae6d1, width: 2, alpha: 0.65}));
      for (const island of world.islands) {
        const distance = Math.hypot(island.position.x-selected.position.x, island.position.y-selected.position.y);
        if (isDiscovered(world, island.position) && distance > selected.radius && distance <= radius) overlay.addChild(new Graphics().circle(island.position.x, island.position.y, island.radius+8).stroke({color: 0x9ae6d1, width: 3}));
      }
    }
}
