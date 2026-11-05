//! Decode historical save formats without applying current scenario defaults.
use super::{SAVE_VERSION, Save, validate};
use crate::domain::WorldState;

pub(super) fn decode(data: &[u8]) -> Result<WorldState, String> {
    let mut value: serde_json::Value =
        serde_json::from_slice(data).map_err(|e| format!("Invalid save: {e}"))?;
    let legacy_version = value["save_version"]
        .as_u64()
        .ok_or("Invalid save version")?;
    if !(1..=u64::from(SAVE_VERSION)).contains(&legacy_version) {
        return Err("Unsupported save version".into());
    }
    // Legacy saves have no economy; migration is restricted to version 1.
    if value["save_version"] == 1 {
        add_legacy_economy(&mut value)?;
    }
    if value["save_version"] == 2 {
        migrate_whole_fuel(&mut value)?;
    }
    if value["save_version"] == 3 {
        add_fuel_facilities(&mut value)?;
    }
    if legacy_version >= 5 && value["world"].get("salvage").is_none() {
        return Err("Missing Salvage ruleset".into());
    }
    if legacy_version <= 4 {
        preserve_legacy_ruleset(&mut value)?;
    }
    if legacy_version <= 5 {
        add_specializations(&mut value)?;
    }
    if legacy_version <= 6 {
        add_research(&mut value)?;
    } else if value["world"].get("research").is_none() {
        return Err("Missing research state".into());
    }
    let save: Save = serde_json::from_value(value).map_err(|e| format!("Invalid save: {e}"))?;
    if save.save_version != SAVE_VERSION {
        return Err("Unsupported save version".into());
    }
    validate(&save.world)?;
    Ok(save.world)
}

fn add_legacy_economy(value: &mut serde_json::Value) -> Result<(), String> {
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

    Ok(())
}

fn migrate_whole_fuel(value: &mut serde_json::Value) -> Result<(), String> {
    // Format 2 stored whole fuel units. Preserve its balance and world geometry.
    if value["world"]["economy"]["fuel"].as_u64().is_none() {
        return Err("Invalid legacy fuel balance".into());
    }
    value["save_version"] = 3.into();

    Ok(())
}

fn add_fuel_facilities(value: &mut serde_json::Value) -> Result<(), String> {
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

    Ok(())
}

fn preserve_legacy_ruleset(value: &mut serde_json::Value) -> Result<(), String> {
    value
        .get_mut("world")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or("Invalid legacy world")?
        .insert("salvage".into(), serde_json::Value::Null);
    value["save_version"] = 5.into();

    Ok(())
}

fn add_specializations(value: &mut serde_json::Value) -> Result<(), String> {
    for light in value["world"]["lighthouses"]
        .as_array_mut()
        .ok_or("Invalid lighthouses")?
    {
        light
            .as_object_mut()
            .ok_or("Invalid lighthouse")?
            .insert("specialization".into(), serde_json::Value::Null);
    }
    value["save_version"] = 6.into();

    Ok(())
}

fn add_research(value: &mut serde_json::Value) -> Result<(), String> {
    let research = if value["world"]["salvage"].is_null() {
        serde_json::Value::Null
    } else {
        serde_json::json!({"completed": []})
    };
    value["world"]
        .as_object_mut()
        .ok_or("Invalid world")?
        .insert("research".into(), research);
    value["save_version"] = 7.into();

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn historical_save(version: u8) -> Value {
        let mut world = WorldState::default();
        if version <= 4 {
            world.islands.truncate(4);
            world.lighthouses.truncate(4);
            world.salvage = None;
            world.research = None;
        }
        let mut value = json!({ "save_version": version, "world": world });
        let world = value["world"].as_object_mut().unwrap();
        if version <= 6 {
            world.remove("research");
        }
        if version <= 5 {
            for light in world["lighthouses"].as_array_mut().unwrap() {
                light.as_object_mut().unwrap().remove("specialization");
            }
        }
        if version <= 4 {
            world.remove("salvage");
        }
        if version <= 3 {
            for island in world["islands"].as_array_mut().unwrap() {
                island.as_object_mut().unwrap().remove("fuel_facility");
            }
            world["economy"]["production"] = json!(2);
        }
        if version == 2 {
            world["economy"]["fuel"] = json!(300);
        }
        if version == 1 {
            world.remove("economy");
        }
        value
    }

    #[test]
    fn every_supported_format_preserves_geometry_and_roundtrips_as_current() {
        for version in 1..=SAVE_VERSION {
            let value = historical_save(version);
            let world = decode(&serde_json::to_vec(&value).unwrap()).unwrap();
            let persisted = serde_json::to_value(&world).unwrap();
            assert_eq!(persisted["width"], value["world"]["width"]);
            assert_eq!(
                persisted["lighthouses"][0]["position"],
                value["world"]["lighthouses"][0]["position"]
            );
            assert_eq!(world.islands.len(), if version <= 4 { 4 } else { 6 });
            assert_eq!(world.salvage.is_none(), version <= 4);
            assert_eq!(world.research.is_none(), version <= 4);
            let current = json!({ "save_version": SAVE_VERSION, "world": world });
            let reloaded = decode(&serde_json::to_vec(&current).unwrap()).unwrap();
            assert_eq!(serde_json::to_value(reloaded).unwrap(), persisted);
        }
    }

    #[test]
    fn malformed_versions_and_missing_required_state_are_rejected() {
        for version in 1..=SAVE_VERSION {
            let mut value = historical_save(version);
            value["world"]
                .as_object_mut()
                .unwrap()
                .remove("lighthouses");
            assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        for value in [
            json!(null),
            json!([]),
            json!({"save_version": 0}),
            json!({"save_version": 8}),
        ] {
            assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        for version in 5..=SAVE_VERSION {
            let mut value = historical_save(version);
            value["world"].as_object_mut().unwrap().remove("salvage");
            assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
        }
        let mut value = historical_save(SAVE_VERSION);
        value["world"].as_object_mut().unwrap().remove("research");
        assert!(decode(&serde_json::to_vec(&value).unwrap()).is_err());
    }
}
