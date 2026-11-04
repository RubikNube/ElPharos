use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lighthouse {
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

    pub fn upkeep(&self) -> f64 {
        Self::upkeep_at_radius(self.radius)
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
    Ruined,
    Restored,
}

impl FuelFacility {
    pub fn production(self) -> u32 {
        match self {
            Self::Haven => 2,
            Self::Ruined => 0,
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
        let mut world = Self {
            economy: Economy::default(),
            revision: 0,
            radius_step: 60.0,
            radius_max: 650.0,
            width: 2400.0,
            height: 1000.0,
            islands: vec![Island {
                fuel_facility: FuelFacility::Haven,
                id: "island-1".into(),
                name: "First Haven".into(),
                position: Point { x: 800.0, y: 500.0 },
                radius: 110.0,
            }],
            lighthouses: vec![Lighthouse {
                id: "beacon-1".into(),
                island_id: "island-1".into(),
                name: "First Light".into(),
                position: Point { x: 800.0, y: 480.0 },
                radius: 290.0,
                active: true,
                explored_radius: 290.0,
            }],
        };
        for (n, x, y, name) in [
            (2, 1250.0, 650.0, "Amber Shoal"),
            (3, 1700.0, 450.0, "Quiet Reach"),
            (4, 2150.0, 650.0, "Last Anchorage"),
        ] {
            world.islands.push(Island {
                fuel_facility: FuelFacility::Ruined,
                id: format!("island-{n}"),
                name: name.into(),
                position: Point { x, y },
                radius: 90.0,
            });
            world.lighthouses.push(Lighthouse {
                id: format!("beacon-{n}"),
                island_id: format!("island-{n}"),
                name: format!("{name} Light"),
                position: Point { x, y: y - 20.0 },
                radius: 290.0,
                active: false,
                explored_radius: 0.0,
            });
        }
        world
    }
}

impl WorldState {
    pub fn production(&self) -> u32 {
        self.islands
            .iter()
            .map(|island| island.fuel_facility.production())
            .sum()
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
        if self.islands[index].fuel_facility != FuelFacility::Ruined {
            return Ok(false);
        }
        if !self.is_illuminated(&self.islands[index].position) {
            return Err("Island must be illuminated to restore its fuel facility");
        }
        if self.economy.fuel < f64::from(FACILITY_RESTORE_COST) {
            return Err("Not enough fuel to restore facility");
        }
        self.economy.fuel -= f64::from(FACILITY_RESTORE_COST);
        self.islands[index].fuel_facility = FuelFacility::Restored;
        self.revision += 1;
        Ok(true)
    }

    pub fn tick(&mut self) -> bool {
        if self.economy.paused
            || self.revision >= 9_007_199_254_740_991
            || self.economy.elapsed_seconds >= 9_007_199_254_740_991
        {
            return false;
        }
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
        e.elapsed_seconds += 1;
        self.revision += 1;
        true
    }

    pub fn upkeep(&self) -> f64 {
        self.lighthouses
            .iter()
            .filter(|l| l.active)
            .map(Lighthouse::upkeep)
            .sum()
    }

    pub fn set_paused(&mut self, paused: bool) -> bool {
        if self.economy.paused == paused {
            return false;
        }
        self.economy.paused = paused;
        self.revision += 1;
        true
    }

    pub fn expand(&mut self, id: &str) -> Result<bool, &'static str> {
        let light = self
            .lighthouses
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        let radius = (light.radius + self.radius_step).min(self.radius_max);
        if radius == light.radius {
            return Ok(false);
        }
        light.radius = radius;
        if light.active {
            light.explored_radius = light.explored_radius.max(radius);
        }
        self.revision += 1;
        Ok(true)
    }

    pub fn set_lighthouse_active(&mut self, id: &str, active: bool) -> Result<bool, &'static str> {
        let light = self
            .lighthouses
            .iter()
            .find(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        if active && !light.active && self.economy.fuel < self.upkeep() + light.upkeep() {
            return Err("Not enough fuel for one second of network upkeep");
        }
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
        self.revision += 1;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expansion_caps_and_remembers_only_active_coverage() {
        let mut world = WorldState::default();
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
        let mut world = WorldState::default();
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
        let mut w = WorldState::default();
        assert!(w.tick());
        assert_eq!(w.economy.fuel, 301.0);
        w.economy.fuel = 600.0;
        w.tick();
        assert_eq!(w.economy.fuel, 599.0);
        assert!(w.set_paused(true));
        let before = serde_json::to_value(&w).unwrap();
        assert!(!w.tick());
        assert!(!w.set_paused(true));
        assert_eq!(before, serde_json::to_value(&w).unwrap());
        w.set_paused(false);
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
        let mut w = WorldState::default();
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
        let mut w = WorldState::default();
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
        let mut w = WorldState::default();
        w.economy.fuel = 0.;
        for _ in 0..6 {
            assert!(w.expand("beacon-1").unwrap());
        }
        assert_eq!(w.economy.fuel, 0.);
        assert_eq!(w.upkeep(), 2.5);
        assert!(!w.expand("beacon-1").unwrap());
        w.tick();
        assert!(w.economy.blackout);
        let mut w = WorldState::default();
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
        let mut w = WorldState::default();
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
        w.set_paused(true);
        let revision = w.revision;
        assert_eq!(w.restore_fuel_facility("island-2"), Ok(true));
        assert_eq!(w.economy.fuel, 0.);
        assert_eq!(w.production(), 5);
        assert_eq!(w.revision, revision + 1);
        w.set_lighthouse_active("beacon-1", false).unwrap();
        let revision = w.revision;
        assert_eq!(w.restore_fuel_facility("island-2"), Ok(false));
        assert_eq!(w.restore_fuel_facility("island-1"), Ok(false));
        assert_eq!(w.revision, revision);
        assert!(!w.tick());
        w.set_paused(false);
        w.tick();
        assert_eq!(w.economy.fuel, 5.);
    }

    #[test]
    fn remembered_light_does_not_allow_restoration_and_blackout_keeps_production() {
        let mut w = WorldState::default();
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
        assert_eq!(w.economy.fuel, 5.);
        for island in &mut w.islands[2..] {
            island.fuel_facility = FuelFacility::Restored;
        }
        assert_eq!(w.production(), 11);
        w.economy.fuel = 600.;
        for light in &mut w.lighthouses {
            light.active = true;
        }
        w.tick();
        assert_eq!(w.economy.fuel, 590.);
        assert_eq!(w.upkeep(), 10.);
    }
}
