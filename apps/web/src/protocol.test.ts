import { expect, it } from 'vitest';
import { serverMessageSchema } from './protocol';

it('rejects incompatible protocol versions and invalid geometry', () => {
  expect(serverMessageSchema.safeParse({ type: 'error', protocol_version: 99, message: 'test' }).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'world_snapshot', protocol_version: 2, world: {
    revision: 0, width: -1, height: 100, islands: [], lighthouses: [],
  } }).success).toBe(false);
  expect(serverMessageSchema.safeParse({ type: 'error', protocol_version: 2, message: 'Unknown lighthouse' }).success).toBe(true);
});
