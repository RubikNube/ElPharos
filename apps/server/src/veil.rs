//! Recurring, telegraphed attacks on the connected lighthouse network.
use crate::domain::{FuelFacility, WorldState};
use serde::{Deserialize, Serialize};

pub const WARD_FUEL: u32 = 40;
pub const APPROACH_SECONDS: u16 = 60;
pub const COOLDOWN_SECONDS: u16 = 120;
pub const WARD_SECONDS: u16 = 90;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Veil {
    pub target: Option<String>,
    pub approach_remaining: u16,
    pub cooldown_remaining: u16,
    pub ward_remaining: u16,
    pub defended: u8,
    pub next_target_index: usize,
}

impl Veil {
    pub fn complete(&self) -> bool {
        self.defended >= 3
    }
}

impl WorldState {
    pub fn ward_veil_target(&mut self, id: &str) -> Result<bool, &'static str> {
        let veil = self
            .veil
            .as_ref()
            .ok_or("The Veil is not active in this world")?;
        if veil.target.as_deref() != Some(id) {
            return Err("This lighthouse is not the current Veil target");
        }
        if veil.ward_remaining > 0 {
            return Ok(false);
        }
        if self.economy.fuel < f64::from(WARD_FUEL) {
            return Err("Not enough fuel to ward the beacon");
        }
        let revision = self.next_revision()?;
        self.economy.fuel -= f64::from(WARD_FUEL);
        self.veil.as_mut().unwrap().ward_remaining = WARD_SECONDS;
        self.revision = revision;
        Ok(true)
    }

    pub(crate) fn tick_veil(&mut self) {
        let Some(mut veil) = self.veil.take() else {
            return;
        };
        if let Some(target) = veil.target.clone() {
            veil.approach_remaining -= 1;
            if veil.ward_remaining > 0 {
                veil.ward_remaining -= 1;
            }
            if veil.approach_remaining == 0 {
                let connected = self.connected_beacons();
                let defended = veil.ward_remaining > 0
                    && self
                        .lighthouses
                        .iter()
                        .any(|light| light.id == target && light.active)
                    && self
                        .lighthouses
                        .iter()
                        .enumerate()
                        .any(|(index, light)| light.id == target && connected[index]);
                if defended {
                    veil.defended = veil.defended.saturating_add(1).min(3);
                } else if let Some(light) =
                    self.lighthouses.iter_mut().find(|light| light.id == target)
                {
                    light.active = false;
                }
                veil.target = None;
                veil.ward_remaining = 0;
                veil.cooldown_remaining = COOLDOWN_SECONDS;
            }
            self.veil = Some(veil);
            return;
        }
        if veil.cooldown_remaining > 0 {
            veil.cooldown_remaining -= 1;
            if veil.cooldown_remaining > 0 {
                self.veil = Some(veil);
                return;
            }
        }
        let connected = self.connected_beacons();
        let count = self.lighthouses.len();
        for offset in 0..count {
            let index = (veil.next_target_index + offset) % count;
            let light = &self.lighthouses[index];
            let remote = self.islands.iter().any(|island| {
                island.id == light.island_id && island.fuel_facility != FuelFacility::Haven
            });
            if remote && light.active && connected[index] {
                veil.target = Some(light.id.clone());
                veil.approach_remaining = APPROACH_SECONDS;
                veil.next_target_index = (index + 1) % count;
                self.veil = Some(veil);
                return;
            }
        }
        self.veil = Some(veil);
    }
}

