import { z } from 'zod';

const point = z.object({ x: z.number(), y: z.number() });
const island = z.object({
  id: z.string().min(1), name: z.string(), position: point, radius: z.number().positive(),
});
const quarter = z.number().nonnegative().multipleOf(0.25);
const lighthouse = island.extend({ specialization: z.enum(["efficient_lamp", "navigation_beacon"]).nullable(), connected: z.boolean(), fuel_upkeep: quarter.min(0.5).max(2.5), next_fuel_upkeep: quarter.min(0.5).max(2.5).nullable(), island_id: z.string(), active: z.boolean(), explored_radius: z.number().nonnegative() });
export const worldSchema = z.object({
  salvage: z.object({ rules: z.object({ specialization_cost: z.number().int().positive(), refit_cost: z.number().int().positive(), efficiency_saving: quarter, navigation_multiplier: z.number().positive(), capacity: z.number().int().positive(), expand_cost: z.number().int().positive(), restore_cost: z.number().int().positive(), restore_fuel: z.number().positive(), speed: z.number().positive(), hold: z.number().int().positive(), local_capacity: z.number().int().positive(), haven_period: z.number().int().positive() }), reserve: z.number().int().min(0).max(300), haven_timer: z.number().int().min(0).max(9),
    yards: z.array(z.object({ island_id: z.string(), period: z.union([z.literal(2), z.literal(4)]), restored: z.boolean(), stock: z.number().int().min(0).max(60), timer: z.number().int().min(0).max(3), delivered: z.boolean() })),
    ships: z.array(z.object({ yard_id: z.string(), from: z.string(), to: z.string(), progress: z.number().min(0).lt(1), cargo: z.number().int().min(0).max(20), returning: z.boolean(), route: z.array(z.string()) })),
  }).nullable(),
  objective_complete: z.boolean(),
  shipping_links: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
  economy: z.object({ fuel: quarter.max(600), capacity: z.literal(600), production: z.number().int().min(2).max(299), facility_restore_cost: z.literal(120), beacon_upkeep: z.literal(1), elapsed_seconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), paused: z.boolean(), blackout: z.boolean() }),
  radius_step: z.number().positive(), radius_max: z.number().positive(),
  revision: z.number().int().nonnegative(),
  width: z.number().positive(), height: z.number().positive(),
  islands: z.array(island.extend({ fuel_facility: z.enum(['haven', 'ruined', 'restored', 'none']), fuel_production: z.union([z.literal(0), z.literal(2), z.literal(3)]) })), lighthouses: z.array(lighthouse),
});
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command_result'), protocol_version: z.literal(8), request_id: z.string(), success: z.boolean(), message: z.string() }),
  z.object({ type: z.literal('world_snapshot'), protocol_version: z.literal(8), world: worldSchema }),
  z.object({ type: z.literal('error'), protocol_version: z.literal(8), message: z.string() }),
]);
export type WorldState = z.infer<typeof worldSchema>;
export type ClientMessage = { type: 'set_lighthouse_specialization'; protocol_version: 8; lighthouse_id: string; specialization: 'efficient_lamp' | 'navigation_beacon' } | { type: 'restore_salvage_yard'; protocol_version: 8; island_id: string } | { type: 'restore_fuel_facility'; protocol_version: 8; island_id: string } | { type: 'set_simulation_paused'; protocol_version: 8; paused: boolean } | { type: 'save_game' | 'load_game'; protocol_version: 8; request_id: string } | { type: 'expand_lighthouse_radius'; protocol_version: 8; lighthouse_id: string } | {
  type: 'set_lighthouse_active'; protocol_version: 8; lighthouse_id: string; active: boolean;
};

export function cargoSpeed(world: WorldState, from: string, to: string): number {
  const rules = world.salvage?.rules;
  const boosted = world.lighthouses.some(l => (l.id === from || l.id === to) && l.specialization === 'navigation_beacon');
  return (rules?.speed ?? 60) * (boosted ? rules?.navigation_multiplier ?? 1 : 1);
}
