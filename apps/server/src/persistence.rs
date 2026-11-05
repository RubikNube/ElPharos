use crate::domain::WorldState;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    save_version: u8,
    world: WorldState,
}

mod migrations;
pub use crate::validation::validate;
const SAVE_VERSION: u8 = 7;

pub fn save(path: &Path, world: &WorldState) -> Result<(), String> {
    validate(world)?;
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create save directory: {e}"))?;
    let temp = path.with_extension("json.tmp");
    let result = (|| -> Result<(), Box<dyn std::error::Error>> {
        let data = serde_json::to_vec_pretty(&Save {
            save_version: SAVE_VERSION,
            world: world.clone(),
        })?;
        let mut file = fs::File::create(&temp)?;
        file.write_all(&data)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        fs::File::open(parent)?.sync_all()?;
        Ok(())
    })();
    result.map_err(|e| format!("Could not save world: {e}"))
}

pub fn load(path: &Path) -> Result<WorldState, String> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|e| format!("Cannot open save: {e}"))?;
    let mut data = Vec::new();
    file.take(1_048_577)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() > 1_048_576 {
        return Err("Save file is too large".into());
    }
    migrations::decode(&data)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roundtrip_and_invalid_saves() {
        let dir = std::env::temp_dir().join(format!("el-pharos-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("world.json");
        assert!(load(&path).is_err());
        let mut world = crate::scenario::fixed_world();
        world.expand("beacon-1").unwrap();
        world.set_lighthouse_active("beacon-1", false).unwrap();
        save(&path, &world).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(
            serde_json::to_value(&loaded).unwrap(),
            serde_json::to_value(&world).unwrap()
        );
        let original = fs::read(&path).unwrap();
        world.lighthouses[0].radius = f64::NAN;
        assert!(save(&path, &world).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::write(&path, b"not json").unwrap();
        assert!(load(&path).is_err());
        fs::write(&path, br#"{"save_version":99,"world":{}}"#).unwrap();
        assert!(load(&path).is_err());
        assert!(save(&dir, &loaded).is_err());
        for world in [
            serde_json::json!(7),
            serde_json::json!([]),
            serde_json::Value::Null,
        ] {
            fs::write(
                &path,
                serde_json::to_vec(&serde_json::json!({"save_version": 4, "world": world}))
                    .unwrap(),
            )
            .unwrap();
            assert!(load(&path).is_err());
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn validates_ids_references_geometry_and_exploration() {
        let world = crate::scenario::fixed_world();
        let mut bad = world.clone();
        bad.islands.push(bad.islands[0].clone());
        assert!(validate(&bad).is_err());
        let mut bad = world.clone();
        bad.lighthouses[0].island_id = "missing".into();
        assert!(validate(&bad).is_err());
        let mut bad = world.clone();
        bad.lighthouses[0].explored_radius = 0.0;
        assert!(validate(&bad).is_err());
        let mut bad = world;
        bad.islands[0].position.x = -1.0;
        assert!(validate(&bad).is_err());
    }
}

#[cfg(test)]
mod economy_tests {
    use super::*;
    #[test]
    fn legacy_migration_and_economy_validation() {
        let path =
            std::env::temp_dir().join(format!("el-pharos-legacy-{}.json", std::process::id()));
        let mut world = crate::scenario::fixed_world();
        world.expand("beacon-1").unwrap();
        let mut legacy = serde_json::to_value(&world).unwrap();
        legacy.as_object_mut().unwrap().remove("economy");
        for island in legacy["islands"].as_array_mut().unwrap() {
            island.as_object_mut().unwrap().remove("fuel_facility");
        }
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({"save_version":1,"world":legacy})).unwrap(),
        )
        .unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.lighthouses[0].radius, 350.0);
        assert_eq!(loaded.economy.fuel, 300.0);
        // Format 2 keeps its whole balance, paused state, and upgraded radius.
        let mut previous = serde_json::to_value(&world).unwrap();
        previous["economy"]["fuel"] = 42.into();
        previous["economy"]["production"] = 2.into();
        for island in previous["islands"].as_array_mut().unwrap() {
            island.as_object_mut().unwrap().remove("fuel_facility");
        }
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({"save_version":2,"world":previous})).unwrap(),
        )
        .unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.economy.fuel, 42.0);
        assert_eq!(
            loaded
                .lighthouse_upkeep_at_radius(&loaded.lighthouses[0], loaded.lighthouses[0].radius),
            1.25
        );
        world.economy.fuel = 42.75;
        world.economy.paused = true;
        world.economy.elapsed_seconds = 90;
        save(&path, &world).unwrap();
        assert_eq!(
            serde_json::to_value(load(&path).unwrap()).unwrap(),
            serde_json::to_value(&world).unwrap()
        );
        let written: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(written["save_version"], 7);
        assert!(
            written["world"]["lighthouses"][0]
                .get("fuel_upkeep")
                .is_none()
        );
        for fuel in [-0.25, 601., 1.1, f64::NAN, f64::INFINITY] {
            world.economy.fuel = fuel;
            assert!(validate(&world).is_err());
        }
        world.economy.fuel = 601.0;
        assert!(validate(&world).is_err());
        world.economy.fuel = 0.0;
        world.islands[0].fuel_facility = crate::domain::FuelFacility::Ruined;
        assert!(validate(&world).is_err());
        fs::remove_file(path).unwrap();
    }
}

