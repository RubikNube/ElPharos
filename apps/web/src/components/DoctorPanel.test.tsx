import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { DoctorPanel, doctorBlockedReason } from './DoctorPanel';
import { researchWorldFixture } from '../research.fixture';
import { worldCommands } from '../network/commands';
import { PROTOCOL_VERSION, worldSchema } from '../protocol';
import { isDiscovered, isIlluminated } from '../rendering/visibility';
import { isNetworkIlluminated } from '../state/worldQueries';

function fixture() {
  const world = researchWorldFixture();
  world.lighthouses = [{ id: 'patient', island_id: 'island-2', name: 'Amber Light', position: { x: 1250, y: 650 }, radius: 400, effective_radius: 300, active: true, explored_radius: 400, sick: true, immune_until: 300, visited: true, secured: false, specialization: null, connected: false, fuel_upkeep: 1.5, next_fuel_upkeep: 1.75 }];
  return world;
}

it('allows treatment of isolated keepers and explains availability and voyage status', () => {
  const world = fixture(), light = world.lighthouses[0];
  const send = vi.fn(), commands = worldCommands(send);
  const html = (connected = true) => renderToStaticMarkup(<DoctorPanel world={world} light={light} connected={connected} commands={commands} />);
  expect(html()).toContain('<button>Send doctor — 40 fuel');
  expect(html()).toContain('reduced by 25%');
  expect(html(false)).toContain('Reconnect to send the doctor.');
  world.economy.fuel = 39.75;
  expect(html()).toContain('<button disabled="">');
  expect(doctorBlockedReason(world, light, true)).toContain('Not enough fuel');
  world.economy.fuel = 40;
  expect(doctorBlockedReason(world, light, true)).toBeNull();
  commands.sendDoctor(light.id);
  expect(send).toHaveBeenCalledWith({ type: 'send_doctor', protocol_version: PROTOCOL_VERSION, lighthouse_id: light.id });
  world.doctor = { destination: light.id, returning: false, progress: 0.5 };
  expect(html()).toContain('outbound to Amber Light');
  expect(html()).toContain('Doctor is on the way.');
  world.doctor.returning = true;
  light.sick = false;
  expect(html()).toContain('returning from Amber Light');
  expect(html()).not.toContain('<button');
});

it('uses reduced coverage while preserving discovery and validates doctor snapshots', () => {
  const world = fixture(), light = world.lighthouses[0];
  const point = { x: 1600, y: 650 };
  light.connected = true;
  expect(isDiscovered(world, point)).toBe(true);
  expect(isIlluminated(world, point)).toBe(false);
  expect(isNetworkIlluminated(world, point)).toBe(false);
  world.doctor = { destination: light.id, returning: false, progress: 0.5 };
  expect(worldSchema.safeParse(world).success).toBe(true);
  light.effective_radius = 400;
  expect(worldSchema.safeParse(world).success).toBe(false);
  light.sick = false;
  expect(worldSchema.safeParse(world).success).toBe(false);
  world.doctor.returning = true;
  expect(worldSchema.safeParse(world).success).toBe(true);
  world.doctor.progress = 1;
  expect(worldSchema.safeParse(world).success).toBe(false);
});
