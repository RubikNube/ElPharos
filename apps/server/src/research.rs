//! Permanent research purchased from archives revealed by remembered exploration.
#[cfg(test)]
use crate::domain::Specialization;
use crate::domain::WorldState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Technology {
    ReinforcedFoundations,
    ModularFittings,
    StreamlinedHulls,
    ExpandedHolds,
    PrecisionLenses,
    ImprovedRefining,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Research {
    pub completed: Vec<Technology>,
}

#[derive(Serialize)]
pub struct Definition {
    pub id: Technology,
    pub name: &'static str,
    pub island_id: &'static str,
    pub prerequisite: Option<Technology>,
    pub cost: u32,
    pub effect: &'static str,
}

pub const CATALOG: [Definition; 6] = [
    Definition {
        id: Technology::ReinforcedFoundations,
        name: "Reinforced foundations",
        island_id: "island-2",
        prerequisite: None,
        cost: 40,
        effect: "Radius expansion costs 15 instead of 20 Salvage.",
    },
    Definition {
        id: Technology::ModularFittings,
        name: "Modular fittings",
        island_id: "island-2",
        prerequisite: Some(Technology::ReinforcedFoundations),
        cost: 80,
        effect: "Specialization installation costs 30 Salvage; refitting costs 15.",
    },
    Definition {
        id: Technology::StreamlinedHulls,
        name: "Streamlined hulls",
        island_id: "island-3",
        prerequisite: None,
        cost: 40,
        effect: "Base cargo speed increases from 60 to 75 units/second.",
    },
    Definition {
        id: Technology::ExpandedHolds,
        name: "Expanded holds",
        island_id: "island-3",
        prerequisite: Some(Technology::StreamlinedHulls),
        cost: 80,
        effect: "Ship cargo capacity increases from 20 to 30 Salvage.",
    },
    Definition {
        id: Technology::PrecisionLenses,
        name: "Precision lenses",
        island_id: "island-4",
        prerequisite: None,
        cost: 40,
        effect: "Efficient lamps save 0.75 instead of 0.5 fuel/second.",
    },
    Definition {
        id: Technology::ImprovedRefining,
        name: "Improved refining",
        island_id: "island-4",
        prerequisite: Some(Technology::PrecisionLenses),
        cost: 80,
        effect: "Connected restored fuel facilities produce 4 instead of 3 fuel/second. Haven still produces 2.",
    },
];

impl Technology {
    pub fn definition(self) -> &'static Definition {
        CATALOG.iter().find(|d| d.id == self).unwrap()
    }
}

#[derive(Serialize)]
pub struct TechnologySnapshot {
    #[serde(flatten)]
    pub definition: &'static Definition,
    pub discovered: bool,
    pub available: bool,
    pub blocked_reason: Option<&'static str>,
}

#[derive(Serialize)]
pub struct Snapshot<'a> {
    pub completed: &'a [Technology],
    pub catalog: Vec<TechnologySnapshot>,
}

impl WorldState {
    pub fn has_technology(&self, technology: Technology) -> bool {
        self.research
            .as_ref()
            .is_some_and(|r| r.completed.contains(&technology))
    }

    pub fn archive_discovered(&self, island_id: &str) -> bool {
        self.islands
            .iter()
            .find(|i| i.id == island_id)
            .is_some_and(|island| {
                self.lighthouses.iter().any(|light| {
                    light.explored_radius > 0.0
                        && (light.position.x - island.position.x)
                            .hypot(light.position.y - island.position.y)
                            <= light.explored_radius
                })
            })
    }

