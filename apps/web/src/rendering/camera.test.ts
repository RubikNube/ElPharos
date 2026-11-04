import { describe, expect, it } from 'vitest';
import { fitWorld, MAX_ZOOM, MIN_ZOOM, zoomAt } from './camera';

describe('camera', () => {
  it('preserves the world point under the cursor while zooming', () => {
    const before = { x: -250, y: 80, zoom: 0.7 };
    const after = zoomAt(before, 320, 240, 1.5);
    expect((320 - after.x) / after.zoom).toBeCloseTo((320 - before.x) / before.zoom);
    expect((240 - after.y) / after.zoom).toBeCloseTo((240 - before.y) / before.zoom);
  });
  it('clamps zoom and centers the world when fitting', () => {
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 100).zoom).toBe(MAX_ZOOM);
    expect(zoomAt({ x: 0, y: 0, zoom: 1 }, 0, 0, 0.001).zoom).toBe(MIN_ZOOM);
    const camera = fitWorld(800, 600, 1600, 1000);
    expect(camera.x + 800 * camera.zoom).toBe(400);
    expect(camera.y + 500 * camera.zoom).toBe(300);
  });
});
