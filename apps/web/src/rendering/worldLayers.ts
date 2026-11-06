import { distance, images, nearest } from '../geometry';
import { Container, Graphics, Text } from 'pixi.js';
import type { WorldState } from '../protocol';
import type { RenderShip } from './shipAnimation';
import { isDiscovered } from './visibility';

// Select a pass so dynamic updates never construct terrain graphics or labels.
export function buildWorldLayers(world: WorldState, pass: 'all' | 'terrain' | 'ships' = 'all') {
    const copies = <T extends { position: { x: number; y: number } }>(entities: T[]) => entities.flatMap(entity =>
      images(world, entity.position, -world.radius_max-200, -world.radius_max-200, world.width+world.radius_max+200, world.height+world.radius_max+200).map(position => ({ ...entity, position })));
    const nextWorld = pass === 'ships' ? world : { ...world, islands: copies(world.islands), lighthouses: copies(world.lighthouses) };
    const worldLayer = new Container();
    const ships: RenderShip[] = [];
    const shipLayer = new Container();
    function terrainLayer() {
      const terrain = new Container();
      // Ocean dimensions and every entity's position/radius are server-owned.
      terrain.addChild(new Graphics().rect(0, 0, nextWorld.width, nextWorld.height).fill(0x0f2234));
      for (const island of nextWorld.islands) {
        if (!isDiscovered(world, island.position)) continue;
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
        if (!isDiscovered(world, lighthouse.position)) continue;
        const { x, y } = lighthouse.position;
        if (lighthouse.sick) {
        terrain.addChild(new Graphics().circle(x + 27, y - 28, 12).fill(0x933f4c)
          .rect(x + 24, y - 36, 6, 16).fill(0xffffff).rect(x + 19, y - 31, 16, 6).fill(0xffffff));
      }
      if (lighthouse.active) {
          const light = new Graphics();
          for (let ring = 8; ring >= 1; ring--) {
            light.circle(x, y, lighthouse.effective_radius * ring / 8).fill({ color: 0xffd34d, alpha: 0.018 });
          }
          light.circle(x, y, lighthouse.effective_radius).stroke({ color: 0xffd34d, alpha: 0.6, width: 1.5 });
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
    if (pass !== 'ships') {
      worldLayer.addChild(new Graphics().rect(0, 0, world.width, world.height).fill(0x192331));
      for (const current of [false, true]) {
        const terrain = terrainLayer();
        terrain.alpha = current ? 1 : 0.35;
        const mask = new Graphics();
        for (const light of nextWorld.lighthouses) {
          const radius = current ? (light.active ? light.effective_radius : 0) : light.explored_radius;
          if (radius > 0) mask.circle(light.position.x, light.position.y, radius).fill(0xffffff);
        }
        worldLayer.addChild(terrain, mask);
        terrain.mask = mask;
      }
    }
    const intersectsTile = (from: { x: number; y: number }, to: { x: number; y: number }) =>
      Math.max(from.x, to.x) >= -24 && Math.min(from.x, to.x) <= world.width+24 &&
      Math.max(from.y, to.y) >= -24 && Math.min(from.y, to.y) <= world.height+24;
    for (let ix = -2; ix <= 2; ix++) for (let iy = -2; iy <= 2; iy++) {
      const shifted = (point: { x: number; y: number }) => ({ x: point.x+ix*world.width, y: point.y+iy*world.height });
      // Server-owned links always lie inside the union of connected light circles.
      for (const [index, link] of world.shipping_links.entries()) {
        const source = world.lighthouses.find(light => light.id === link.from);
        const from = source && { ...source, position: shifted(source.position) };
        const target = world.lighthouses.find(light => light.id === link.to);
        const to = target && from && { ...target, position: shifted(nearest(world, source!.position, target.position)) };
        if (!from || !to || !intersectsTile(from.position, to.position) || !isDiscovered(world, from.position) || !isDiscovered(world, to.position)) continue;
        if (pass !== 'ships') worldLayer.addChild(new Graphics().moveTo(from.position.x, from.position.y)
          .lineTo(to.position.x, to.position.y).stroke({ color: 0xffd34d, alpha: 0.45, width: 2 }));
        if (pass === 'terrain' || world.salvage) continue;
        const graphic = new Graphics().poly([12, 0, -8, -6, -5, 0, -8, 6]).fill(0xffedb3)
          .stroke({ color: 0x081521, width: 2 });
        shipLayer.addChild(graphic);
        ships.push({ id: `legacy:${link.from}:${link.to}`, legacy: link, graphic, from: from.position, to: to.position, offset: index * 0.37 });
      }
      if (pass === 'terrain') continue;
      for (const cargo of world.salvage?.ships ?? []) {
        const source = world.lighthouses.find(l => l.id === cargo.from), target = world.lighthouses.find(l => l.id === cargo.to);
        const from = source && { ...source, position: shifted(source.position) };
        const to = target && from && { ...target, position: shifted(nearest(world, source!.position, target.position)) };
        if (!from || !to || !intersectsTile(from.position, to.position) || !isDiscovered(world, from.position)) continue;
        const graphic = new Graphics().poly([12, 0, -8, -6, -5, 0, -8, 6]).fill(cargo.cargo ? 0xf3b45c : 0xadc7d7).stroke({color: 0x081521, width: 2});
        shipLayer.addChild(graphic);
        ships.push({id: `cargo:${cargo.yard_id}`, graphic, from: from.position, to: to.position, offset: 0, cargo, safe: from.connected && to.connected && distance(world, from.position, to.position) <= from.effective_radius+to.effective_radius});
      }
      if (world.doctor) {
        const haven = world.islands.find(i => i.fuel_facility === 'haven');
        const target = world.lighthouses.find(l => l.id === world.doctor!.destination);
        if (haven && target && intersectsTile(shifted(haven.position), shifted(nearest(world, haven.position, target.position)))) {
          const graphic = new Graphics().poly([18, 0, -12, -9, -16, 0, -12, 9]).fill(0xeee5cc)
            .stroke({ color: 0x081521, width: 2 }).rect(-5, -6, 4, 12).fill(0xc74555).rect(-9, -2, 12, 4).fill(0xc74555);
          shipLayer.addChild(graphic);
          ships.push({ id: 'doctor', graphic, from: shifted(haven.position), to: shifted(nearest(world, haven.position, target.position)), offset: 0, doctor: world.doctor });
        }
      }
      const vessel = world.salvage?.vessel;
      const route = world.salvage?.vessel_route;
      if (vessel && route && intersectsTile(shifted(route[0]), shifted(route[1]))) {
        const graphic = new Graphics().poly([22, 0, 10, -10, -16, -10, -20, -5, -20, 5, -16, 10, 10, 10]).fill(vessel.cargo ? 0xf3b45c : 0xadc7d7)
          .stroke({ color: 0x081521, width: 2 }).rect(-9, -5, 12, 10).fill(0xeee5cc);
        shipLayer.addChild(graphic);
        ships.push({ id: 'vessel', graphic, from: shifted(route[0]), to: shifted(route[1]), offset: 0, vessel, travelSeconds: world.salvage!.rules.vessel.travel_seconds });
      }
      for (const voyage of world.voyages.ships) {
        const source = world.lighthouses.find(l => l.id === voyage.from), target = world.lighthouses.find(l => l.id === voyage.to);
        const from = source && { ...source, position: shifted(source.position) };
        const to = target && from && { ...target, position: shifted(nearest(world, source!.position, target.position)) };
        if (!from || !to || !intersectsTile(from.position, to.position) || !isDiscovered(world, from.position)) continue;
        const graphic = new Graphics().poly([14, 0, -9, -7, -7, 0, -9, 7]).fill(voyage.kind === 'mail' ? 0xb9d8ec : 0xe9c7a7)
          .stroke({ color: 0x081521, width: 2 });
        if (voyage.kind === 'mail') graphic.rect(-4, -4, 7, 8).fill(0xf4f1df);
        shipLayer.addChild(graphic);
        ships.push({ id: `voyage:${voyage.id}`, graphic, from: from.position, to: to.position, offset: 0, voyage, safe: from.connected && to.connected && distance(world, from.position, to.position) <= from.effective_radius + to.effective_radius });
      }
    }
  return { worldLayer, shipLayer, ships };
}

// Only fields consumed by the terrain pass belong here; simulation counters and
// ship progress must not invalidate the shared texture.
export function terrainKey(world: WorldState): string {
  return JSON.stringify([
    world.width, world.height, world.radius_max,
    world.islands.map(({ position, radius, name }) => [position, radius, name]),
    world.lighthouses.map(({ id, position, active, effective_radius, explored_radius, sick }) =>
      [id, position, active, effective_radius, explored_radius, sick]),
    world.shipping_links,
  ]);
}
