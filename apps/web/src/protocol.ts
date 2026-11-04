import { z } from 'zod';

const point = z.object({ x: z.number(), y: z.number() });
const island = z.object({
  id: z.string().min(1), name: z.string(), position: point, radius: z.number().positive(),
});
const lighthouse = island.extend({ island_id: z.string(), active: z.boolean() });
export const worldSchema = z.object({
  revision: z.number().int().nonnegative(),
  width: z.number().positive(), height: z.number().positive(),
  islands: z.array(island), lighthouses: z.array(lighthouse),
});
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('world_snapshot'), protocol_version: z.literal(1), world: worldSchema }),
  z.object({ type: z.literal('error'), protocol_version: z.literal(1), message: z.string() }),
]);
export type WorldState = z.infer<typeof worldSchema>;
export type ClientMessage = {
  type: 'set_lighthouse_active'; protocol_version: 1; lighthouse_id: string; active: boolean;
};
