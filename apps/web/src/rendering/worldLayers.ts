import { Container, Graphics, Text } from 'pixi.js';
import type { WorldState } from '../protocol';
import type { RenderShip } from './shipAnimation';
import { isDiscovered } from './visibility';

export function buildWorldLayers(world: WorldState) {
    const nextWorld = world;
    const worldLayer = new Container({ isRenderGroup: true });
    const ships: RenderShip[] = [];
    function terrainLayer() {
      const terrain = new Container();
      // Ocean dimensions and every entity's position/radius are server-owned.
      terrain.addChild(new Graphics().rect(0, 0, nextWorld.width, nextWorld.height).fill(0x0f2234)
        .stroke({ color: 0x284356, width: 2 }));
      for (const island of nextWorld.islands) {
        if (!isDiscovered(nextWorld, island.position)) continue;
        const { x, y } = island.position;
        terrain.addChild(new Graphics()
          .ellipse(x, y + 6, island.radius * 1.16, island.radius * 0.83).fill({ color: 0x315564, alpha: 0.4 })
          .ellipse(x, y, island.radius, island.radius * 0.72).fill(0x887e58)
          .ellipse(x, y - 5, island.radius * 0.9, island.radius * 0.62).fill(0x425c52));
        const label = new Text({ text: island.name, style: { fontFamily: 'Georgia', fontSize: 21, fill: 0xd5dfd7, letterSpacing: 2 } });
        label.anchor.set(0.5, 0);
        label.position.set(x, y + island.radius * 0.8);
        terrain.addChild(label);
      }
      for (const lighthouse of nextWorld.lighthouses) {
        if (!isDiscovered(nextWorld, lighthouse.position)) continue;
        const { x, y } = lighthouse.position;
        if (lighthouse.active) {
          const light = new Graphics();
          for (let ring = 8; ring >= 1; ring--) {
            light.circle(x, y, lighthouse.radius * ring / 8).fill({ color: 0xffd34d, alpha: 0.018 });
          }
          light.circle(x, y, lighthouse.radius).stroke({ color: 0xffd34d, alpha: 0.6, width: 1.5 });
          terrain.addChild(light);
        }
        terrain.addChild(new Graphics()
          .ellipse(x, y + 40, 30, 11).fill({ color: 0x081521, alpha: 0.45 })
          .poly([x - 14, y + 37, x - 9, y - 8, x + 9, y - 8, x + 14, y + 37]).fill(0xeee5cc)
          .rect(x - 11, y + 12, 22, 8).fill(0xad6950)
          .rect(x - 12, y - 13, 24, 15).fill(0x283b43)
          .rect(x - 8, y - 10, 16, 9).fill(lighthouse.active ? 0xffd34d : 0x718487)
          .poly([x - 17, y - 14, x, y - 27, x + 17, y - 14]).fill(0xad6950)
          .rect(x - 19, y + 36, 38, 5).fill(0xc5bea7));
      }
      return terrain;
    }
    worldLayer.addChild(new Graphics().rect(0, 0, world.width, world.height).fill(0x192331));
    for (const current of [false, true]) {
      const terrain = terrainLayer();
      terrain.alpha = current ? 1 : 0.35;
      const mask = new Graphics();
      for (const light of world.lighthouses) {
        const radius = current ? (light.active ? light.radius : 0) : light.explored_radius;
        if (radius > 0) mask.circle(light.position.x, light.position.y, radius).fill(0xffffff);
      }
      worldLayer.addChild(terrain, mask);
      terrain.mask = mask;
    }
    // Server-owned links always lie inside the union of connected light circles.
    for (const [index, link] of world.shipping_links.entries()) {
      const from = world.lighthouses.find(light => light.id === link.from);
      const to = world.lighthouses.find(light => light.id === link.to);
      if (!from || !to || !isDiscovered(world, from.position) || !isDiscovered(world, to.position)) continue;
      worldLayer.addChild(new Graphics().moveTo(from.position.x, from.position.y)
        .lineTo(to.position.x, to.position.y).stroke({ color: 0xffd34d, alpha: 0.45, width: 2 }));
      if (world.salvage) continue;
      const graphic = new Graphics().poly([12, 0, -8, -6, -5, 0, -8, 6]).fill(0xffedb3)
        .stroke({ color: 0x081521, width: 2 });
      worldLayer.addChild(graphic);
      ships.push({ graphic, from: from.position, to: to.position, offset: index * 0.37 });
    }
    for (const cargo of world.salvage?.ships ?? []) {
      const from = world.lighthouses.find(l => l.id === cargo.from), to = world.lighthouses.find(l => l.id === cargo.to);
      if (!from || !to || !isDiscovered(world, from.position)) continue;
      const graphic = new Graphics().poly([12, 0, -8, -6, -5, 0, -8, 6]).fill(cargo.cargo ? 0xf3b45c : 0xadc7d7).stroke({color: 0x081521, width: 2});
      worldLayer.addChild(graphic);
      ships.push({graphic, from: from.position, to: to.position, offset: 0, cargo, safe: from.connected && to.connected && Math.hypot(from.position.x-to.position.x, from.position.y-to.position.y) <= from.radius+to.radius});
    }
    const vessel = world.salvage?.vessel;
    const route = world.salvage?.vessel_route;
    if (vessel && route) {
      const graphic = new Graphics().poly([22, 0, 10, -10, -16, -10, -20, -5, -20, 5, -16, 10, 10, 10]).fill(vessel.cargo ? 0xf3b45c : 0xadc7d7)
        .stroke({ color: 0x081521, width: 2 }).rect(-9, -5, 12, 10).fill(0xeee5cc);
      worldLayer.addChild(graphic);
      ships.push({ graphic, from: route[0], to: route[1], offset: 0, vessel, travelSeconds: world.salvage!.rules.vessel.travel_seconds });
    }
  return { worldLayer, ships };
}
