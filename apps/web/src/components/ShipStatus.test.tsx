import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { researchWorldFixture } from '../research.fixture';
import { ShipStatus } from './ShipStatus';

it('shows ambient voyage status and its stable story message', () => {
  const world = researchWorldFixture();
  world.lighthouses = ['First Light', 'Amber Light'].map((name, i) => ({
    id: `beacon-${i}`, island_id: `island-${i}`, name, position: { x: 100 + i * 100, y: 100 },
    radius: 290, effective_radius: 290, explored_radius: 290, active: true, connected: true,
    sick: false, immune_until: 300, visited: true, secured: false, specialization: null, fuel_upkeep: 1, next_fuel_upkeep: 1.25,
  }));
  world.shipping_links = [{ from: 'beacon-0', to: 'beacon-1' }];
  const ship = { id: 1, kind: 'mail' as const, message_id: 0, origin: 'beacon-0', destination: 'beacon-1', from: 'beacon-0', to: 'beacon-1', progress: 0.5, phase: 'outbound' as const, visit_timer: 0 };
  world.voyages.ships = [ship];
  const html = () => renderToStaticMarkup(<ShipStatus world={world} id="voyage:1" />);
  expect(html()).toContain('Delivering mail');
  expect(html()).toContain('Dear neighbor');
  world.shipping_links = [];
  expect(html()).toContain('Waiting for a safe route');
  world.economy.paused = true;
  expect(html()).toContain('Paused');
  world.economy.paused = false;
  world.voyages.ships = [{ ...ship, kind: 'family', phase: 'visiting', from: 'beacon-1', to: 'beacon-1', progress: 0 }];
  expect(html()).toContain('Visiting the keeper');
  expect(html()).toContain('family visiting');
});

it('shows a status and message for existing ship types', () => {
  const world = researchWorldFixture();
  const html = (id: string) => renderToStaticMarkup(<ShipStatus world={world} id={id} />);
  world.doctor = { destination: 'beacon-2', returning: false, progress: 0.2 };
  expect(html('doctor')).toContain('Sailing to');
  expect(html('doctor')).toContain('blockquote');
  world.salvage!.vessel = { enabled: true, phase: 'searching', timer: 2, cargo: 1 };
  expect(html('vessel')).toContain('Searching for Salvage');
  world.salvage!.ships = [{ yard_id: 'island-5', from: 'beacon-1', to: 'beacon-1', progress: 0, cargo: 0, returning: false, route: [] }];
  expect(html('cargo:island-5')).toContain('Cargo ship');
  expect(html('cargo:island-5')).toContain('Awaiting route');
  world.shipping_links = [{ from: 'beacon-1', to: 'beacon-2' }];
  expect(html('legacy:beacon-1:beacon-2')).toContain('Passing ship');
});