#[cfg(test)]
mod facility_tests {
    use super::*;
    use crate::domain::FuelFacility;

    #[test]
    fn facilities_roundtrip_legacy_three_and_invalid_states() {
        let path =
            std::env::temp_dir().join(format!("el-pharos-facilities-{}.json", std::process::id()));
        let mut world = crate::scenario::fixed_world();
        world.set_lighthouse_active("beacon-2", true).unwrap();
        world.restore_fuel_facility("island-2").unwrap();
        world.set_lighthouse_active("beacon-2", false).unwrap();
        save(&path, &world).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(saved["world"]["economy"].get("production").is_none());
        assert_eq!(load(&path).unwrap().production(), 2);
        for state in ["missing", "haven"] {
            let mut invalid = saved.clone();
            invalid["world"]["islands"][1]["fuel_facility"] = state.into();
            fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
            assert!(load(&path).is_err());
        }
        let mut missing = saved.clone();
        missing["world"]["islands"][0]["fuel_facility"] = "ruined".into();
        fs::write(&path, serde_json::to_vec(&missing).unwrap()).unwrap();
        assert!(load(&path).is_err());
        for world in [
            serde_json::json!(7),
            serde_json::json!([]),
            serde_json::json!({"economy": 7}),
        ] {
            fs::write(
                &path,
                serde_json::to_vec(&serde_json::json!({"save_version": 3, "world": world}))
                    .unwrap(),
            )
            .unwrap();
            assert!(load(&path).is_err());
        }
        let mut legacy = saved;
        legacy["save_version"] = 3.into();
        legacy["world"]["economy"]["production"] = 2.into();
        for island in legacy["world"]["islands"].as_array_mut().unwrap() {
            island.as_object_mut().unwrap().remove("fuel_facility");
        }
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        let migrated = load(&path).unwrap();
        assert_eq!(migrated.production(), 2);
        assert_eq!(migrated.economy.fuel, world.economy.fuel);
        assert_eq!(migrated.islands[1].fuel_facility, FuelFacility::Ruined);
        legacy["world"]["economy"]["production"] = 5.into();
        fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert!(load(&path).is_err());
        fs::remove_file(path).unwrap();
    }
}

#[cfg(test)]
mod specialization_tests {
    use super::*;
    #[test]
    fn specializations_roundtrip_and_format_five_migrates() {
        let path = std::env::temp_dir().join(format!(
            "el-pharos-specialization-{}.json",
            std::process::id()
        ));
        let mut world = crate::scenario::fixed_world();
        world
            .specialize("beacon-1", crate::domain::Specialization::EfficientLamp)
            .unwrap();
        save(&path, &world).unwrap();
        assert_eq!(
            serde_json::to_value(load(&path).unwrap()).unwrap(),
            serde_json::to_value(&world).unwrap()
        );
        let mut old = serde_json::to_value(&world).unwrap();
        for light in old["lighthouses"].as_array_mut().unwrap() {
            light.as_object_mut().unwrap().remove("specialization");
        }
        fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({"save_version":5,"world":old})).unwrap(),
        )
        .unwrap();
        let migrated = load(&path).unwrap();
        assert!(
            migrated
                .lighthouses
                .iter()
                .all(|l| l.specialization.is_none())
        );
        assert_eq!(migrated.salvage.unwrap().reserve, 60);
        fs::remove_file(path).unwrap();
    }
}
