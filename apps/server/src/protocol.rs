use crate::domain::WorldState;
use serde::{Deserialize, Serialize};

pub const VERSION: u8 = 10;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientMessage {
    BuildSalvageVessel {
        protocol_version: u8,
    },
    SetSalvageVesselEnabled {
        protocol_version: u8,
        enabled: bool,
    },
    ResearchTechnology {
        protocol_version: u8,
        technology_id: crate::research::Technology,
    },
    SetLighthouseSpecialization {
        protocol_version: u8,
        lighthouse_id: String,
        specialization: crate::domain::Specialization,
    },
    RestoreSalvageYard {
        protocol_version: u8,
        island_id: String,
    },
    RestoreFuelFacility {
        protocol_version: u8,
        island_id: String,
    },
    SetSimulationPaused {
        protocol_version: u8,
        paused: bool,
    },
    SaveGame {
        protocol_version: u8,
        request_id: String,
    },
    LoadGame {
        protocol_version: u8,
        request_id: String,
    },
    RestartGame {
        protocol_version: u8,
        request_id: String,
    },
    ExpandLighthouseRadius {
        protocol_version: u8,
        lighthouse_id: String,
    },
    SetLighthouseActive {
        protocol_version: u8,
        lighthouse_id: String,
        active: bool,
    },
}

impl ClientMessage {
    pub fn version(&self) -> u8 {
        match self {
            ClientMessage::BuildSalvageVessel { protocol_version }
            | ClientMessage::SetSalvageVesselEnabled {
                protocol_version, ..
            }
            | ClientMessage::ResearchTechnology {
                protocol_version, ..
            }
            | ClientMessage::SetLighthouseSpecialization {
                protocol_version, ..
            }
            | ClientMessage::RestoreSalvageYard {
                protocol_version, ..
            }
            | ClientMessage::RestoreFuelFacility {
                protocol_version, ..
            }
            | ClientMessage::SetSimulationPaused {
                protocol_version, ..
            }
            | ClientMessage::SetLighthouseActive {
                protocol_version, ..
            }
            | ClientMessage::ExpandLighthouseRadius {
                protocol_version, ..
            }
            | ClientMessage::SaveGame {
                protocol_version, ..
            }
            | ClientMessage::LoadGame {
                protocol_version, ..
            }
            | ClientMessage::RestartGame {
                protocol_version, ..
            } => *protocol_version,
        }
    }

    pub fn request_id(&self) -> Option<String> {
        match self {
            ClientMessage::SaveGame { request_id, .. }
            | ClientMessage::LoadGame { request_id, .. }
            | ClientMessage::RestartGame { request_id, .. } => Some(request_id.clone()),
            _ => None,
        }
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage<'a> {
    CommandResult {
        protocol_version: u8,
        request_id: &'a str,
        success: bool,
        message: &'a str,
    },
    WorldSnapshot {
        protocol_version: u8,
        #[serde(serialize_with = "serialize_snapshot")]
        world: &'a WorldState,
    },
    Error {
        protocol_version: u8,
        message: &'a str,
    },
}

// Snapshot-only derived fields never enter domain state or save files.
fn serialize_snapshot<S: serde::Serializer>(
    world: &WorldState,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    use crate::domain::{Economy, FACILITY_RESTORE_COST, Island, Lighthouse};
    #[derive(Serialize)]
    struct Light<'a> {
        #[serde(flatten)]
        lighthouse: &'a Lighthouse,
        connected: bool,
        fuel_upkeep: f64,
        next_fuel_upkeep: Option<f64>,
    }
    #[derive(Serialize)]
    struct IslandSnapshot<'a> {
        #[serde(flatten)]
        island: &'a Island,
        fuel_production: u32,
    }
    #[derive(Serialize)]
    struct EconomySnapshot<'a> {
        #[serde(flatten)]
        economy: &'a Economy,
        production: u32,
        facility_restore_cost: u32,
        restored_facility_production: u32,
    }
    #[derive(Serialize)]
    struct Snapshot<'a> {
        economy: EconomySnapshot<'a>,
        salvage: Option<SalvageSnapshot<'a>>,
        research: Option<crate::research::Snapshot<'a>>,
        objective_complete: bool,
        shipping_links: Vec<ShippingLink<'a>>,
        revision: u64,
        radius_step: f64,
        radius_max: f64,
        width: f64,
        height: f64,
        islands: Vec<IslandSnapshot<'a>>,
        lighthouses: Vec<Light<'a>>,
    }
    #[derive(Serialize)]
    struct ShippingLink<'a> {
        from: &'a str,
        to: &'a str,
    }
    let network = crate::network::NetworkView::new(world);
    let connected = &network.connected;
    let shipping_links = network
        .links
        .iter()
        .map(|&(i, j)| ShippingLink {
            from: &world.lighthouses[i].id,
            to: &world.lighthouses[j].id,
        })
        .collect();
    Snapshot {
        salvage: world.salvage.as_ref().map(|data| SalvageSnapshot {
            data,
            vessel_route: world.vessel_route(),
            rules: world.effective_rules(),
        }),
        research: world.research_snapshot(),
        objective_complete: world.objective_with_network(&network),
        shipping_links,
        economy: EconomySnapshot {
            economy: &world.economy,
            production: world.production_with_network(&network),
            facility_restore_cost: FACILITY_RESTORE_COST,
            restored_facility_production: world.restored_fuel_production(),
        },
        revision: world.revision,
        radius_step: world.radius_step,
        radius_max: world.radius_max,
        width: world.width,
        height: world.height,
        islands: world
            .islands
            .iter()
            .map(|island| IslandSnapshot {
                island,
                fuel_production: world.facility_production(island, connected),
            })
            .collect(),
        lighthouses: world
            .lighthouses
            .iter()
            .enumerate()
            .map(|(i, lighthouse)| Light {
                connected: connected[i],
                lighthouse,
                fuel_upkeep: world.lighthouse_upkeep_at_radius(lighthouse, lighthouse.radius),
                next_fuel_upkeep: (lighthouse.radius < world.radius_max).then(|| {
                    world.lighthouse_upkeep_at_radius(
                        lighthouse,
                        (lighthouse.radius + world.radius_step).min(world.radius_max),
                    )
                }),
            })
            .collect(),
    }
    .serialize(serializer)
}

