import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SalvageVesselPanel, vesselStatus } from './SalvageVesselPanel';
import { researchWorldFixture } from '../research.fixture';
import { worldCommands } from '../network/commands';
import { PROTOCOL_VERSION } from '../protocol';

it('shows build cost and disables construction when offline, unaffordable, or no route exists', () => {
  const world = researchWorldFixture();
  const commands = worldCommands(vi.fn());
  const html = (connected = true) => renderToStaticMarkup(<SalvageVesselPanel world={world} connected={connected} commands={commands} />);
  expect(html()).toContain('No nearby water route available.');
  world.salvage!.vessel_route = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  expect(html()).toMatch(/<button>Build salvage vessel — 200 fuel/);
  expect(html(false)).toContain('Reconnect to build.');
  world.economy.fuel = 199;
  expect(html()).toMatch(/<button disabled="">Build salvage vessel/);
  expect(html()).toContain('Not enough fuel to build.');
  world.salvage = null;
  expect(html()).toBe('');
});

it('explains expedition progress, waiting conditions, pause, and automation', () => {
  const world = researchWorldFixture();
  const s = world.salvage!;
  s.vessel = { enabled: true, phase: 'docked', timer: 0, cargo: 0 };
  const v = s.vessel;
  expect(vesselStatus(world)).toBe('Ready to depart');
  world.economy.fuel = 239.75;
  expect(vesselStatus(world)).toBe('Waiting for 240 fuel');
  s.reserve = 261;
  expect(vesselStatus(world)).toBe('Waiting for 40 free Salvage storage');
  v.enabled = false;
  expect(vesselStatus(world)).toBe('Automatic expeditions disabled');
  v.cargo = 12;
  expect(vesselStatus(world)).toBe('Waiting for reserve space to unload');
  v.phase = 'outbound'; v.timer = 2;
  expect(vesselStatus(world)).toContain('3s');
  v.phase = 'searching'; v.timer = 20; v.cargo = 10;
  expect(vesselStatus(world)).toBe('Searching · 60s until full');
  v.phase = 'returning'; v.timer = 4; v.cargo = 40;
  expect(vesselStatus(world)).toContain('Returning to First Haven · 1s');
  const html = renderToStaticMarkup(<SalvageVesselPanel world={world} connected={false} commands={worldCommands(vi.fn())} />);
  expect(html).toContain('Cargo: 40/40');
  expect(html).toMatch(/<button disabled="" aria-pressed="false">Enable automatic expeditions/);
  expect(html).toContain('Stopping finishes the current trip.');
  world.economy.paused = true;
  expect(vesselStatus(world)).toBe('Paused');
});

it('sends versioned construction and automation commands', () => {
  const send = vi.fn(), commands = worldCommands(send);
  commands.buildSalvageVessel();
  commands.setSalvageVesselEnabled(false);
  expect(send.mock.calls).toEqual([
    [{ type: 'build_salvage_vessel', protocol_version: PROTOCOL_VERSION }],
    [{ type: 'set_salvage_vessel_enabled', protocol_version: PROTOCOL_VERSION, enabled: false }],
  ]);
});