    fn research_block(&self, technology: Technology) -> Option<&'static str> {
        let definition = technology.definition();
        let Some(salvage) = self.salvage.as_ref().filter(|_| self.research.is_some()) else {
            return Some("Research requires the Salvage ruleset");
        };
        if self.has_technology(technology) {
            Some("Already researched")
        } else if !self.archive_discovered(definition.island_id) {
            Some("Discover this island's archive")
        } else if definition
            .prerequisite
            .is_some_and(|p| !self.has_technology(p))
        {
            Some("Complete the prerequisite technology")
        } else if salvage.reserve < definition.cost {
            Some("Not enough Salvage for research")
        } else {
            None
        }
    }

    pub fn research_technology(&mut self, technology: Technology) -> Result<bool, &'static str> {
        if self.research.is_some() && self.salvage.is_some() && self.has_technology(technology) {
            return Ok(false);
        }
        if let Some(reason) = self.research_block(technology) {
            return Err(reason);
        }
        let revision = self.next_revision()?;
        self.salvage.as_mut().unwrap().reserve -= technology.definition().cost;
        self.research.as_mut().unwrap().completed.push(technology);
        self.revision = revision;
        Ok(true)
    }

    pub fn research_snapshot(&self) -> Option<Snapshot<'_>> {
        self.research.as_ref().map(|research| Snapshot {
            completed: &research.completed,
            catalog: CATALOG
                .iter()
                .map(|definition| {
                    let blocked_reason = self.research_block(definition.id);
                    TechnologySnapshot {
                        definition,
                        discovered: self.archive_discovered(definition.island_id),
                        available: blocked_reason.is_none(),
                        blocked_reason,
                    }
                })
                .collect(),
        })
    }
}

