use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const SPECIALIZATION_COST: u32 = 40;
pub const REFIT_COST: u32 = 20;
pub const EFFICIENCY_SAVING: f64 = 0.5;
pub const NAVIGATION_MULTIPLIER: f64 = 1.5;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Specialization {
    EfficientLamp,
    NavigationBeacon,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lighthouse {
    #[serde(default)]
    pub specialization: Option<Specialization>,
    pub id: String,
    pub island_id: String,
    pub name: String,
    pub position: Point,
    pub radius: f64,
    pub active: bool,
    pub explored_radius: f64,
}

impl Lighthouse {
    pub fn upkeep_at_radius(radius: f64) -> f64 {
        f64::from(BEACON_UPKEEP) + 0.25 * ((radius - 290.0).max(0.0) / 60.0).ceil()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Island {
    pub fuel_facility: FuelFacility,
    pub id: String,
    pub name: String,
    pub position: Point,
    pub radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FuelFacility {
    Haven,
    None,
    Ruined,
    Restored,
}

impl FuelFacility {
    pub fn production(self) -> u32 {
        match self {
            Self::Haven => 2,
            Self::Ruined | Self::None => 0,
            Self::Restored => 3,
        }
    }
}

pub const FACILITY_RESTORE_COST: u32 = 120;

pub const FUEL_CAPACITY: u32 = 600;
pub const BEACON_UPKEEP: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Economy {
    pub fuel: f64,
    pub capacity: u32,
    pub beacon_upkeep: u32,
    pub elapsed_seconds: u64,
    pub paused: bool,
    pub blackout: bool,
}

impl Default for Economy {
    fn default() -> Self {
        Self {
            fuel: 300.0,
            capacity: FUEL_CAPACITY,
            beacon_upkeep: BEACON_UPKEEP,
            elapsed_seconds: 0,
            paused: false,
            blackout: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldState {
    pub research: Option<crate::research::Research>,
    #[serde(default)]
    pub salvage: Option<crate::salvage::Salvage>,
    pub economy: Economy,
    pub revision: u64,
    pub radius_step: f64,
    pub radius_max: f64,
    pub width: f64,
    pub height: f64,
    pub islands: Vec<Island>,
    pub lighthouses: Vec<Lighthouse>,
}

impl Default for WorldState {
    fn default() -> Self {
        crate::scenario::new_world()
    }
}

impl WorldState {
    pub(crate) fn next_revision(&self) -> Result<u64, &'static str> {
        self.revision
            .checked_add(1)
            .filter(|revision| *revision <= MAX_SAFE_INTEGER)
            .ok_or("World revision exhausted")
    }

    pub fn specialize(
        &mut self,
        id: &str,
        specialization: Specialization,
    ) -> Result<bool, &'static str> {
        let index = self
            .lighthouses
            .iter()
            .position(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        let light = &self.lighthouses[index];
        if self.salvage.is_none() {
            return Err("Specializations require the Salvage ruleset");
        }
        if light.specialization == Some(specialization) {
            return Ok(false);
        }
        if !self.is_network_illuminated(&light.position) {
            return Err("Connect illumination to fit a specialization");
        }
        let rules = self.effective_rules();
        let cost = if light.specialization.is_some() {
            rules.refit_cost
        } else {
            rules.specialization_cost
        };
        if self.salvage.as_ref().unwrap().reserve < cost {
            return Err("Not enough Salvage for specialization");
        }
        let revision = self.next_revision()?;
        let salvage = self.salvage.as_mut().unwrap();
        salvage.reserve -= cost;
        self.lighthouses[index].specialization = Some(specialization);
        self.revision = revision;
        Ok(true)
    }
    /// Active circles joined to the Haven beacon, including boundary contact.
    pub fn connected_beacons(&self) -> Vec<bool> {
        crate::network::NetworkView::new(self).connected
    }

    pub fn overlap(a: &Lighthouse, b: &Lighthouse) -> bool {
        (a.position.x - b.position.x).hypot(a.position.y - b.position.y) <= a.radius + b.radius
    }

    pub fn facility_production(&self, island: &Island, connected: &[bool]) -> u32 {
        match island.fuel_facility {
            FuelFacility::Haven => 2,
            FuelFacility::Ruined | FuelFacility::None => 0,
            FuelFacility::Restored => {
                if self
                    .lighthouses
                    .iter()
                    .enumerate()
                    .any(|(i, light)| light.island_id == island.id && connected[i])
                {
                    self.restored_fuel_production()
                } else {
                    0
                }
            }
        }
    }

    pub fn production(&self) -> u32 {
        self.production_with_network(&crate::network::NetworkView::new(self))
    }

    pub(crate) fn production_with_network(&self, network: &crate::network::NetworkView) -> u32 {
        self.islands
            .iter()
            .map(|island| self.facility_production(island, &network.connected))
            .sum()
    }

    pub fn objective_complete(&self) -> bool {
        self.objective_with_network(&crate::network::NetworkView::new(self))
    }

    pub(crate) fn objective_with_network(&self, network: &crate::network::NetworkView) -> bool {
        self.salvage
            .as_ref()
            .is_none_or(|s| s.yards.iter().all(|y| y.restored && y.delivered))
            && self
                .islands
                .iter()
                .all(|island| island.fuel_facility != FuelFacility::Ruined)
            && network.connected.iter().all(|connected| *connected)
            && f64::from(self.production_with_network(network)) >= self.upkeep()
    }

    pub fn is_network_illuminated(&self, position: &Point) -> bool {
        crate::network::NetworkView::new(self).illuminates(self, position)
    }

    pub fn is_illuminated(&self, position: &Point) -> bool {
        self.lighthouses.iter().any(|light| {
            light.active
                && (position.x - light.position.x).hypot(position.y - light.position.y)
                    <= light.radius
        })
    }

    pub fn restore_fuel_facility(&mut self, id: &str) -> Result<bool, &'static str> {
        let index = self
            .islands
            .iter()
            .position(|island| island.id == id)
            .ok_or("Unknown island")?;
        if self.islands[index].fuel_facility == FuelFacility::None {
            return Err("This island has a salvage yard");
        }
        if self.islands[index].fuel_facility != FuelFacility::Ruined {
            return Ok(false);
        }
        if !self.is_network_illuminated(&self.islands[index].position) {
            return Err("Island must have connected illumination to restore its fuel facility");
        }
        if self.economy.fuel < f64::from(FACILITY_RESTORE_COST) {
            return Err("Not enough fuel to restore facility");
        }
        let revision = self.next_revision()?;
        self.economy.fuel -= f64::from(FACILITY_RESTORE_COST);
        self.islands[index].fuel_facility = FuelFacility::Restored;
        self.revision = revision;
        Ok(true)
    }

    pub fn tick(&mut self) -> bool {
        if self.economy.paused || self.economy.elapsed_seconds >= MAX_SAFE_INTEGER {
            return false;
        }
        let Ok(revision) = self.next_revision() else {
            return false;
        };
        let production = self.production();
        let upkeep = self.upkeep();
        let e = &mut self.economy;
        e.fuel = (e.fuel + f64::from(production)).min(f64::from(e.capacity));
        if e.fuel < upkeep {
            e.fuel = 0.0;
            e.blackout = true;
            for light in &mut self.lighthouses {
                light.active = false;
            }
        } else {
            e.fuel -= upkeep;
        }
        self.tick_salvage();
        let e = &mut self.economy;
        e.elapsed_seconds += 1;
        self.revision = revision;
        true
    }

    pub fn upkeep(&self) -> f64 {
        self.lighthouses
            .iter()
            .filter(|l| l.active)
            .map(|light| self.lighthouse_upkeep_at_radius(light, light.radius))
            .sum()
    }

    pub fn set_paused(&mut self, paused: bool) -> Result<bool, &'static str> {
        if self.economy.paused == paused {
            return Ok(false);
        }
        let revision = self.next_revision()?;
        self.economy.paused = paused;
        self.revision = revision;
        Ok(true)
    }

    pub fn expand(&mut self, id: &str) -> Result<bool, &'static str> {
        let candidate = self
            .lighthouses
            .iter()
            .find(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        if candidate.radius >= self.radius_max {
            return Ok(false);
        }
        let radius = (candidate.radius + self.radius_step).min(self.radius_max);
        if radius == candidate.radius {
            return Ok(false);
        }
        let revision = self.next_revision()?;
        let expand_cost = self.effective_rules().expand_cost;
        if let Some(s) = &mut self.salvage {
            if s.reserve < expand_cost {
                return Err("Not enough Salvage to expand radius");
            }
            s.reserve -= expand_cost;
        }
        let light = self
            .lighthouses
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        light.radius = radius;
        if light.active {
            light.explored_radius = light.explored_radius.max(radius);
        }
        self.revision = revision;
        Ok(true)
    }

    pub fn set_lighthouse_active(&mut self, id: &str, active: bool) -> Result<bool, &'static str> {
        let light = self
            .lighthouses
            .iter()
            .find(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        if active
            && !light.active
            && self.economy.fuel
                < self.upkeep() + self.lighthouse_upkeep_at_radius(light, light.radius)
        {
            return Err("Not enough fuel for one second of network upkeep");
        }
        let revision = if light.active == active {
            return Ok(false);
        } else {
            self.next_revision()?
        };
        let lighthouse = self
            .lighthouses
            .iter_mut()
            .find(|light| light.id == id)
            .ok_or("Unknown lighthouse")?;
        if lighthouse.active == active {
            return Ok(false);
        }
        lighthouse.active = active;
        if active {
            self.economy.blackout = false;
        }
        if active {
            lighthouse.explored_radius = lighthouse.explored_radius.max(lighthouse.radius);
        }
        self.revision = revision;
        Ok(true)
    }
}

#[cfg(test)]
fn legacy_world() -> WorldState {
    let mut w = WorldState {
        salvage: None,
        research: None,
        ..crate::scenario::fixed_world()
    };
    w.islands.truncate(4);
    w.lighthouses.truncate(4);
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expansion_caps_and_remembers_only_active_coverage() {
        let mut world = legacy_world();
        assert_eq!(world.expand("missing"), Err("Unknown lighthouse"));
        world.expand("beacon-2").unwrap();
        assert_eq!(world.lighthouses[1].explored_radius, 0.0);
        world.set_lighthouse_active("beacon-2", true).unwrap();
        assert_eq!(world.lighthouses[1].explored_radius, 350.0);
        world.set_lighthouse_active("beacon-2", false).unwrap();
        assert_eq!(world.lighthouses[1].explored_radius, 350.0);
        for _ in 0..10 {
            world.expand("beacon-1").unwrap();
        }
        assert_eq!(world.lighthouses[0].radius, 650.0);
        let revision = world.revision;
        assert_eq!(world.expand("beacon-1"), Ok(false));
        assert_eq!(world.revision, revision);
        assert_eq!(world.lighthouses[0].explored_radius, 650.0);
    }

    #[test]
    fn commands_are_idempotent_and_unknown_ids_do_not_mutate_world() {
        let mut world = legacy_world();
        assert_eq!(
            world.set_lighthouse_active("missing", false),
            Err("Unknown lighthouse")
        );
        assert_eq!(world.revision, 0);
        assert_eq!(world.set_lighthouse_active("beacon-1", false), Ok(true));
        assert_eq!(world.set_lighthouse_active("beacon-1", false), Ok(false));
        assert_eq!(world.revision, 1);
        assert!(!world.lighthouses[0].active);
    }
}

#[cfg(test)]
mod economy_tests {
    use super::*;
    #[test]
    fn production_capacity_pause_and_exact_payment() {
        let mut w = legacy_world();
        assert!(w.tick());
        assert_eq!(w.economy.fuel, 301.0);
        w.economy.fuel = 600.0;
        w.tick();
        assert_eq!(w.economy.fuel, 599.0);
        assert!(w.set_paused(true).unwrap());
        let before = serde_json::to_value(&w).unwrap();
        assert!(!w.tick());
        assert!(!w.set_paused(true).unwrap());
        assert_eq!(before, serde_json::to_value(&w).unwrap());
        w.set_paused(false).unwrap();
        for l in &mut w.lighthouses {
            l.active = true;
            l.explored_radius = l.radius;
        }
        w.economy.fuel = 2.0;
        w.tick();
        assert_eq!(w.economy.fuel, 0.0);
        assert!(w.lighthouses.iter().all(|l| l.active));
    }
    #[test]
    fn blackout_recovers_without_losing_exploration() {
        let mut w = legacy_world();
        for l in &mut w.lighthouses {
            l.active = true;
            l.explored_radius = l.radius;
        }
        w.economy.fuel = 1.0;
        w.tick();
        assert_eq!(w.economy.fuel, 0.0);
        assert!(w.economy.blackout);
        assert!(
            w.lighthouses
                .iter()
                .all(|l| !l.active && l.explored_radius == l.radius)
        );
        assert!(w.set_lighthouse_active("beacon-1", true).is_err());
        w.tick();
        assert_eq!(w.economy.fuel, 2.0);
        w.set_lighthouse_active("beacon-1", true).unwrap();
        w.set_lighthouse_active("beacon-2", true).unwrap();
        assert!(!w.economy.blackout);
        assert!(w.set_lighthouse_active("beacon-3", true).is_err());
    }
}

#[cfg(test)]
mod radius_upkeep_tests {
    use super::*;
    #[test]
    fn tiers_and_legacy_radii() {
        for (radius, upkeep) in [
            (290., 1.),
            (350., 1.25),
            (410., 1.5),
            (470., 1.75),
            (530., 2.),
            (590., 2.25),
            (650., 2.5),
            (200., 1.),
            (291., 1.25),
            (351., 1.5),
        ] {
            assert_eq!(Lighthouse::upkeep_at_radius(radius), upkeep);
        }
    }
    #[test]
    fn mixed_upkeep_fractional_ticks_and_activation() {
        let mut w = legacy_world();
        w.expand("beacon-1").unwrap();
        w.expand("beacon-2").unwrap();
        w.expand("beacon-2").unwrap();
        assert_eq!(w.upkeep(), 1.25); // Inactive expansion has no running cost.
        w.economy.fuel = 2.5;
        assert!(w.set_lighthouse_active("beacon-2", true).is_err());
        w.economy.fuel = 2.75;
        w.set_lighthouse_active("beacon-2", true).unwrap();
        assert_eq!(w.upkeep(), 2.75);
        w.economy.fuel = 0.75;
        w.tick();
        assert_eq!(w.economy.fuel, 0.); // Exact payment keeps the beacons lit.
        assert!(w.lighthouses[0].active && w.lighthouses[1].active);
        w.tick();
        assert!(w.economy.blackout);
        w.tick();
        assert_eq!(w.economy.fuel, 2.);
    }
    #[test]
    fn expansion_is_free_even_if_upkeep_is_unaffordable() {
        let mut w = legacy_world();
        w.economy.fuel = 0.;
        for _ in 0..6 {
            assert!(w.expand("beacon-1").unwrap());
        }
        assert_eq!(w.economy.fuel, 0.);
        assert_eq!(w.upkeep(), 2.5);
        assert!(!w.expand("beacon-1").unwrap());
        w.tick();
        assert!(w.economy.blackout);
        let mut w = legacy_world();
        w.expand("beacon-1").unwrap();
        w.tick();
        assert_eq!(w.economy.fuel, 300.75);
        w.economy.fuel = 600.;
        w.tick();
        assert_eq!(w.economy.fuel, 598.75);
    }
}

#[cfg(test)]
mod facility_tests {
    use super::*;

    #[test]
    fn restoration_checks_light_and_funds_and_is_idempotent() {
        let mut w = legacy_world();
        assert_eq!(w.production(), 2);
        assert_eq!(w.restore_fuel_facility("missing"), Err("Unknown island"));
        assert!(w.restore_fuel_facility("island-2").is_err());
        // Island center exactly on the edge of First Light's illumination.
        w.islands[1].position = Point { x: 1090., y: 480. };
        w.economy.fuel = 119.75;
        let before = serde_json::to_value(&w).unwrap();
        assert!(w.restore_fuel_facility("island-2").is_err());
        assert_eq!(serde_json::to_value(&w).unwrap(), before);
        w.economy.fuel = 120.;
        w.set_paused(true).unwrap();
        let revision = w.revision;
        assert_eq!(w.restore_fuel_facility("island-2"), Ok(true));
        assert_eq!(w.economy.fuel, 0.);
        assert_eq!(w.production(), 2);
        assert_eq!(w.revision, revision + 1);
        w.set_lighthouse_active("beacon-1", false).unwrap();
        let revision = w.revision;
        assert_eq!(w.restore_fuel_facility("island-2"), Ok(false));
        assert_eq!(w.restore_fuel_facility("island-1"), Ok(false));
        assert_eq!(w.revision, revision);
        assert!(!w.tick());
        w.set_paused(false).unwrap();
        w.tick();
        assert_eq!(w.economy.fuel, 2.);
    }

    #[test]
    fn remembered_light_blocks_restoration_and_blackout_keeps_haven_production() {
        let mut w = legacy_world();
        w.islands[1].position = Point { x: 800., y: 500. };
        w.set_lighthouse_active("beacon-1", false).unwrap();
        assert!(w.restore_fuel_facility("island-2").is_err());
        w.set_lighthouse_active("beacon-1", true).unwrap();
        w.restore_fuel_facility("island-2").unwrap();
        for light in &mut w.lighthouses {
            light.active = true;
            light.radius = 650.;
            light.explored_radius = 650.;
        }
        w.economy.fuel = 0.;
        w.tick();
        assert!(w.economy.blackout);
        w.tick();
        assert_eq!(w.economy.fuel, 2.);
        for island in &mut w.islands[2..] {
            island.fuel_facility = FuelFacility::Restored;
        }
        assert_eq!(w.production(), 2);
        w.economy.fuel = 600.;
        for light in &mut w.lighthouses {
            light.active = true;
        }
        w.tick();
        assert_eq!(w.economy.fuel, 590.);
        assert_eq!(w.upkeep(), 10.);
    }
}

#[cfg(test)]
mod network_tests {
    use super::*;

    fn restored_network() -> WorldState {
        let mut w = legacy_world();
        for light in &mut w.lighthouses {
            light.active = true;
            light.explored_radius = light.radius;
        }
        for island in &mut w.islands[1..] {
            island.fuel_facility = FuelFacility::Restored;
        }
        w
    }

    #[test]
    fn chains_disconnect_reconnect_and_complete_objective() {
        let mut w = restored_network();
        assert_eq!(w.connected_beacons(), vec![true; 4]);
        assert_eq!(w.production(), 11);
        assert!(w.objective_complete());
        w.lighthouses[1].active = false;
        assert_eq!(w.connected_beacons(), vec![true, false, false, false]);
        assert_eq!(w.production(), 2);
        assert!(!w.objective_complete());
        w.economy.fuel = 100.;
        w.tick();
        assert_eq!(w.economy.fuel, 99.);
        w.lighthouses[1].active = true;
        w.tick();
        assert_eq!(w.economy.fuel, 106.);
        assert!(w.objective_complete());
        w.islands[3].fuel_facility = FuelFacility::Ruined;
        assert!(!w.objective_complete());
    }

    #[test]
    fn touching_circles_connect_but_gaps_and_inactive_anchors_do_not() {
        let mut w = restored_network();
        w.lighthouses[1].position = Point { x: 1380., y: 480. };
        assert!(w.connected_beacons()[1]);
        w.lighthouses[1].position.x += 0.01;
        assert!(!w.connected_beacons()[1]);
        w.lighthouses[0].active = false;
        assert_eq!(w.connected_beacons(), vec![false; 4]);
        assert_eq!(w.production(), 2);
    }

    #[test]
    fn isolated_light_cannot_restore_even_when_island_is_illuminated() {
        let mut w = legacy_world();
        w.lighthouses[3].active = true;
        assert!(w.is_illuminated(&w.islands[3].position));
        let before = serde_json::to_value(&w).unwrap();
        assert!(w.restore_fuel_facility("island-4").is_err());
        assert_eq!(serde_json::to_value(&w).unwrap(), before);
        w.lighthouses[3].active = false;
        w.lighthouses[0].radius = 530.;
        assert_eq!(w.restore_fuel_facility("island-2"), Ok(true));
        assert_eq!(w.production(), 2);
        w.set_lighthouse_active("beacon-2", true).unwrap();
        assert_eq!(w.production(), 5);
    }
}

#[cfg(test)]
mod specialization_tests {
    use super::*;

    #[test]
    fn purchases_refits_and_rejections_are_atomic() {
        let mut w = crate::scenario::fixed_world();
        let before = serde_json::to_value(&w).unwrap();
        assert!(
            w.specialize("missing", Specialization::EfficientLamp)
                .is_err()
        );
        assert!(
            w.specialize("beacon-4", Specialization::EfficientLamp)
                .is_err()
        );
        assert_eq!(before, serde_json::to_value(&w).unwrap());
        w.set_paused(true).unwrap();
        assert!(
            w.specialize("beacon-1", Specialization::EfficientLamp)
                .unwrap()
        );
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 60);
        assert_eq!(w.upkeep(), 0.5);
        let revision = w.revision;
        assert!(
            !w.specialize("beacon-1", Specialization::EfficientLamp)
                .unwrap()
        );
        assert_eq!(w.revision, revision);
        w.expand("beacon-1").unwrap();
        assert_eq!(w.upkeep(), 0.75);
        w.specialize("beacon-1", Specialization::NavigationBeacon)
            .unwrap();
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 20);
        assert_eq!(w.upkeep(), 1.25);
        w.salvage.as_mut().unwrap().reserve = 19;
        let before = serde_json::to_value(&w).unwrap();
        assert!(
            w.specialize("beacon-1", Specialization::EfficientLamp)
                .is_err()
        );
        assert_eq!(before, serde_json::to_value(&w).unwrap());
        assert!(
            legacy_world()
                .specialize("beacon-1", Specialization::EfficientLamp)
                .is_err()
        );
    }

    #[test]
    fn efficient_payment_activation_and_blackout() {
        let mut w = crate::scenario::fixed_world();
        w.specialize("beacon-1", Specialization::EfficientLamp)
            .unwrap();
        w.tick();
        assert_eq!(w.economy.fuel, 301.5);
        w.set_lighthouse_active("beacon-1", false).unwrap();
        w.economy.fuel = 0.5;
        w.set_lighthouse_active("beacon-1", true).unwrap();
        assert_eq!(w.upkeep(), 0.5);
        crate::persistence::validate(&w).unwrap();
    }

    #[test]
    fn navigation_boosts_both_directions_without_stacking_and_stops_when_disconnected() {
        let mut w = crate::scenario::fixed_world();
        w.restore_salvage_yard("island-5").unwrap();
        w.set_lighthouse_active("beacon-5", true).unwrap();
        w.salvage.as_mut().unwrap().yards[0].stock = 20;
        let mut normal = w.clone();
        w.specialize("beacon-1", Specialization::NavigationBeacon)
            .unwrap();
        normal.tick();
        w.tick();
        assert!(
            (w.salvage.as_ref().unwrap().ships[0].progress
                / normal.salvage.as_ref().unwrap().ships[0].progress
                - 1.5)
                .abs()
                < 1e-9
        );
        w.lighthouses[4].specialization = Some(Specialization::NavigationBeacon);
        assert_eq!(
            w.effective_rules()
                .link_speed(&w.lighthouses[0], &w.lighthouses[4]),
            90.
        );
        assert_eq!(
            w.effective_rules()
                .link_speed(&w.lighthouses[4], &w.lighthouses[0]),
            90.
        );
        let progress = w.salvage.as_ref().unwrap().ships[0].progress;
        w.set_lighthouse_active("beacon-5", false).unwrap();
        w.tick();
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].progress, progress);
        w.set_lighthouse_active("beacon-5", true).unwrap();
        w.tick();
        assert_ne!(w.salvage.as_ref().unwrap().ships[0].progress, progress);
    }
}

