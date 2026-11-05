import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serverMessageSchema } from '../apps/web/src/protocol.ts';

test('actual Rust snapshots and responses satisfy the frontend schema', () => {
  const output = execFileSync('cargo', ['run', '--quiet', '--locked', '--offline', '-p', 'el-pharos-server', '--example', 'contract_snapshots'], { encoding: 'utf8', timeout: 60000 });
  const messages = JSON.parse(output);
  assert.equal(messages.length, 7);
  for (const message of messages) serverMessageSchema.parse(message);
  const worlds = messages.filter(message => message.type === 'world_snapshot').map(message => message.world);
  assert.equal(worlds[1].salvage, null);
  assert.equal(worlds[2].salvage.ships[0].cargo, 30);
  assert.equal(worlds[2].economy.restored_facility_production, 4);
  assert.equal(worlds[3].economy.paused, true);
  assert.equal(worlds[4].economy.blackout, true);
});