pub fn validate(world: &WorldState) -> Result<(), String> {
    let Some(veil) = &world.veil else {
        return if world.salvage.is_none() {
            Ok(())
        } else {
            Err("Missing Veil state".into())
        };
    };
    if world.salvage.is_none()
        || veil.defended > 3
        || veil.next_target_index >= world.lighthouses.len()
        || veil.cooldown_remaining > COOLDOWN_SECONDS
        || veil.ward_remaining > WARD_SECONDS
        || match &veil.target {
            Some(id) => {
                veil.cooldown_remaining != 0
                    || !(1..=APPROACH_SECONDS).contains(&veil.approach_remaining)
                    || !world.lighthouses.iter().any(|light| {
                        light.id == *id
                            && world.islands.iter().any(|island| {
                                island.id == light.island_id
                                    && island.fuel_facility != FuelFacility::Haven
                            })
                    })
            }
            None => veil.approach_remaining != 0 || veil.ward_remaining != 0,
        }
    {
        return Err("Invalid Veil state".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn linked() -> WorldState {
        let mut world = crate::scenario::fixed_world();
        for light in &mut world.lighthouses {
            light.immune_until = crate::domain::MAX_SAFE_INTEGER;
        }
        world.set_lighthouse_active("beacon-5", true).unwrap();
        assert!(world.connected_beacons()[4]);
        world
    }

    #[test]
    fn warning_ward_pause_and_three_defenses() {
        let mut world = linked();
        for success in 1..=3 {
            while world.veil.as_ref().unwrap().target.is_none() {
                world.tick();
            }
            let target = world.veil.as_ref().unwrap().target.clone().unwrap();
            assert_eq!(target, "beacon-5");
            assert_eq!(
                world.veil.as_ref().unwrap().approach_remaining,
                APPROACH_SECONDS
            );
            let fuel = world.economy.fuel;
            assert!(world.ward_veil_target(&target).unwrap());
            assert_eq!(world.economy.fuel, fuel - f64::from(WARD_FUEL));
            assert!(!world.ward_veil_target(&target).unwrap());
            world.set_paused(true).unwrap();
            assert!(!world.tick());
            assert_eq!(
                world.veil.as_ref().unwrap().approach_remaining,
                APPROACH_SECONDS
            );
            world.set_paused(false).unwrap();
            for _ in 0..APPROACH_SECONDS {
                world.tick();
            }
            assert!(world.lighthouses[4].active);
            assert_eq!(world.veil.as_ref().unwrap().defended, success);
            assert_eq!(
                world.veil.as_ref().unwrap().cooldown_remaining,
                COOLDOWN_SECONDS
            );
        }
        assert!(world.veil.as_ref().unwrap().complete());
        assert!(!world.objective_complete());
        validate(&world).unwrap();
    }

    #[test]
    fn unwarded_strike_extinguishes_and_relight_recovers() {
        let mut world = linked();
        world.tick();
        assert_eq!(
            world.veil.as_ref().unwrap().target.as_deref(),
            Some("beacon-5")
        );
        assert_eq!(
            world.ward_veil_target("beacon-2"),
            Err("This lighthouse is not the current Veil target")
        );
        for _ in 0..APPROACH_SECONDS {
            world.tick();
        }
        assert!(!world.lighthouses[4].active);
        assert!(!world.connected_beacons()[4]);
        assert_eq!(world.veil.as_ref().unwrap().defended, 0);
        assert_eq!(world.lighthouses[4].explored_radius, 290.0);
        world.set_lighthouse_active("beacon-5", true).unwrap();
        assert!(world.connected_beacons()[4]);
    }

    #[test]
    fn fronts_rotate_among_connected_targets_after_cooldown() {
        let mut world = linked();
        world.set_lighthouse_active("beacon-2", true).unwrap();
        world.tick();
        assert_eq!(
            world.veil.as_ref().unwrap().target.as_deref(),
            Some("beacon-2")
        );
        world.ward_veil_target("beacon-2").unwrap();
        for _ in 0..APPROACH_SECONDS {
            world.tick();
        }
        for _ in 0..COOLDOWN_SECONDS {
            world.tick();
        }
        assert_eq!(
            world.veil.as_ref().unwrap().target.as_deref(),
            Some("beacon-5")
        );
    }

    #[test]
    fn save_load_resumes_warning_and_rejects_invalid_state() {
        let mut world = linked();
        world.tick();
        world.ward_veil_target("beacon-5").unwrap();
        for _ in 0..10 {
            world.tick();
        }
        let path = std::env::temp_dir().join(format!("veil-{}.json", std::process::id()));
        crate::persistence::save(&path, &world).unwrap();
        let loaded = crate::persistence::load(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(loaded.veil.unwrap().approach_remaining, 50);
        world.veil.as_mut().unwrap().ward_remaining = 91;
        assert!(validate(&world).is_err());
    }
}
