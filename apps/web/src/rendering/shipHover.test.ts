import { expect, it } from 'vitest';
import type { RenderShip } from './shipAnimation';
import { shipAt } from './shipHover';

it('hits a moving ship at its current position in a wrapped tile', () => {
  const ship = { id: 'voyage:7', graphic: { position: { x: 20, y: 30 } } } as RenderShip;
  const tiles = [{ x: 1000, y: 0, ships: [ship] }];
  const camera = { x: -500, y: 0, zoom: 2 };
  const bounds = { left: 10, top: 20 };
  expect(shipAt(tiles, camera, bounds, 1550, 80)).toEqual({ id: 'voyage:7', x: 1540, y: 60 });
  ship.graphic.position.x = 80;
  expect(shipAt(tiles, camera, bounds, 1550, 80)).toBeNull();
  expect(shipAt(tiles, camera, bounds, 1670, 80)).toEqual({ id: 'voyage:7', x: 1660, y: 60 });
});