#[derive(Serialize)]
struct SalvageSnapshot<'a> {
    #[serde(flatten)]
    data: &'a crate::salvage::Salvage,
    vessel_route: Option<[crate::domain::Point; 2]>,
    rules: crate::rules::EffectiveRules,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_include_derived_upkeep_and_cap_preview() {
        let mut world = crate::scenario::fixed_world();
        world
            .specialize("beacon-1", crate::domain::Specialization::EfficientLamp)
            .unwrap();
        world.expand("beacon-1").unwrap();
        world.lighthouses[1].radius = 650.;
        let message = serde_json::to_value(ServerMessage::WorldSnapshot {
            protocol_version: VERSION,
            world: &world,
        })
        .unwrap();
        let lights = &message["world"]["lighthouses"];
        assert_eq!(lights[0]["fuel_upkeep"], 0.75);
        assert_eq!(lights[0]["next_fuel_upkeep"], 1.0);
        assert_eq!(lights[1]["fuel_upkeep"], 2.5);
        assert!(lights[1]["next_fuel_upkeep"].is_null());
    }
    #[test]
    fn snapshots_derive_links_production_and_objective_without_persisting_them() {
        let mut world = WorldState {
            salvage: None,
            research: None,
            ..crate::scenario::fixed_world()
        };
        world.islands.truncate(4);
        world.lighthouses.truncate(4);
        for light in &mut world.lighthouses {
            light.active = true;
        }
        for island in &mut world.islands[1..] {
            island.fuel_facility = crate::domain::FuelFacility::Restored;
        }
        let snapshot = |w: &WorldState| {
            serde_json::to_value(ServerMessage::WorldSnapshot {
                protocol_version: VERSION,
                world: w,
            })
            .unwrap()["world"]
                .clone()
        };
        let connected = snapshot(&world);
        assert_eq!(connected["objective_complete"], true);
        assert_eq!(connected["shipping_links"].as_array().unwrap().len(), 3);
        assert_eq!(connected["economy"]["production"], 11);
        world.lighthouses[1].active = false;
        let isolated = snapshot(&world);
        assert_eq!(isolated["objective_complete"], false);
        assert_eq!(isolated["shipping_links"], serde_json::json!([]));
        assert_eq!(isolated["economy"]["production"], 2);
        let persisted = serde_json::to_value(&world).unwrap();
        assert!(persisted.get("shipping_links").is_none());
        assert!(persisted.get("objective_complete").is_none());
        assert!(persisted["lighthouses"][0].get("connected").is_none());
    }
}
