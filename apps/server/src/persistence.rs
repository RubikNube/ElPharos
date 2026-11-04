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
            save_version: 1,
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
    let save: Save = serde_json::from_slice(&data).map_err(|e| format!("Invalid save: {e}"))?;
    if save.save_version != 1 {
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
