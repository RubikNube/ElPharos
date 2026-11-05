import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serverMessageSchema } from '../apps/web/src/protocol.ts';

test('actual Rust snapshots and responses satisfy the frontend schema', () => {
  const output = execFileSync('cargo', ['run', '--quiet', '--locked', '--offline', '-p', 'el-pharos-server', '--example', 'contract_snapshots'], { encoding: 'utf8', timeout: 60000 });
  const messages = JSON.parse(output);
  assert.equal(messages.length, 10);
  for (const message of messages) serverMessageSchema.parse(message);
  const worlds = messages.filter(message => message.type === 'world_snapshot').map(message => message.world);
  assert.ok(worlds[5].islands.length >= 6 && worlds[5].islands.length <= 12);
  assert.equal(worlds[5].lighthouses.length, worlds[5].islands.length);
  assert.equal(worlds[6].lighthouses[1].sick, true);
  assert.equal(worlds[6].lighthouses[1].effective_radius, 217.5);
  assert.equal(worlds[6].doctor.destination, 'beacon-2');
  assert.equal(worlds[7].doctor.returning, true);
  assert.equal(worlds[7].lighthouses[1].effective_radius, 290);
  assert.equal(worlds[1].salvage, null);
  assert.equal(worlds[2].salvage.ships[0].cargo, 30);
  assert.equal(worlds[2].economy.restored_facility_production, 4);
  assert.equal(worlds[2].salvage.vessel.phase, 'searching');
  assert.equal(worlds[2].salvage.vessel.cargo, 3);
  assert.equal(worlds[2].salvage.vessel_route.length, 2);
  assert.equal(worlds[3].economy.paused, true);
  assert.equal(worlds[4].economy.blackout, true);
});
