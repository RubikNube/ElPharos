//! Fuel-funded expeditions independent of the lighthouse shipping network.
use crate::domain::{FuelFacility, Point, WorldState};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Docked,
    Outbound,
    Searching,
    Returning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Vessel {
    pub enabled: bool,
    pub phase: Phase,
    pub timer: u32,
    pub cargo: u32,
}

#[derive(Serialize)]
pub struct VesselRules {
    pub build_fuel: u32,
    pub trip_fuel: u32,
    pub fuel_reserve: u32,
    pub hold: u32,
    pub travel_seconds: u32,
    pub salvage_period: u32,
}
impl Default for VesselRules {
    fn default() -> Self {
        Self {
            build_fuel: 200,
            trip_fuel: 120,
            fuel_reserve: 120,
            hold: 40,
            travel_seconds: 5,
            salvage_period: 2,
        }
    }
}

impl WorldState {
    /// A short deterministic water-only route, with a dock just off Haven's shore.
    /// Derived from immutable map geometry; never grants exploration.
    pub fn vessel_route(&self) -> Option<[Point; 2]> {
        let haven = self
            .islands
            .iter()
            .find(|i| i.fuel_facility == FuelFacility::Haven)?;
        for n in 0..32 {
            let angle = f64::from(n) * std::f64::consts::TAU / 32.0;
            let point = |radius: f64| Point {
                x: haven.position.x + angle.cos() * radius,
                y: haven.position.y + angle.sin() * radius,
            };
            let a = point(haven.radius + 16.0);
            let b = point(haven.radius + 116.0);
            let inside = |p: &Point| {
                p.x >= 16.0 && p.y >= 16.0 && p.x <= self.width - 16.0 && p.y <= self.height - 16.0
            };
            if !inside(&a) || !inside(&b) {
                continue;
            }
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            if self.islands.iter().all(|island| {
                let t = (((island.position.x - a.x) * dx + (island.position.y - a.y) * dy)
                    / (dx * dx + dy * dy))
                    .clamp(0.0, 1.0);
                (a.x + t * dx - island.position.x).hypot(a.y + t * dy - island.position.y)
                    >= island.radius + 12.0
            }) {
                return Some([a, b]);
            }
        }
        None
    }

    pub fn build_salvage_vessel(&mut self) -> Result<bool, &'static str> {
        let s = self
            .salvage
            .as_ref()
            .ok_or("Salvage vessels are unavailable in legacy games")?;
        if s.vessel.is_some() {
            return Ok(false);
        }
        let rules = VesselRules::default();
        if self.economy.fuel < f64::from(rules.build_fuel) {
            return Err("Construction requires 200 fuel");
        }
        if self.vessel_route().is_none() {
            return Err("No nearby water route for the salvage vessel");
        }
        let revision = self.next_revision()?;
        self.economy.fuel -= f64::from(rules.build_fuel);
        self.salvage.as_mut().unwrap().vessel = Some(Vessel {
            enabled: true,
            phase: Phase::Docked,
            timer: 0,
            cargo: 0,
        });
        self.revision = revision;
        Ok(true)
    }

    pub fn set_salvage_vessel_enabled(&mut self, enabled: bool) -> Result<bool, &'static str> {
        let vessel = self
            .salvage
            .as_ref()
            .and_then(|s| s.vessel.as_ref())
            .ok_or("Build a salvage vessel first")?;
        if vessel.enabled == enabled {
            return Ok(false);
        }
        let revision = self.next_revision()?;
        self.salvage
            .as_mut()
            .unwrap()
            .vessel
            .as_mut()
            .unwrap()
            .enabled = enabled;
        self.revision = revision;
        Ok(true)
    }

    pub fn tick_salvage_vessel(&mut self) {
        let Some(s) = self.salvage.as_mut() else {
            return;
        };
        let Some(v) = s.vessel.as_mut() else {
            return;
        };
        let r = VesselRules::default();
        match v.phase {
            Phase::Docked => {
                let amount = v.cargo.min(crate::salvage::CAPACITY - s.reserve);
                s.reserve += amount;
                v.cargo -= amount;
                if v.enabled
                    && v.cargo == 0
                    && crate::salvage::CAPACITY - s.reserve >= r.hold
                    && self.economy.fuel >= f64::from(r.trip_fuel + r.fuel_reserve)
                {
                    self.economy.fuel -= f64::from(r.trip_fuel);
                    v.phase = Phase::Outbound;
                }
            }
            Phase::Outbound | Phase::Returning => {
                v.timer += 1;
                if v.timer == r.travel_seconds {
                    v.timer = 0;
                    v.phase = if v.phase == Phase::Outbound {
                        Phase::Searching
                    } else {
                        Phase::Docked
                    };
                    if v.phase == Phase::Docked {
                        let amount = v.cargo.min(crate::salvage::CAPACITY - s.reserve);
                        s.reserve += amount;
                        v.cargo -= amount;
                    }
                }
            }
            Phase::Searching => {
                v.timer += 1;
                if v.timer.is_multiple_of(r.salvage_period) {
                    v.cargo += 1;
                }
                if v.cargo == r.hold {
                    v.phase = Phase::Returning;
                    v.timer = 0;
                }
            }
        }
    }
}

