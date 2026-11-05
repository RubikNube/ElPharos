import { isDiscovered } from './visibility';
import { Application, Container, Graphics, Text } from 'pixi.js';
import { cargoSpeed, type WorldState } from '../protocol';
import { useWorldStore } from '../state/worldStore';
import { fitWorld, zoomAt, type Camera } from './camera';

export async function createScene(host: HTMLDivElement, signal: AbortSignal) {
  const app = new Application();
  await app.init({
    width: host.clientWidth, height: host.clientHeight,
    background: '#081521', antialias: true, autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: 'webgl', autoStart: false,
  });
  if (signal.aborted) { app.destroy(true, { children: true }); return null; }
  host.appendChild(app.canvas);
  let worldLayer = new Container({ isRenderGroup: true });
  app.stage.addChild(worldLayer);
  let world: WorldState | null = null;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let fitted = false;
  let ships: { graphic: Graphics; from: { x: number; y: number }; to: { x: number; y: number }; offset: number; cargo?: NonNullable<WorldState['salvage']>['ships'][number]; safe?: boolean }[] = [];
  let animationFrame = 0;
  let snapshotTime = performance.now();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function positionShips(now: number) {
    const seconds = (world?.economy.elapsed_seconds ?? 0) +
      (world?.economy.paused || reducedMotion.matches ? 0 : (now - snapshotTime) / 1000);
    for (const ship of ships) {
      if (ship.cargo) {
        const elapsed = world?.economy.paused || reducedMotion.matches || !ship.safe ? 0 : Math.min(1, (now - snapshotTime) / 1000);
        const length = Math.hypot(ship.to.x-ship.from.x, ship.to.y-ship.from.y);
        const progress = Math.min(1, ship.cargo.progress + (length ? elapsed * (world ? cargoSpeed(world, ship.cargo.from, ship.cargo.to) : 60) / length : 0));
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

  function render() {
    worldLayer.position.set(camera.x, camera.y);
    worldLayer.scale.set(camera.zoom);
    app.render();
  }
  function reset() {
    if (world) camera = fitWorld(app.screen.width, app.screen.height, world.width, world.height);
    render();
  }
  function zoom(factor: number, x = app.screen.width / 2, y = app.screen.height / 2) {
    camera = zoomAt(camera, x, y, factor);
    render();
  }
  function draw(next: WorldState | null) {
    world = next;
    snapshotTime = performance.now();
    ships = [];
    cancelAnimationFrame(animationFrame);
    app.stage.removeChild(worldLayer);
    worldLayer.destroy({ children: true });
    worldLayer = new Container({ isRenderGroup: true });
    app.stage.addChild(worldLayer);
    if (!world) { render(); return; }
    const nextWorld = world;
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
    const selected = world.lighthouses.find(light => light.id === useWorldStore.getState().selectedId && isDiscovered(nextWorld, light.position));
    if (selected) worldLayer.addChild(new Graphics().circle(selected.position.x, selected.position.y, 45).stroke({ color: 0xffffff, width: 3 }));
    if (selected && selected.radius < world.radius_max) {
      const radius = Math.min(world.radius_max, selected.radius + world.radius_step);
      worldLayer.addChild(new Graphics().circle(selected.position.x, selected.position.y, radius).stroke({color: 0x9ae6d1, width: 2, alpha: 0.65}));
      for (const island of world.islands) {
        const distance = Math.hypot(island.position.x-selected.position.x, island.position.y-selected.position.y);
        if (isDiscovered(world, island.position) && distance > selected.radius && distance <= radius) worldLayer.addChild(new Graphics().circle(island.position.x, island.position.y, island.radius+8).stroke({color: 0x9ae6d1, width: 3}));
      }
    }
    if (!fitted) { fitted = true; reset(); }
    updateAnimation();
  }

  let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || drag) return;
    host.focus();
    host.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
    host.classList.add('dragging');
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    camera.x += event.clientX - drag.x;
    camera.y += event.clientY - drag.y;
    drag.x = event.clientX; drag.y = event.clientY;
    render();
  };
  const up = (event: PointerEvent) => {
    if (drag?.id !== event.pointerId) return;
    if (event.type === 'pointerup' && !drag.moved && world) {
      const bounds = host.getBoundingClientRect();
      const x = (event.clientX - bounds.left - camera.x) / camera.zoom;
      const y = (event.clientY - bounds.top - camera.y) / camera.zoom;
      const hit = [...world.lighthouses].reverse().find(light => isDiscovered(world!, light.position) && Math.hypot(light.position.x - x, light.position.y - y) <= 45);
      useWorldStore.setState({ selectedId: hit?.id ?? null });
    }
    drag = null;
    if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
    host.classList.remove('dragging');
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const bounds = host.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? host.clientHeight : 1);
    zoom(Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.0015), event.clientX - bounds.left, event.clientY - bounds.top);
  };
  const key = (event: KeyboardEvent) => {
    const shifts: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (shifts[event.key]) {
      event.preventDefault();
      const [x, y] = shifts[event.key]; camera.x += x; camera.y += y; render();
    } else if (['+', '=', '-', '0'].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') reset(); else zoom(event.key === '-' ? 0.8 : 1.25);
    }
  };
  host.addEventListener('pointerdown', down);
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', up);
  host.addEventListener('lostpointercapture', up);
  host.addEventListener('wheel', wheel, { passive: false });
  host.addEventListener('keydown', key);
  const observer = new ResizeObserver(() => {
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    camera.x += (width - app.screen.width) / 2;
    camera.y += (height - app.screen.height) / 2;
    app.renderer.resize(width, height); render();
  });
  observer.observe(host);
  const unsubscribe = useWorldStore.subscribe((state, previous) => {
    if (state.world !== previous.world || state.selectedId !== previous.selectedId) draw(state.world);
  });
  draw(useWorldStore.getState().world);
  return {
    reset, zoom,
    dispose() {
      cancelAnimationFrame(animationFrame);
      reducedMotion.removeEventListener('change', updateAnimation);
      unsubscribe(); observer.disconnect();
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', up);
      host.removeEventListener('lostpointercapture', up);
      host.removeEventListener('wheel', wheel);
      host.removeEventListener('keydown', key);
      app.destroy(true, { children: true });
    },
  };
}
