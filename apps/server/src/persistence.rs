use crate::domain::WorldState;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Save {
    save_version: u8,
    world: WorldState,
}

pub fn validate(world: &WorldState) -> Result<(), String> {
    let e = &world.economy;
    if e.capacity != crate::domain::FUEL_CAPACITY
        || e.beacon_upkeep != crate::domain::BEACON_UPKEEP
        || !e.fuel.is_finite()
        || e.fuel < 0.0
        || e.fuel > f64::from(e.capacity)
        || (e.fuel * 4.0).fract() != 0.0
        || e.elapsed_seconds > 9_007_199_254_740_991
        || (e.blackout && world.lighthouses.iter().any(|l| l.active))
    {
        return Err("Invalid economy".into());
    }
    let positive = |v: f64| v.is_finite() && v > 0.0;
    if world.revision > 9_007_199_254_740_991
        || !positive(world.width)
        || !positive(world.height)
        || world.width > 10000.0
        || world.height > 10000.0
        || world.radius_step != 60.0
        || world.radius_max != 650.0
        || world.islands.is_empty()
        || world.islands.len() > 100
        || world.lighthouses.is_empty()
        || world.lighthouses.len() > 100
    {
        return Err("Invalid world dimensions or rules".into());
    }
    let position = |p: &crate::domain::Point| {
        p.x.is_finite()
            && p.y.is_finite()
            && p.x >= 0.0
            && p.x <= world.width
            && p.y >= 0.0
            && p.y <= world.height
    };
    if world
        .islands
        .iter()
        .filter(|island| island.fuel_facility == crate::domain::FuelFacility::Haven)
        .count()
        != 1
    {
        return Err("Expected exactly one Haven fuel facility".into());
    }
    let mut ids = HashSet::new();
    for island in &world.islands {
        if island.id.is_empty()
            || !ids.insert(&island.id)
            || island.name.len() > 200
            || !position(&island.position)
            || !positive(island.radius)
            || island.radius > 650.0
        {
            return Err("Invalid island".into());
        }
    }
    let mut light_ids = HashSet::new();
    for light in &world.lighthouses {
        if light.id.is_empty()
            || !light_ids.insert(&light.id)
            || !ids.contains(&light.island_id)
            || light.name.len() > 200
            || !position(&light.position)
            || !positive(light.radius)
            || light.radius > world.radius_max
            || !light.explored_radius.is_finite()
            || light.explored_radius < 0.0
            || light.explored_radius > light.radius
            || (light.active && light.explored_radius != light.radius)
        {
            return Err("Invalid lighthouse or exploration".into());
        }
    }
    Ok(())
}

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
            save_version: 4,
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
    let mut value: serde_json::Value =
        serde_json::from_slice(&data).map_err(|e| format!("Invalid save: {e}"))?;
    let legacy_version = value["save_version"]
        .as_u64()
        .ok_or("Invalid save version")?;
    if !(1..=4).contains(&legacy_version) {
        return Err("Unsupported save version".into());
    }
    // Legacy saves have no economy; migration is restricted to version 1.
    if value["save_version"] == 1 {
        let world = value
            .get_mut("world")
            .and_then(|w| w.as_object_mut())
            .ok_or("Invalid legacy world")?;
        if world.contains_key("economy") {
            return Err("Unexpected legacy economy".into());
        }
        world.insert(
            "economy".into(),
            serde_json::to_value(crate::domain::Economy::default()).unwrap(),
        );
        value["world"]["economy"]["production"] = 2.into();
        value["save_version"] = 3.into();
    }
    if value["save_version"] == 2 {
        // Format 2 stored whole fuel units. Preserve its balance and world geometry.
        if value["world"]["economy"]["fuel"].as_u64().is_none() {
            return Err("Invalid legacy fuel balance".into());
        }
        value["save_version"] = 3.into();
    }
    if value["save_version"] == 3 {
        let economy = value
            .get_mut("world")
            .and_then(|world| world.get_mut("economy"))
            .and_then(serde_json::Value::as_object_mut)
            .ok_or("Invalid legacy economy")?;
        if economy.remove("production") != Some(serde_json::json!(2)) {
            return Err("Invalid legacy production".into());
        }
        let islands = value
            .get_mut("world")
            .and_then(|world| world.get_mut("islands"))
            .and_then(serde_json::Value::as_array_mut)
            .ok_or("Invalid legacy islands")?;
        for (index, island) in islands.iter_mut().enumerate() {
            let island = island.as_object_mut().ok_or("Invalid legacy island")?;
            if island.contains_key("fuel_facility") {
                return Err("Unexpected legacy facility".into());
            }
            island.insert(
                "fuel_facility".into(),
                if index == 0 { "haven" } else { "ruined" }.into(),
            );
        }
        value["save_version"] = 4.into();
    }
    let save: Save = serde_json::from_value(value).map_err(|e| format!("Invalid save: {e}"))?;
    if save.save_version != 4 {
        return Err("Unsupported save version".into());
    }
    validate(&save.world)?;
    Ok(save.world)
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
        let mut world = WorldState::default();
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
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn validates_ids_references_geometry_and_exploration() {
        let world = WorldState::default();
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
        let mut world = WorldState::default();
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
        assert_eq!(loaded.lighthouses[0].upkeep(), 1.25);
        world.economy.fuel = 42.75;
        world.economy.paused = true;
        world.economy.elapsed_seconds = 90;
        save(&path, &world).unwrap();
        assert_eq!(
            serde_json::to_value(load(&path).unwrap()).unwrap(),
            serde_json::to_value(&world).unwrap()
        );
        let written: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(written["save_version"], 4);
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
        let mut world = WorldState::default();
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