pub fn validate(world: &WorldState) -> Result<(), String> {
    if let Some(v) = world.salvage.as_ref().and_then(|s| s.vessel.as_ref()) {
        let r = VesselRules::default();
        let valid = match v.phase {
            Phase::Docked => v.timer == 0,
            Phase::Outbound => v.timer < r.travel_seconds && v.cargo == 0,
            Phase::Searching => {
                v.timer < r.hold * r.salvage_period && v.cargo == v.timer / r.salvage_period
            }
            Phase::Returning => v.timer < r.travel_seconds && v.cargo == r.hold,
        };
        if !valid || v.cargo > r.hold || world.vessel_route().is_none() {
            return Err("Invalid salvage vessel".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        persistence,
        protocol::{ClientMessage, VERSION},
    };

    fn built() -> WorldState {
        let mut w = crate::scenario::fixed_world();
        assert!(w.build_salvage_vessel().unwrap());
        w
    }
    fn vessel(w: &WorldState) -> &Vessel {
        w.salvage.as_ref().unwrap().vessel.as_ref().unwrap()
    }
    fn advance(w: &mut WorldState, ticks: u32) {
        for _ in 0..ticks {
            w.tick_salvage_vessel();
            persistence::validate(w).unwrap();
        }
    }

    #[test]
    fn construction_commands_and_revision_are_atomic() {
        let mut w = crate::scenario::fixed_world();
        w.economy.fuel = 199.0;
        let original = serde_json::to_value(&w).unwrap();
        assert!(w.build_salvage_vessel().is_err());
        assert_eq!(serde_json::to_value(&w).unwrap(), original);
        assert!(w.set_salvage_vessel_enabled(false).is_err());
        w.economy.fuel = 200.0;
        let reserve = w.salvage.as_ref().unwrap().reserve;
        assert!(w.build_salvage_vessel().unwrap());
        assert_eq!(w.economy.fuel, 0.0);
        assert_eq!(w.salvage.as_ref().unwrap().reserve, reserve);
        let revision = w.revision;
        assert!(!w.build_salvage_vessel().unwrap());
        assert!(!w.set_salvage_vessel_enabled(true).unwrap());
        assert_eq!(w.revision, revision);
        assert!(w.set_salvage_vessel_enabled(false).unwrap());
        assert_eq!(w.revision, revision + 1);
        for json in [
            format!(r#"{{"type":"build_salvage_vessel","protocol_version":{VERSION}}}"#),
            format!(
                r#"{{"type":"set_salvage_vessel_enabled","protocol_version":{VERSION},"enabled":false}}"#
            ),
        ] {
            assert_eq!(
                serde_json::from_str::<ClientMessage>(&json)
                    .unwrap()
                    .version(),
                VERSION
            );
        }
        assert!(
            serde_json::from_str::<ClientMessage>(&format!(
                r#"{{"type":"set_salvage_vessel_enabled","protocol_version":{VERSION}}}"#
            ))
            .is_err()
        );
        w.salvage = None;
        assert!(w.build_salvage_vessel().is_err());
    }

    #[test]
    fn departure_thresholds_and_repeat_expeditions() {
        let mut w = built();
        w.economy.fuel = 239.75;
        advance(&mut w, 1);
        assert_eq!(vessel(&w).phase, Phase::Docked);
        w.economy.fuel = 240.0;
        w.salvage.as_mut().unwrap().reserve = 261;
        advance(&mut w, 1);
        assert_eq!(w.economy.fuel, 240.0);
        w.salvage.as_mut().unwrap().reserve = 260;
        advance(&mut w, 1);
        assert_eq!(w.economy.fuel, 120.0);
        assert_eq!(vessel(&w).phase, Phase::Outbound);
        advance(&mut w, 5);
        assert_eq!(vessel(&w).phase, Phase::Searching);
        advance(&mut w, 79);
        assert_eq!(vessel(&w).cargo, 39);
        advance(&mut w, 1);
        assert_eq!(vessel(&w).phase, Phase::Returning);
        advance(&mut w, 5);
        assert_eq!(vessel(&w).phase, Phase::Docked);
        assert_eq!(vessel(&w).cargo, 0);
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 300);
        assert_eq!(w.economy.fuel, 120.0);
        assert!(
            w.salvage
                .as_ref()
                .unwrap()
                .yards
                .iter()
                .all(|y| !y.delivered)
        );
        w.salvage.as_mut().unwrap().reserve = 260;
        w.economy.fuel = 240.0;
        advance(&mut w, 1);
        assert_eq!(vessel(&w).phase, Phase::Outbound);
    }

    #[test]
    fn disable_finishes_trip_and_storage_retains_cargo() {
        let mut w = built();
        w.economy.fuel = 600.0;
        advance(&mut w, 1);
        w.set_salvage_vessel_enabled(false).unwrap();
        w.salvage.as_mut().unwrap().reserve = 290;
        advance(&mut w, 90);
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 300);
        assert_eq!(vessel(&w).cargo, 30);
        advance(&mut w, 10);
        assert_eq!(vessel(&w).cargo, 30);
        w.salvage.as_mut().unwrap().reserve = 280;
        advance(&mut w, 1);
        assert_eq!(vessel(&w).cargo, 10);
        w.salvage.as_mut().unwrap().reserve = 200;
        advance(&mut w, 1);
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 210);
        assert_eq!(vessel(&w).cargo, 0);
        assert_eq!(vessel(&w).phase, Phase::Docked);
        w.set_salvage_vessel_enabled(true).unwrap();
        advance(&mut w, 1);
        assert_eq!(w.economy.fuel, 360.0);
        assert_eq!(vessel(&w).phase, Phase::Outbound);
    }

    #[test]
    fn pause_and_blackout_preserve_expeditions_and_exploration() {
        let mut w = built();
        w.economy.fuel = 240.0;
        advance(&mut w, 1);
        w.set_paused(true).unwrap();
        let original = serde_json::to_value(&w).unwrap();
        assert!(!w.tick());
        assert_eq!(serde_json::to_value(&w).unwrap(), original);
        w.set_paused(false).unwrap();
        w.economy.fuel = 0.0;
        for l in &mut w.lighthouses {
            l.active = true;
        }
        let explored: Vec<_> = w.lighthouses.iter().map(|l| l.explored_radius).collect();
        for _ in 0..90 {
            w.tick();
        }
        assert!(w.economy.blackout);
        assert_eq!(vessel(&w).phase, Phase::Docked);
        assert_eq!(vessel(&w).cargo, 0);
        assert_eq!(
            w.lighthouses
                .iter()
                .map(|l| l.explored_radius)
                .collect::<Vec<_>>(),
            explored
        );
    }

    #[test]
    fn saves_resume_every_phase_and_reject_invalid_states() {
        let mut w = built();
        w.economy.fuel = 600.0;
        let path =
            std::env::temp_dir().join(format!("el-pharos-vessel-{}.json", std::process::id()));
        for ticks in [0, 3, 9, 76, 3] {
            advance(&mut w, ticks);
            persistence::save(&path, &w).unwrap();
            let mut loaded = persistence::load(&path).unwrap();
            assert_eq!(
                serde_json::to_value(&w).unwrap(),
                serde_json::to_value(&loaded).unwrap()
            );
            let mut continued = w.clone();
            advance(&mut continued, 7);
            advance(&mut loaded, 7);
            assert_eq!(
                serde_json::to_value(continued).unwrap(),
                serde_json::to_value(loaded).unwrap()
            );
        }
        std::fs::remove_file(path).unwrap();
        for (phase, timer, cargo) in [
            (Phase::Docked, 1, 0),
            (Phase::Outbound, 0, 1),
            (Phase::Outbound, 5, 0),
            (Phase::Searching, 3, 2),
            (Phase::Searching, 80, 40),
            (Phase::Returning, 0, 39),
            (Phase::Docked, 0, 41),
        ] {
            let v = w.salvage.as_mut().unwrap().vessel.as_mut().unwrap();
            *v = Vessel {
                enabled: true,
                phase,
                timer,
                cargo,
            };
            assert!(persistence::validate(&w).is_err());
        }
    }

    #[test]
    fn random_maps_have_water_routes() {
        for _ in 0..100 {
            let w = WorldState::default();
            assert!(w.vessel_route().is_some());
        }
    }
}
