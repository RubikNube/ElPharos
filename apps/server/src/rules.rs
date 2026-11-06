//! Base gameplay parameters and research-adjusted effective rules.
use crate::{
    domain::{Lighthouse, Specialization, WorldState},
    research::Technology,
    salvage::*,
};
use serde::Serialize;

#[derive(Serialize)]
pub struct EffectiveRules {
    pub vessel: crate::vessel::VesselRules,
    #[serde(skip)]
    pub restored_facility_production: u32,
    pub specialization_cost: u32,
    pub refit_cost: u32,
    pub efficiency_saving: f64,
    pub navigation_multiplier: f64,
    pub capacity: u32,
    pub expand_cost: u32,
    pub restore_cost: u32,
    pub restore_fuel: f64,
    pub speed: f64,
    pub hold: u32,
    pub local_capacity: u32,
    pub haven_period: u32,
}
impl Default for EffectiveRules {
    fn default() -> Self {
        Self {
            vessel: crate::vessel::VesselRules::default(),
            restored_facility_production: 3,
            specialization_cost: crate::domain::SPECIALIZATION_COST,
            refit_cost: crate::domain::REFIT_COST,
            efficiency_saving: crate::domain::EFFICIENCY_SAVING,
            navigation_multiplier: crate::domain::NAVIGATION_MULTIPLIER,
            capacity: CAPACITY,
            expand_cost: EXPAND_COST,
            restore_cost: RESTORE_COST,
            restore_fuel: RESTORE_FUEL,
            speed: SPEED,
            hold: HOLD,
            local_capacity: LOCAL_CAPACITY,
            haven_period: HAVEN_PERIOD,
        }
    }
}

impl EffectiveRules {
    pub fn link_speed(&self, a: &crate::domain::Lighthouse, b: &crate::domain::Lighthouse) -> f64 {
        self.speed
            * if [a.specialization, b.specialization]
                .contains(&Some(crate::domain::Specialization::NavigationBeacon))
            {
                self.navigation_multiplier
            } else {
                1.0
            }
    }
}

impl WorldState {
    pub fn effective_rules(&self) -> crate::rules::EffectiveRules {
        use Technology::*;
        let mut rules = crate::rules::EffectiveRules::default();
        if self.has_technology(ReinforcedFoundations) {
            rules.expand_cost = 15;
        }
        if self.has_technology(ModularFittings) {
            rules.specialization_cost = 30;
            rules.refit_cost = 15;
        }
        if self.has_technology(StreamlinedHulls) {
            rules.speed = 75.0;
        }
        if self.has_technology(ExpandedHolds) {
            rules.hold = 30;
        }
        if self.has_technology(PrecisionLenses) {
            rules.efficiency_saving = 0.75;
        }
        if self.has_technology(ImprovedRefining) {
            rules.restored_facility_production = 4;
        }
        rules
    }

    pub fn lighthouse_upkeep_at_radius(&self, light: &Lighthouse, radius: f64) -> f64 {
        (Lighthouse::upkeep_at_radius(radius)
            - if light.specialization == Some(Specialization::EfficientLamp) {
                self.effective_rules().efficiency_saving
            } else {
                0.0
            }
            - if light.secured { 0.25 } else { 0.0 })
        .max(0.25)
    }

    pub fn restored_fuel_production(&self) -> u32 {
        self.effective_rules().restored_facility_production
    }
}
