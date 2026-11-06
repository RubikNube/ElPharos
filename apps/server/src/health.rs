//! Keeper illness and a fuel-funded doctor independent of shipping coverage.
use crate::domain::{FuelFacility, MAX_SAFE_INTEGER, WorldState};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DoctorVoyage {
    pub destination: String,
    pub returning: bool,
    pub progress: f64,
}

#[derive(Serialize)]
pub struct DoctorRules {
    pub trip_fuel: u32,
    pub speed: f64,
}
impl Default for DoctorRules {
    fn default() -> Self {
        Self {
            trip_fuel: 40,
            speed: 120.0,
        }
    }
}

impl WorldState {
    pub fn send_doctor(&mut self, id: &str) -> Result<bool, &'static str> {
        let light = self
            .lighthouses
            .iter()
            .find(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        if let Some(v) = &self.doctor {
            return if v.destination == id {
                Ok(false)
            } else {
                Err("Doctor ship is busy")
            };
        }
        if !light.sick {
            return Err("Keeper is healthy");
        }
        if !self.lighthouses.iter().any(|l| {
            l.explored_radius > 0.0
                && self.distance(&l.position, &light.position) <= l.explored_radius
        }) {
            return Err("Lighthouse is undiscovered");
        }
        if self.economy.fuel < f64::from(DoctorRules::default().trip_fuel) {
            return Err("Not enough fuel for doctor visit");
        }
        let local = self
            .islands
            .iter()
            .any(|i| i.id == light.island_id && i.fuel_facility == FuelFacility::Haven);
        let revision = self.next_revision()?;
        self.economy.fuel -= f64::from(DoctorRules::default().trip_fuel);
        if local {
            self.treat_keeper(id, self.economy.elapsed_seconds);
        } else {
            self.doctor = Some(DoctorVoyage {
                destination: id.into(),
                returning: false,
                progress: 0.0,
            });
        }
        self.revision = revision;
        Ok(true)
    }

    fn treat_keeper(&mut self, id: &str, now: u64) {
        if let Some(light) = self.lighthouses.iter_mut().find(|l| l.id == id) {
            light.sick = false;
            light.immune_until = now.saturating_add(300).min(MAX_SAFE_INTEGER);
            if light.active {
                light.explored_radius = light.explored_radius.max(light.effective_radius());
            }
        }
    }

    pub(crate) fn tick_health(&mut self, mut roll: impl FnMut() -> f64) {
        let now = self.economy.elapsed_seconds + 1;
        if now.is_multiple_of(60) {
            for light in &mut self.lighthouses {
                if !light.sick
                    && light.explored_radius > 0.0
                    && now >= light.immune_until
                    && roll() < 0.05
                {
                    light.sick = true;
                }
            }
        }
        let Some(mut voyage) = self.doctor.take() else {
            return;
        };
        let haven = self
            .islands
            .iter()
            .find(|i| i.fuel_facility == FuelFacility::Haven)
            .unwrap();
        let target = self
            .lighthouses
            .iter()
            .find(|l| l.id == voyage.destination)
            .unwrap();
        let distance = self.distance(&haven.position, &target.position);
        voyage.progress += if distance == 0.0 {
            1.0
        } else {
            DoctorRules::default().speed / distance
        };
        if voyage.progress >= 1.0 {
            if voyage.returning {
                return;
            }
            self.treat_keeper(&voyage.destination, now);
            voyage.returning = true;
            voyage.progress = 0.0;
        }
        self.doctor = Some(voyage);
    }
}

