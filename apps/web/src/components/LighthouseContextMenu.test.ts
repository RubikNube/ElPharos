import { expect, it, vi } from 'vitest';
import { lighthouseActions } from './LighthouseContextMenu';
import { researchWorldFixture } from '../research.fixture';
import { worldCommands } from '../network/commands';

function fixture() {
  const world = researchWorldFixture();
  world.lighthouses = [{ id: 'beacon-2', island_id: 'island-2', name: 'Amber Light', position: { x: 1250, y: 650 }, radius: 290, effective_radius: 290, active: true, explored_radius: 290, sick: true, immune_until: 300, specialization: null, connected: true, fuel_upkeep: 1, next_fuel_upkeep: 1.25 }];
  world.islands[0].position = world.lighthouses[0].position;
  world.salvage!.yards = [{ island_id: 'island-2', restored: false, stock: 0, period: 4, timer: 0, delivered: false }];
  return world;
}

it('routes lighthouse and island actions to the chosen target', () => {
  const world = fixture();
  const send = vi.fn();
  const actions = lighthouseActions(world, 'beacon-2', true, worldCommands(send));
  expect(actions.map(action => action.label)).toEqual(expect.arrayContaining([
    'Extinguish beacon', 'Expand radius (+60) — 20 Salvage', 'Install: Efficient lamp — 40 Salvage',
    'Send doctor — 40 fuel', 'Restore salvage yard — 120 fuel + 40 Salvage', 'Restore fuel facility — 120 fuel',
  ]));
  for (const action of actions) {
    expect(action.reason).toBeFalsy();
    action.run();
  }
  expect(send.mock.calls.map(([message]) => message.type)).toEqual([
    'set_lighthouse_active', 'expand_lighthouse_radius', 'set_lighthouse_specialization',
    'set_lighthouse_specialization', 'send_doctor', 'restore_salvage_yard', 'restore_fuel_facility',
  ]);
  expect(send.mock.calls[0][0]).toMatchObject({ lighthouse_id: 'beacon-2', active: false });
  expect(send.mock.calls.at(-1)?.[0]).toMatchObject({ island_id: 'island-2' });
});

it('updates blocked actions from live resources and connection state', () => {
  const world = fixture();
  const commands = worldCommands(vi.fn());
  world.economy.fuel = 0;
  world.salvage!.reserve = 0;
  let actions = lighthouseActions(world, 'beacon-2', true, commands);
  expect(actions.find(action => action.label.startsWith('Expand'))?.reason).toBe('Not enough Salvage.');
  expect(actions.find(action => action.label.startsWith('Send doctor'))?.reason).toContain('Not enough fuel');
  expect(actions.find(action => action.label.startsWith('Restore fuel'))?.reason).toContain('Not enough fuel');
  actions = lighthouseActions(world, 'beacon-2', false, commands);
  expect(actions.every(action => !!action.reason)).toBe(true);
  world.salvage!.reserve = 100;
  world.economy.fuel = 300;
  world.lighthouses[0].sick = false;
  world.lighthouses[0].effective_radius = 290;
  actions = lighthouseActions(world, 'beacon-2', true, commands);
  expect(actions.some(action => action.label.startsWith('Send doctor'))).toBe(false);
  expect(actions.find(action => action.label.startsWith('Expand'))?.reason).toBeFalsy();
});