#[cfg(test)]
mod revision_tests {
    use super::*;
    use crate::research::Technology;

    type Mutation = fn(&mut WorldState) -> Result<bool, &'static str>;

    #[test]
    fn every_command_checks_revision_before_spending_or_mutating() {
        let mutations: [Mutation; 7] = [
            |w| w.expand("beacon-1"),
            |w| w.set_lighthouse_active("beacon-1", false),
            |w| w.set_paused(true),
            |w| w.restore_fuel_facility("island-2"),
            |w| w.restore_salvage_yard("island-5"),
            |w| w.specialize("beacon-1", Specialization::EfficientLamp),
            |w| w.research_technology(Technology::ReinforcedFoundations),
        ];
        for mutate in mutations {
            let mut world = crate::scenario::fixed_world();
            for light in &mut world.lighthouses {
                light.active = true;
                light.explored_radius = light.radius;
            }
            world.revision = MAX_SAFE_INTEGER;
            let before = serde_json::to_value(&world).unwrap();
            assert_eq!(mutate(&mut world), Err("World revision exhausted"));
            assert_eq!(serde_json::to_value(&world).unwrap(), before);
            assert!(!world.tick());
            assert_eq!(serde_json::to_value(&world).unwrap(), before);
            world.revision -= 1;
            assert_eq!(mutate(&mut world), Ok(true));
            assert_eq!(world.revision, MAX_SAFE_INTEGER);
        }
    }

    #[test]
    fn unchanged_commands_still_succeed_at_the_revision_limit() {
        let mut world = WorldState {
            revision: MAX_SAFE_INTEGER,
            ..crate::scenario::fixed_world()
        };
        world.lighthouses[0].radius = world.radius_max;
        world.lighthouses[0].explored_radius = world.radius_max;
        let before = serde_json::to_value(&world).unwrap();
        assert_eq!(world.set_paused(false), Ok(false));
        assert_eq!(world.set_lighthouse_active("beacon-1", true), Ok(false));
        assert_eq!(world.expand("beacon-1"), Ok(false));
        assert_eq!(world.restore_fuel_facility("island-1"), Ok(false));
        assert_eq!(serde_json::to_value(&world).unwrap(), before);
    }
}