pub fn validate(world: &WorldState) -> Result<(), String> {
    if let Some(v) = &world.doctor {
        let target = world
            .lighthouses
            .iter()
            .find(|l| l.id == v.destination)
            .ok_or("Invalid doctor destination")?;
        if !v.progress.is_finite()
            || !(0.0..1.0).contains(&v.progress)
            || (!v.returning && !target.sick)
            || world
                .islands
                .iter()
                .any(|i| i.id == target.island_id && i.fuel_facility == FuelFacility::Haven)
            || !world.lighthouses.iter().any(|l| {
                l.explored_radius > 0.0
                    && world.distance(&l.position, &target.position) <= l.explored_radius
            })
        {
            return Err("Invalid doctor voyage".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patient() -> WorldState {
        let mut w = crate::scenario::fixed_world();
        w.lighthouses[1].active = true;
        w.lighthouses[1].explored_radius = w.lighthouses[1].radius;
        w.lighthouses[1].sick = true;
        w
    }

    #[test]
    fn illness_checks_only_eligible_keepers_at_minute_boundaries() {
        let mut w = crate::scenario::fixed_world();
        w.economy.elapsed_seconds = 239;
        w.tick_health(|| 0.0);
        assert!(!w.lighthouses[0].sick);
        w.economy.elapsed_seconds = 298;
        w.tick_health(|| panic!("not a minute boundary"));
        w.economy.elapsed_seconds = 299;
        w.tick_health(|| 0.05);
        assert!(!w.lighthouses[0].sick);
        w.tick_health(|| 0.049999);
        assert!(w.lighthouses[0].sick);
        assert!(!w.lighthouses[1].sick, "never lit keepers are ineligible");
        w.tick_health(|| panic!("sick keepers are ineligible"));
        w.set_paused(true).unwrap();
        let before = serde_json::to_value(&w).unwrap();
        assert!(!w.tick());
        assert_eq!(before, serde_json::to_value(&w).unwrap());
    }

    #[test]
    fn reduced_coverage_disconnects_and_treatment_restores_without_losing_upgrades() {
        let mut w = patient();
        w.lighthouses[1].position = crate::domain::Point {
            x: 1350.0,
            y: 480.0,
        };
        w.islands[1].fuel_facility = FuelFacility::Restored;
        assert!(!w.connected_beacons()[1]);
        assert_eq!(w.production(), 2);
        assert_eq!(w.lighthouses[1].effective_radius(), 217.5);
        assert_eq!(w.lighthouses[1].explored_radius, 290.0);
        let before_upkeep = w.upkeep();
        w.lighthouses[1].sick = false;
        assert!(w.connected_beacons()[1]);
        assert_eq!(w.production(), 5);
        assert_eq!(w.upkeep(), before_upkeep);
        w.lighthouses[1].sick = true;
        w.expand("beacon-2").unwrap();
        assert_eq!(w.lighthouses[1].radius, 350.0);
        assert_eq!(w.lighthouses[1].explored_radius, 290.0);
        w.treat_keeper("beacon-2", 100);
        assert_eq!(w.lighthouses[1].effective_radius(), 350.0);
        assert_eq!(w.lighthouses[1].explored_radius, 350.0);
        assert_eq!(w.lighthouses[1].immune_until, 400);
        crate::persistence::validate(&w).unwrap();
    }

    #[test]
    fn dispatch_is_atomic_and_duplicate_requests_never_charge_twice() {
        let mut w = patient();
        for id in ["missing", "beacon-1", "beacon-3"] {
            let before = serde_json::to_value(&w).unwrap();
            assert!(w.send_doctor(id).is_err());
            assert_eq!(before, serde_json::to_value(&w).unwrap());
        }
        w.economy.fuel = 39.75;
        let before = serde_json::to_value(&w).unwrap();
        assert!(w.send_doctor("beacon-2").is_err());
        assert_eq!(before, serde_json::to_value(&w).unwrap());
        w.economy.fuel = 40.0;
        w.revision = MAX_SAFE_INTEGER;
        assert!(w.send_doctor("beacon-2").is_err());
        assert_eq!(w.economy.fuel, 40.0);
        w.revision = 0;
        assert_eq!(w.send_doctor("beacon-2"), Ok(true));
        assert_eq!(w.economy.fuel, 0.0);
        let before = serde_json::to_value(&w).unwrap();
        assert_eq!(w.send_doctor("beacon-2"), Ok(false));
        assert!(w.send_doctor("beacon-1").is_err());
        assert_eq!(before, serde_json::to_value(&w).unwrap());
    }

    #[test]
    fn isolated_blackout_voyage_pauses_treats_returns_and_roundtrips() {
        let mut w = patient();
        w.send_doctor("beacon-2").unwrap();
        for l in &mut w.lighthouses {
            l.active = false;
        }
        w.economy.blackout = true;
        let exploration: Vec<_> = w.lighthouses.iter().map(|l| l.explored_radius).collect();
        w.tick();
        assert!(w.doctor.as_ref().unwrap().progress > 0.0);
        let path =
            std::env::temp_dir().join(format!("el-pharos-doctor-{}.json", std::process::id()));
        for returning in [false, true] {
            while w.doctor.as_ref().unwrap().returning != returning {
                w.tick();
            }
            crate::persistence::save(&path, &w).unwrap();
            let loaded = crate::persistence::load(&path).unwrap();
            assert_eq!(
                serde_json::to_value(&loaded).unwrap(),
                serde_json::to_value(&w).unwrap()
            );
        }
        assert!(!w.lighthouses[1].sick);
        assert_eq!(
            w.lighthouses[1].immune_until,
            w.economy.elapsed_seconds + 300
        );
        w.set_paused(true).unwrap();
        let progress = w.doctor.as_ref().unwrap().progress;
        assert!(!w.tick());
        assert_eq!(w.doctor.as_ref().unwrap().progress, progress);
        w.set_paused(false).unwrap();
        for _ in 0..10 {
            w.tick();
        }
        assert!(w.doctor.is_none());
        assert_eq!(
            w.lighthouses
                .iter()
                .map(|l| l.explored_radius)
                .collect::<Vec<_>>(),
            exploration
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn haven_treatment_is_local_and_immunity_blocks_reinfection() {
        let mut w = crate::scenario::fixed_world();
        w.lighthouses[0].sick = true;
        w.economy.elapsed_seconds = 600;
        w.send_doctor("beacon-1").unwrap();
        assert!(w.doctor.is_none());
        assert_eq!(w.economy.fuel, 260.0);
        assert!(!w.lighthouses[0].sick);
        assert_eq!(w.lighthouses[0].immune_until, 900);
        w.economy.elapsed_seconds = 839;
        w.tick_health(|| panic!("immune"));
        w.economy.elapsed_seconds = 899;
        w.tick_health(|| 0.0);
        assert!(w.lighthouses[0].sick);
    }

    #[test]
    fn validation_rejects_invalid_health_and_voyages() {
        let mut w = patient();
        w.send_doctor("beacon-2").unwrap();
        for progress in [-1.0, 1.0, f64::NAN] {
            let mut bad = w.clone();
            bad.doctor.as_mut().unwrap().progress = progress;
            assert!(crate::persistence::validate(&bad).is_err());
        }
        let mut bad = w.clone();
        bad.doctor.as_mut().unwrap().destination = "missing".into();
        assert!(crate::persistence::validate(&bad).is_err());
        let mut bad = w.clone();
        bad.lighthouses[1].sick = false;
        assert!(crate::persistence::validate(&bad).is_err());
        let mut bad = w;
        bad.lighthouses[0].immune_until = MAX_SAFE_INTEGER + 1;
        assert!(crate::persistence::validate(&bad).is_err());
    }
}
