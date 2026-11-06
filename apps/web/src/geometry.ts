export type Point = { x: number; y: number };
export type WorldSize = { width: number; height: number };
export function wrap(value: number, span: number) { return ((value % span) + span) % span; }
function delta(value: number, span: number) {
  const remainder = value % span;
  return Math.abs(remainder) > span / 2 ? remainder - Math.sign(remainder) * span : remainder;
}
export function displacement(world: WorldSize, from: Point, to: Point): Point {
  return { x: delta(to.x - from.x, world.width), y: delta(to.y - from.y, world.height) };
}
export function distance(world: WorldSize, a: Point, b: Point) {
  const d = displacement(world, a, b); return Math.hypot(d.x, d.y);
}
export function nearest(world: WorldSize, from: Point, to: Point): Point {
  const d = displacement(world, from, to); return { x: from.x + d.x, y: from.y + d.y };
}
// Include every periodic image whose center lies within these bounds.
export function images(world: WorldSize, point: Point, left: number, top: number, right: number, bottom: number): Point[] {
  const result: Point[] = [];
  for (let x = Math.ceil((left-point.x)/world.width); x <= Math.floor((right-point.x)/world.width); x++) {
    for (let y = Math.ceil((top-point.y)/world.height); y <= Math.floor((bottom-point.y)/world.height); y++) {
      result.push({ x: point.x+x*world.width, y: point.y+y*world.height });
    }
  }
  return result;
}
