import { distance, images } from '../geometry';
import { Container, Graphics } from 'pixi.js';
import type { WorldState } from '../protocol';
import { isDiscovered } from './visibility';

export function drawSelection(overlay: Container, world: WorldState | null, selectedId: string | null) {
  for (const child of overlay.removeChildren()) child.destroy({ children: true });
  if (!world) return;
    const selected = world.lighthouses.find(light => light.id === selectedId && isDiscovered(world, light.position));
    if (selected) for (const position of images(world, selected.position, -world.radius_max, -world.radius_max, world.width+world.radius_max, world.height+world.radius_max)) overlay.addChild(new Graphics().circle(position.x, position.y, 45).stroke({ color: 0xffffff, width: 3 }));
    if (selected && selected.radius < world.radius_max) {
      const radius = Math.min(world.radius_max, selected.radius + world.radius_step) * (selected.sick ? 0.75 : 1);
      for (const position of images(world, selected.position, -radius, -radius, world.width+radius, world.height+radius)) overlay.addChild(new Graphics().circle(position.x, position.y, radius).stroke({color: 0x9ae6d1, width: 2, alpha: 0.65}));
      for (const island of world.islands) {
        const separation = distance(world, island.position, selected.position);
        if (isDiscovered(world, island.position) && separation > selected.effective_radius && separation <= radius) for (const position of images(world, island.position, -island.radius-8, -island.radius-8, world.width+island.radius+8, world.height+island.radius+8)) overlay.addChild(new Graphics().circle(position.x, position.y, island.radius+8).stroke({color: 0x9ae6d1, width: 3}));
      }
    }
}
