import { z } from 'zod';

export const PROTOCOL_VERSION = 13;

const point = z.object({ x: z.number(), y: z.number() });
const island = z.object({
  id: z.string().min(1), name: z.string(), position: point, radius: z.number().positive(),
});
const quarter = z.number().nonnegative().multipleOf(0.25);
const lighthouse = island.extend({ sick: z.boolean(), immune_until: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), effective_radius: z.number().positive(), specialization: z.enum(["efficient_lamp", "navigation_beacon"]).nullable(), connected: z.boolean(), fuel_upkeep: quarter.min(0.25).max(2.5), next_fuel_upkeep: quarter.min(0.25).max(2.5).nullable(), island_id: z.string(), active: z.boolean(), explored_radius: z.number().nonnegative() });
export const technologyIdSchema = z.enum(['reinforced_foundations', 'modular_fittings', 'streamlined_hulls', 'expanded_holds', 'precision_lenses', 'improved_refining']);
export type TechnologyId = z.infer<typeof technologyIdSchema>;
const researchSchema = z.object({
  completed: z.array(technologyIdSchema).max(6),
  catalog: z.array(z.object({
    id: technologyIdSchema, name: z.string().min(1), island_id: z.string().min(1),
    prerequisite: technologyIdSchema.nullable(), cost: z.number().int().positive(), effect: z.string().min(1),
    discovered: z.boolean(), available: z.boolean(), blocked_reason: z.string().nullable(),
  })).length(6),
}).superRefine((research, ctx) => {
  if (new Set(research.completed).size !== research.completed.length || new Set(research.catalog.map(t => t.id)).size !== 6) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate research IDs' });
  }
  for (const tech of research.catalog) {
    const completed = research.completed.includes(tech.id);
    if ((completed && (!tech.discovered || (tech.prerequisite && !research.completed.includes(tech.prerequisite)))) ||
      (tech.available && (completed || !tech.discovered || tech.blocked_reason !== null || (tech.prerequisite && !research.completed.includes(tech.prerequisite))))) {
      ctx.addIssue({ code: 'custom', message: 'Invalid research availability or prerequisites' });
    }
  }
});
export const vesselRulesSchema = z.object({
  build_fuel: z.number().int().positive(), trip_fuel: z.number().int().positive(),
  fuel_reserve: z.number().int().nonnegative(), hold: z.number().int().positive(),
  travel_seconds: z.number().int().positive(), salvage_period: z.number().int().positive(),
});
const vesselSchema = z.object({ enabled: z.boolean(), phase: z.enum(['docked', 'outbound', 'searching', 'returning']), timer: z.number().int().nonnegative(), cargo: z.number().int().nonnegative() });
export const worldSchema = z.object({
  voyages: z.object({ next_id: z.number().int().positive(), spawn_in: z.number().int().min(0).max(60), ships: z.array(z.object({ id: z.number().int().positive(), kind: z.enum(['family', 'mail']), message_id: z.number().int().min(0).max(5), origin: z.string(), destination: z.string(), from: z.string(), to: z.string(), progress: z.number().min(0).lt(1), phase: z.enum(['outbound', 'visiting', 'returning']), visit_timer: z.number().int().min(0).max(5) })).max(2) }),
  doctor: z.object({ destination: z.string().min(1), returning: z.boolean(), progress: z.number().min(0).lt(1) }).nullable(),
  doctor_rules: z.object({ trip_fuel: z.literal(40), speed: z.literal(120) }),
  research: researchSchema.nullable(),
  salvage: z.object({ vessel: vesselSchema.nullable(), vessel_route: z.tuple([point, point]).nullable(), rules: z.object({ vessel: vesselRulesSchema, specialization_cost: z.number().int().positive(), refit_cost: z.number().int().positive(), efficiency_saving: quarter, navigation_multiplier: z.number().positive(), capacity: z.number().int().positive(), expand_cost: z.number().int().positive(), restore_cost: z.number().int().positive(), restore_fuel: z.number().positive(), speed: z.number().positive(), hold: z.number().int().positive(), local_capacity: z.number().int().positive(), haven_period: z.number().int().positive() }), reserve: z.number().int().min(0).max(300), haven_timer: z.number().int().min(0).max(9),
    yards: z.array(z.object({ island_id: z.string(), period: z.union([z.literal(2), z.literal(4)]), restored: z.boolean(), stock: z.number().int().min(0).max(60), timer: z.number().int().min(0).max(3), delivered: z.boolean() })),
    ships: z.array(z.object({ yard_id: z.string(), from: z.string(), to: z.string(), progress: z.number().min(0).lt(1), cargo: z.number().int().min(0).max(30), returning: z.boolean(), route: z.array(z.string()) })),
  }).nullable(),
  objective_complete: z.boolean(),
  shipping_links: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })),
  economy: z.object({ fuel: quarter.max(600), capacity: z.literal(600), production: z.number().int().min(2).max(398), facility_restore_cost: z.literal(120), restored_facility_production: z.union([z.literal(3), z.literal(4)]), beacon_upkeep: z.literal(1), elapsed_seconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), paused: z.boolean(), blackout: z.boolean() }),
  radius_step: z.number().positive(), radius_max: z.number().positive(),
  revision: z.number().int().nonnegative(),
  width: z.number().positive(), height: z.number().positive(),
  islands: z.array(island.extend({ fuel_facility: z.enum(['haven', 'ruined', 'restored', 'none']), fuel_production: z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4)]) })), lighthouses: z.array(lighthouse),
}).superRefine((world, ctx) => {
  for (const light of world.lighthouses) {
    if (light.effective_radius !== light.radius * (light.sick ? 0.75 : 1) || light.explored_radius > light.radius || (light.active && light.explored_radius < light.effective_radius)) ctx.addIssue({ code: 'custom', message: 'Invalid effective radius or exploration' });
  }
  if (world.doctor) {
    const target = world.lighthouses.find(l => l.id === world.doctor!.destination);
    if (!target || (!world.doctor.returning && !target.sick) || world.islands.some(i => i.id === target?.island_id && i.fuel_facility === 'haven')) ctx.addIssue({ code: 'custom', message: 'Invalid doctor destination' });
  }
  const v = world.salvage?.vessel, r = world.salvage?.rules.vessel;
  if (v && r) {
    const valid = v.cargo <= r.hold && !!world.salvage?.vessel_route && (
      v.phase === 'docked' ? v.timer === 0 :
      v.phase === 'outbound' ? v.cargo === 0 && v.timer < r.travel_seconds :
      v.phase === 'returning' ? v.cargo === r.hold && v.timer < r.travel_seconds :
      v.timer < r.hold * r.salvage_period && v.cargo === Math.floor(v.timer / r.salvage_period));
    if (!valid) ctx.addIssue({ code: 'custom', message: 'Invalid salvage vessel' });
  }
  if ((world.research === null) !== (world.salvage === null)) ctx.addIssue({ code: 'custom', message: 'Research requires Salvage' });
  if (world.salvage?.ships.some(s => s.cargo > world.salvage!.rules.hold)) ctx.addIssue({ code: 'custom', message: 'Cargo exceeds effective hold' });
});
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command_result'), protocol_version: z.literal(PROTOCOL_VERSION), request_id: z.string(), success: z.boolean(), message: z.string() }),
  z.object({ type: z.literal('world_snapshot'), protocol_version: z.literal(PROTOCOL_VERSION), world: worldSchema }),
  z.object({ type: z.literal('error'), protocol_version: z.literal(PROTOCOL_VERSION), message: z.string() }),
]);
export type WorldState = z.infer<typeof worldSchema>;
export type ClientMessage = { type: 'send_doctor'; protocol_version: typeof PROTOCOL_VERSION; lighthouse_id: string } | { type: 'build_salvage_vessel'; protocol_version: typeof PROTOCOL_VERSION } | { type: 'set_salvage_vessel_enabled'; protocol_version: typeof PROTOCOL_VERSION; enabled: boolean } | { type: 'research_technology'; protocol_version: typeof PROTOCOL_VERSION; technology_id: TechnologyId } | { type: 'set_lighthouse_specialization'; protocol_version: typeof PROTOCOL_VERSION; lighthouse_id: string; specialization: 'efficient_lamp' | 'navigation_beacon' } | { type: 'restore_salvage_yard'; protocol_version: typeof PROTOCOL_VERSION; island_id: string } | { type: 'restore_fuel_facility'; protocol_version: typeof PROTOCOL_VERSION; island_id: string } | { type: 'set_simulation_paused'; protocol_version: typeof PROTOCOL_VERSION; paused: boolean } | { type: 'save_game' | 'load_game' | 'restart_game'; protocol_version: typeof PROTOCOL_VERSION; request_id: string } | { type: 'expand_lighthouse_radius'; protocol_version: typeof PROTOCOL_VERSION; lighthouse_id: string } | {
  type: 'set_lighthouse_active'; protocol_version: typeof PROTOCOL_VERSION; lighthouse_id: string; active: boolean;
};
