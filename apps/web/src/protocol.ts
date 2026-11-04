import { z } from 'zod';

const point = z.object({ x: z.number(), y: z.number() });
const island = z.object({
  id: z.string().min(1), name: z.string(), position: point, radius: z.number().positive(),
});
const quarter = z.number().nonnegative().multipleOf(0.25);
const lighthouse = island.extend({ fuel_upkeep: quarter.min(1).max(2.5), next_fuel_upkeep: quarter.min(1).max(2.5).nullable(), island_id: z.string(), active: z.boolean(), explored_radius: z.number().nonnegative() });
export const worldSchema = z.object({
  economy: z.object({ fuel: quarter.max(600), capacity: z.literal(600), production: z.literal(2), beacon_upkeep: z.literal(1), elapsed_seconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), paused: z.boolean(), blackout: z.boolean() }),
  radius_step: z.number().positive(), radius_max: z.number().positive(),
  revision: z.number().int().nonnegative(),
  width: z.number().positive(), height: z.number().positive(),
  islands: z.array(island), lighthouses: z.array(lighthouse),
});
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command_result'), protocol_version: z.literal(4), request_id: z.string(), success: z.boolean(), message: z.string() }),
  z.object({ type: z.literal('world_snapshot'), protocol_version: z.literal(4), world: worldSchema }),
  z.object({ type: z.literal('error'), protocol_version: z.literal(4), message: z.string() }),
]);
export type WorldState = z.infer<typeof worldSchema>;
export type ClientMessage = { type: 'set_simulation_paused'; protocol_version: 4; paused: boolean } | { type: 'save_game' | 'load_game'; protocol_version: 4; request_id: string } | { type: 'expand_lighthouse_radius'; protocol_version: 4; lighthouse_id: string } | {
  type: 'set_lighthouse_active'; protocol_version: 4; lighthouse_id: string; active: boolean;
};
