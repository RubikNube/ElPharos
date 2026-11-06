import type { Graphics } from 'pixi.js';
import type { WorldState } from '../protocol';
import { cargoSpeed } from '../shipping';

export type RenderShip = {
  id?: string;
  voyage?: WorldState['voyages']['ships'][number];
  legacy?: { from: string; to: string };
  graphic: Graphics;
  from: { x: number; y: number };
  to: { x: number; y: number };
  offset: number;
  doctor?: NonNullable<WorldState['doctor']>;
  vessel?: NonNullable<NonNullable<WorldState['salvage']>['vessel']>;
  travelSeconds?: number;
  cargo?: NonNullable<WorldState['salvage']>['ships'][number];
  safe?: boolean;
};

export function createShipAnimator(render: () => void) {
  let world: WorldState | null = null;
  let ships: RenderShip[] = [];
  let snapshotTime = 0;
  let animationFrame = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function positionShips(now: number) {
    const seconds = (world?.economy.elapsed_seconds ?? 0) +
      (world?.economy.paused || reducedMotion.matches ? 0 : (now - snapshotTime) / 1000);
    for (const ship of ships) {
      if (ship.doctor) {
        const elapsed = world?.economy.paused || reducedMotion.matches ? 0 : Math.min(1, Math.max(0, (now - snapshotTime) / 1000));
        const length = Math.hypot(ship.to.x - ship.from.x, ship.to.y - ship.from.y);
        const leg = Math.min(1, ship.doctor.progress + (length ? elapsed * (world?.doctor_rules.speed ?? 120) / length : 0));
        const progress = ship.doctor.returning ? 1 - leg : leg;
        ship.graphic.position.set(ship.from.x + (ship.to.x - ship.from.x) * progress, ship.from.y + (ship.to.y - ship.from.y) * progress);
        ship.graphic.rotation = Math.atan2(ship.to.y - ship.from.y, ship.to.x - ship.from.x) + (ship.doctor.returning ? Math.PI : 0);
        continue;
      }
      if (ship.vessel) {
        const v = ship.vessel;
        const moving = v.phase === 'outbound' || v.phase === 'returning';
        const elapsed = world?.economy.paused || reducedMotion.matches || !moving ? 0 : Math.min(1, Math.max(0, (now - snapshotTime) / 1000));
        const phaseProgress = Math.min(1, (v.timer + elapsed) / (ship.travelSeconds ?? 5));
        const progress = v.phase === 'docked' ? 0 : v.phase === 'searching' ? 1 : v.phase === 'returning' ? 1 - phaseProgress : phaseProgress;
        ship.graphic.position.set(ship.from.x + (ship.to.x - ship.from.x) * progress, ship.from.y + (ship.to.y - ship.from.y) * progress);
        ship.graphic.rotation = Math.atan2(ship.to.y - ship.from.y, ship.to.x - ship.from.x) + (v.phase === 'returning' ? Math.PI : 0);
        continue;
      }
      if (ship.cargo) {
        const elapsed = world?.economy.paused || reducedMotion.matches || !ship.safe ? 0 : Math.min(1, (now - snapshotTime) / 1000);
        const length = Math.hypot(ship.to.x-ship.from.x, ship.to.y-ship.from.y);
        const progress = Math.min(1, ship.cargo.progress + (length ? elapsed * (world ? cargoSpeed(world, ship.cargo.from, ship.cargo.to) : 60) / length : 0));
        ship.graphic.position.set(ship.from.x + (ship.to.x-ship.from.x)*progress, ship.from.y + (ship.to.y-ship.from.y)*progress);
        ship.graphic.rotation = Math.atan2(ship.to.y-ship.from.y, ship.to.x-ship.from.x);
        continue;
      }
      if (ship.voyage) {
        const elapsed = world?.economy.paused || reducedMotion.matches || !ship.safe ? 0 : Math.min(1, Math.max(0, (now - snapshotTime) / 1000));
        const length = Math.hypot(ship.to.x-ship.from.x, ship.to.y-ship.from.y);
        const progress = Math.min(1, ship.voyage.progress + (length ? elapsed * 75 / length : 0));
        ship.graphic.position.set(ship.from.x + (ship.to.x-ship.from.x)*progress, ship.from.y + (ship.to.y-ship.from.y)*progress);
        ship.graphic.rotation = Math.atan2(ship.to.y-ship.from.y, ship.to.x-ship.from.x);
        continue;
      }
      const phase = ((seconds / 16 + ship.offset) % 2);
      const progress = phase <= 1 ? phase : 2 - phase;
      ship.graphic.position.set(ship.from.x + (ship.to.x - ship.from.x) * progress,
        ship.from.y + (ship.to.y - ship.from.y) * progress);
      ship.graphic.rotation = Math.atan2(ship.to.y - ship.from.y, ship.to.x - ship.from.x) + (phase > 1 ? Math.PI : 0);
    }
  }
  let lastFrame = 0;
  function animate(now: number) {
    if (now - lastFrame >= 1000 / 30) {
      lastFrame = now;
      positionShips(now);
      render();
    }
    animationFrame = requestAnimationFrame(animate);
  }
  function updateAnimation() {
    cancelAnimationFrame(animationFrame);
    if (ships.length && !world?.economy.paused && !reducedMotion.matches) {
      animationFrame = requestAnimationFrame(animate);
    }
    positionShips(performance.now());
    render();
  }
  reducedMotion.addEventListener('change', updateAnimation);


  return {
    replaceShips(nextShips: RenderShip[]) {
      ships = nextShips;
      positionShips(performance.now());
    },
    update(next: WorldState | null, nextShips: RenderShip[]) {
      world = next;
      ships = nextShips;
      snapshotTime = performance.now();
      updateAnimation();
    },
    dispose() {
      cancelAnimationFrame(animationFrame);
      reducedMotion.removeEventListener('change', updateAnimation);
    },
  };
}