pub fn validate(world: &WorldState) -> Result<(), String> {
    if world.research.is_some() != world.salvage.is_some() {
        return Err("Research must match the Salvage ruleset".into());
    }
    if let Some(research) = &world.research {
        let mut seen = std::collections::HashSet::new();
        for &id in &research.completed {
            let definition = id.definition();
            if !seen.insert(id)
                || !world.archive_discovered(definition.island_id)
                || definition
                    .prerequisite
                    .is_some_and(|p| !world.has_technology(p))
            {
                return Err("Invalid completed research".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use Technology::*;

    fn explored_world() -> WorldState {
        let mut w = crate::scenario::fixed_world();
        for n in 2..=4 {
            w.set_lighthouse_active(&format!("beacon-{n}"), true)
                .unwrap();
        }
        w
    }

    fn buy(w: &mut WorldState, technology: Technology) {
        w.salvage.as_mut().unwrap().reserve = technology.definition().cost;
        assert!(w.research_technology(technology).unwrap());
    }

    #[test]
    fn discovery_uses_inclusive_remembered_island_centers() {
        let mut w = crate::scenario::fixed_world();
        assert!(!w.archive_discovered("island-2"));
        assert!(!w.archive_discovered("missing"));
        w.islands[1].position = crate::domain::Point { x: 1090., y: 480. };
        assert!(w.archive_discovered("island-2"));
        w.set_lighthouse_active("beacon-1", false).unwrap();
        assert!(w.archive_discovered("island-2"));
        w.islands[1].position.x += 0.001;
        assert!(!w.archive_discovered("island-2"));
        // Upgrading an inactive beacon does not explore its surroundings.
        w.expand("beacon-1").unwrap();
        assert!(!w.archive_discovered("island-2"));
        w.set_lighthouse_active("beacon-1", true).unwrap();
        assert!(w.archive_discovered("island-2"));
    }

    #[test]
    fn purchases_check_discovery_prerequisites_and_funds_atomically() {
        let mut w = crate::scenario::fixed_world();
        let before = serde_json::to_value(&w).unwrap();
        assert_eq!(
            w.research_technology(ReinforcedFoundations),
            Err("Discover this island's archive")
        );
        assert_eq!(serde_json::to_value(&w).unwrap(), before);
        w.set_lighthouse_active("beacon-2", true).unwrap();
        assert_eq!(
            w.research_technology(ModularFittings),
            Err("Complete the prerequisite technology")
        );
        w.salvage.as_mut().unwrap().reserve = 39;
        let before = serde_json::to_value(&w).unwrap();
        assert_eq!(
            w.research_technology(ReinforcedFoundations),
            Err("Not enough Salvage for research")
        );
        assert_eq!(serde_json::to_value(&w).unwrap(), before);
        w.economy.paused = true;
        for l in &mut w.lighthouses {
            l.active = false;
        }
        w.economy.blackout = true;
        let revision = w.revision;
        buy(&mut w, ReinforcedFoundations);
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 0);
        assert_eq!(w.revision, revision + 1);
        let before = serde_json::to_value(&w).unwrap();
        assert!(!w.research_technology(ReinforcedFoundations).unwrap());
        assert_eq!(serde_json::to_value(&w).unwrap(), before);
        buy(&mut w, ModularFittings);
        crate::persistence::validate(&w).unwrap();
        w.salvage = None;
        w.research = None;
        assert_eq!(
            w.research_technology(ReinforcedFoundations),
            Err("Research requires the Salvage ruleset")
        );
    }

    #[test]
    fn construction_and_efficiency_apply_to_existing_and_future_lights() {
        let mut w = explored_world();
        w.specialize("beacon-1", Specialization::EfficientLamp)
            .unwrap();
        buy(&mut w, ReinforcedFoundations);
        w.salvage.as_mut().unwrap().reserve = 15;
        w.expand("beacon-1").unwrap();
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 0);
        buy(&mut w, ModularFittings);
        w.salvage.as_mut().unwrap().reserve = 45;
        w.specialize("beacon-2", Specialization::EfficientLamp)
            .unwrap();
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 15);
        w.specialize("beacon-2", Specialization::NavigationBeacon)
            .unwrap();
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 0);
        buy(&mut w, PrecisionLenses);
        assert_eq!(w.lighthouse_upkeep_at_radius(&w.lighthouses[0], 350.), 0.5);
        assert_eq!(w.lighthouse_upkeep_at_radius(&w.lighthouses[0], 410.), 0.75);
        w.salvage.as_mut().unwrap().reserve = 30;
        w.specialize("beacon-5", Specialization::EfficientLamp)
            .unwrap();
        // Activation uses the researched rate, including the exact reserve boundary.
        for light in &mut w.lighthouses {
            light.active = false;
        }
        w.economy.fuel = 0.25;
        w.set_lighthouse_active("beacon-5", true).unwrap();
        assert_eq!(w.upkeep(), 0.25);
        w.tick();
        assert_eq!(w.economy.fuel, 2.0);
        assert!(w.lighthouses[4].active);
        let snapshot = serde_json::to_value(crate::protocol::ServerMessage::WorldSnapshot {
            protocol_version: 10,
            world: &w,
        })
        .unwrap();
        assert_eq!(snapshot["world"]["lighthouses"][0]["fuel_upkeep"], 0.5);
        assert_eq!(
            snapshot["world"]["lighthouses"][0]["next_fuel_upkeep"],
            0.75
        );
        assert_eq!(
            snapshot["world"]["salvage"]["rules"]["specialization_cost"],
            30
        );
    }

    #[test]
    fn refining_requires_connected_restored_facilities_and_preserves_haven() {
        let mut w = explored_world();
        w.restore_fuel_facility("island-2").unwrap();
        assert_eq!(w.production(), 5);
        buy(&mut w, PrecisionLenses);
        buy(&mut w, ImprovedRefining);
        assert_eq!(w.production(), 6);
        w.set_lighthouse_active("beacon-2", false).unwrap();
        assert_eq!(w.production(), 2);
        w.set_lighthouse_active("beacon-2", true).unwrap();
        assert_eq!(w.production(), 6);
        w.set_lighthouse_active("beacon-1", false).unwrap();
        assert_eq!(w.production(), 2);
        let snapshot = serde_json::to_value(crate::protocol::ServerMessage::WorldSnapshot {
            protocol_version: 10,
            world: &w,
        })
        .unwrap();
        assert_eq!(
            snapshot["world"]["economy"]["restored_facility_production"],
            4
        );
    }

    #[test]
    fn shipping_upgrade_changes_current_leg_and_future_loads_without_stacking() {
        let mut w = explored_world();
        w.restore_salvage_yard("island-5").unwrap();
        w.set_lighthouse_active("beacon-5", true).unwrap();
        w.salvage.as_mut().unwrap().yards[0].stock = 50;
        w.tick();
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].cargo, 20);
        let previous = w.salvage.as_ref().unwrap().ships[0].progress;
        buy(&mut w, StreamlinedHulls);
        buy(&mut w, ExpandedHolds);
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].cargo, 20);
        let length = (800.0_f64 - 900.).hypot(480. - 310.);
        w.tick();
        let progress = w.salvage.as_ref().unwrap().ships[0].progress;
        assert!((progress - previous - 75. / length).abs() < 1e-10);
        w.set_lighthouse_active("beacon-1", false).unwrap();
        w.tick();
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].progress, progress);
        w.set_lighthouse_active("beacon-1", true).unwrap();
        w.salvage.as_mut().unwrap().reserve = 100;
        w.specialize("beacon-1", Specialization::NavigationBeacon)
            .unwrap();
        w.specialize("beacon-5", Specialization::NavigationBeacon)
            .unwrap();
        let rules = w.effective_rules();
        assert_eq!(
            rules.link_speed(&w.lighthouses[0], &w.lighthouses[4]),
            112.5
        );
        assert_eq!(
            rules.link_speed(&w.lighthouses[4], &w.lighthouses[0]),
            112.5
        );
        // Wait for the upgraded ship to finish its current cargo and return.
        for _ in 0..30 {
            w.tick();
            if w.salvage.as_ref().unwrap().ships[0].cargo == 30 {
                break;
            }
        }
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].cargo, 30);
        crate::persistence::validate(&w).unwrap();
        // Full Haven storage still retains upgraded cargo without loss.
        w.salvage.as_mut().unwrap().reserve = 300;
        for _ in 0..5 {
            w.tick();
        }
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].cargo, 30);
    }

    #[test]
    fn research_and_upgraded_cargo_roundtrip_and_invalid_research_is_rejected() {
        let path =
            std::env::temp_dir().join(format!("research-roundtrip-{}.json", std::process::id()));
        let mut w = explored_world();
        w.restore_salvage_yard("island-5").unwrap();
        w.set_lighthouse_active("beacon-5", true).unwrap();
        for id in CATALOG.iter().map(|d| d.id) {
            buy(&mut w, id);
        }
        w.salvage.as_mut().unwrap().yards[0].stock = 30;
        w.tick();
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].cargo, 30);
        crate::persistence::save(&path, &w).unwrap();
        let loaded = crate::persistence::load(&path).unwrap();
        assert_eq!(
            serde_json::to_value(&loaded).unwrap(),
            serde_json::to_value(&w).unwrap()
        );
        let saved: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        for completed in [
            serde_json::json!(["unknown"]),
            serde_json::json!(["reinforced_foundations", "reinforced_foundations"]),
            serde_json::json!(["expanded_holds"]),
        ] {
            let mut bad = saved.clone();
            bad["world"]["research"]["completed"] = completed;
            std::fs::write(&path, serde_json::to_vec(&bad).unwrap()).unwrap();
            assert!(crate::persistence::load(&path).is_err());
        }
        let mut bad = w.clone();
        for l in &mut bad.lighthouses {
            l.active = false;
            l.explored_radius = 0.;
        }
        assert!(crate::persistence::validate(&bad).is_err());
        for field in ["research", "completed"] {
            let mut bad = saved.clone();
            if field == "research" {
                bad["world"].as_object_mut().unwrap().remove(field);
            } else {
                bad["world"]["research"]
                    .as_object_mut()
                    .unwrap()
                    .remove(field);
            }
            std::fs::write(&path, serde_json::to_vec(&bad).unwrap()).unwrap();
            assert!(crate::persistence::load(&path).is_err());
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn format_six_migration_reveals_explored_archives_without_purchases() {
        let path =
            std::env::temp_dir().join(format!("research-migration-{}.json", std::process::id()));
        let mut w = explored_world();
        w.set_lighthouse_active("beacon-2", false).unwrap();
        w.specialize("beacon-1", Specialization::EfficientLamp)
            .unwrap();
        let mut old = serde_json::to_value(&w).unwrap();
        old.as_object_mut().unwrap().remove("research");
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({"save_version":6,"world":old})).unwrap(),
        )
        .unwrap();
        let loaded = crate::persistence::load(&path).unwrap();
        assert!(loaded.research.as_ref().unwrap().completed.is_empty());
        assert!(loaded.archive_discovered("island-2"));
        assert_eq!(loaded.salvage.as_ref().unwrap().reserve, 60);
        assert_eq!(
            loaded.lighthouses[0].specialization,
            Some(Specialization::EfficientLamp)
        );
        assert_eq!(loaded.effective_rules().expand_cost, 20);
        std::fs::remove_file(path).unwrap();
    }
}
