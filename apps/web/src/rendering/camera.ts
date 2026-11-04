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
