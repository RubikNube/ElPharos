//! Initial archipelago; save migration never recreates this scenario.
use crate::domain::*;

pub fn new_world() -> WorldState {
    let mut world = WorldState {
        research: Some(crate::research::Research::default()),
        salvage: Some(crate::salvage::Salvage::default()),
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
            specialization: None,
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
            specialization: None,
            id: format!("beacon-{n}"),
            island_id: format!("island-{n}"),
            name: format!("{name} Light"),
            position: Point { x, y: y - 20.0 },
            radius: 290.0,
            active: false,
            explored_radius: 0.0,
        });
    }
    for (n, x, y, name) in [
        (5, 900.0, 330.0, "Wreckers' Cove"),
        (6, 1000.0, 680.0, "Iron Shoal"),
    ] {
        world.islands.push(Island {
            fuel_facility: FuelFacility::None,
            id: format!("island-{n}"),
            name: name.into(),
            position: Point { x, y },
            radius: 65.0,
        });
        world.lighthouses.push(Lighthouse {
            specialization: None,
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
