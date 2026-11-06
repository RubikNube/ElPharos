export type Camera = { x: number; y: number; zoom: number };
export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export function zoomAt(camera: Camera, x: number, y: number, factor: number): Camera {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
  const ratio = zoom / camera.zoom;
  return { x: x - (x - camera.x) * ratio, y: y - (y - camera.y) * ratio, zoom };
}

export function fitWorld(width: number, height: number, worldWidth: number, worldHeight: number): Camera {
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(width / worldWidth, height / worldHeight) * 0.9));
  return { x: (width - worldWidth * zoom) / 2, y: (height - worldHeight * zoom) / 2, zoom };
}

export function normalizeCamera(camera: Camera, world: { width: number; height: number }): Camera {
  const normalize = (value: number, span: number) => ((value % span) + span) % span - span;
  return { ...camera, x: normalize(camera.x, world.width*camera.zoom), y: normalize(camera.y, world.height*camera.zoom) };
}
export function visibleTiles(camera: Camera, width: number, height: number, world: { width: number; height: number }) {
  const tiles: { x: number; y: number }[] = [];
  const left = -camera.x/camera.zoom, top = -camera.y/camera.zoom;
  for (let x = Math.floor(left/world.width); x < Math.ceil((left+width/camera.zoom)/world.width); x++) {
    for (let y = Math.floor(top/world.height); y < Math.ceil((top+height/camera.zoom)/world.height); y++) tiles.push({ x, y });
  }
  return tiles;
}
export function focusHaven(width: number, height: number, world: import('../protocol').WorldState): Camera {
  const haven = world.islands.find(island => island.fuel_facility === 'haven');
  const light = world.lighthouses.find(light => light.island_id === haven?.id) ?? world.lighthouses[0];
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(width, height)/800));
  return { x: width/2 - (light?.position.x ?? 0)*zoom, y: height/2 - (light?.position.y ?? 0)*zoom, zoom };
}
