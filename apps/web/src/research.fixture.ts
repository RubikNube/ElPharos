import type { WorldState } from './protocol';

// Representative wire data used by protocol and presentation tests.
export function researchFixture(): NonNullable<WorldState['research']> {
  return {
    completed: [],
    catalog: [
      { id: 'reinforced_foundations', name: 'Reinforced foundations', island_id: 'island-2', prerequisite: null, cost: 40, effect: 'Radius expansion costs 15 instead of 20 Salvage.', discovered: true, available: true, blocked_reason: null },
      { id: 'modular_fittings', name: 'Modular fittings', island_id: 'island-2', prerequisite: 'reinforced_foundations', cost: 80, effect: 'Installation costs 30; refitting costs 15 Salvage.', discovered: true, available: false, blocked_reason: 'Complete the prerequisite technology' },
      { id: 'streamlined_hulls', name: 'Streamlined hulls', island_id: 'island-3', prerequisite: null, cost: 40, effect: 'Base cargo speed increases to 75 units/second.', discovered: false, available: false, blocked_reason: "Discover this island's archive" },
      { id: 'expanded_holds', name: 'Expanded holds', island_id: 'island-3', prerequisite: 'streamlined_hulls', cost: 80, effect: 'Cargo holds carry 30 Salvage.', discovered: false, available: false, blocked_reason: "Discover this island's archive" },
      { id: 'precision_lenses', name: 'Precision lenses', island_id: 'island-4', prerequisite: null, cost: 40, effect: 'Efficient lamps save 0.75 fuel/second.', discovered: false, available: false, blocked_reason: "Discover this island's archive" },
      { id: 'improved_refining', name: 'Improved refining', island_id: 'island-4', prerequisite: 'precision_lenses', cost: 80, effect: 'Restored facilities produce 4 fuel/second.', discovered: false, available: false, blocked_reason: "Discover this island's archive" },
    ],
  };
}

export function researchWorldFixture(): WorldState {
  return {
    doctor: null, doctor_rules: { trip_fuel: 40, speed: 120 },
    research: researchFixture(),
    economy: { fuel: 300, capacity: 600, production: 2, facility_restore_cost: 120, restored_facility_production: 3, beacon_upkeep: 1, elapsed_seconds: 0, paused: false, blackout: false },
    salvage: {
      vessel: null, vessel_route: null,
      rules: { vessel: { build_fuel: 200, trip_fuel: 120, fuel_reserve: 120, hold: 40, travel_seconds: 5, salvage_period: 2 }, specialization_cost: 40, refit_cost: 20, efficiency_saving: 0.5, navigation_multiplier: 1.5, capacity: 300, expand_cost: 20, restore_cost: 40, restore_fuel: 120, speed: 60, hold: 20, local_capacity: 60, haven_period: 10 },
      reserve: 100, haven_timer: 0, yards: [], ships: [],
    },
    objective_complete: false, shipping_links: [], revision: 1, width: 2400, height: 1000, radius_step: 60, radius_max: 650,
    islands: [{ id: 'island-2', name: 'Amber Shoal', position: { x: 1250, y: 650 }, radius: 90, fuel_facility: 'ruined', fuel_production: 0 }],
    lighthouses: [],
  };
}
