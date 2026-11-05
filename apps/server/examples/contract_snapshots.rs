//! Real wire messages for the Rust/TypeScript contract check.
use el_pharos_server::{
    domain::{FuelFacility, Specialization, WorldState},
    persistence,
    protocol::{ServerMessage, VERSION},
    research::CATALOG,
};

fn main() {
    let initial: WorldState =
        serde_json::from_str(include_str!("../../../tests/fixtures/fixed-world.json")).unwrap();
    let mut legacy = initial.clone();
    legacy.salvage = None;
    legacy.research = None;
    legacy.islands.truncate(4);
    legacy.lighthouses.truncate(4);

    let mut researched = initial.clone();
    for light in &mut researched.lighthouses {
        light.radius = 650.0;
        light.explored_radius = 650.0;
        light.active = true;
    }
    researched.research.as_mut().unwrap().completed = CATALOG.iter().map(|t| t.id).collect();
    researched.lighthouses[0].specialization = Some(Specialization::EfficientLamp);
    researched.lighthouses[4].specialization = Some(Specialization::NavigationBeacon);
    for island in &mut researched.islands {
        if island.fuel_facility == FuelFacility::Ruined {
            island.fuel_facility = FuelFacility::Restored;
        }
    }
    researched.restore_salvage_yard("island-5").unwrap();
    researched.restore_salvage_yard("island-6").unwrap();
    let salvage = researched.salvage.as_mut().unwrap();
    salvage.yards[0].delivered = true;
    salvage.ships[0].cargo = 30;
    salvage.ships[0].from = "beacon-5".into();
    salvage.ships[0].to = "beacon-1".into();
    salvage.ships[0].progress = 0.25;
    salvage.ships[0].route = vec!["beacon-5".into(), "beacon-1".into()];
    let mut paused = researched.clone();
    paused.set_paused(true).unwrap();
    let mut blackout = researched.clone();
    blackout.economy.fuel = 0.0;
    // Keep production below upkeep to exercise a real blackout tick.
    for island in &mut blackout.islands {
        if island.fuel_facility == FuelFacility::Restored {
            island.fuel_facility = FuelFacility::Ruined;
        }
    }
    blackout.tick();
    let worlds = [
        initial,
        legacy,
        researched,
        paused,
        blackout,
        WorldState::default(),
    ];
    let mut messages = Vec::new();
    for world in &worlds {
        persistence::validate(world).unwrap();
        messages.push(
            serde_json::to_value(ServerMessage::WorldSnapshot {
                protocol_version: VERSION,
                world,
            })
            .unwrap(),
        );
    }
    messages.push(
        serde_json::to_value(ServerMessage::Error {
            protocol_version: VERSION,
            message: "Invalid command",
        })
        .unwrap(),
    );
    messages.push(
        serde_json::to_value(ServerMessage::CommandResult {
            protocol_version: VERSION,
            request_id: "save",
            success: true,
            message: "Done",
        })
        .unwrap(),
    );
    println!("{}", serde_json::to_string(&messages).unwrap());
}
