//! Invariants required by the domain, independent of save storage.
use crate::domain::WorldState;
use std::collections::HashSet;

pub fn validate(world: &WorldState) -> Result<(), String> {
    let e = &world.economy;
    if e.capacity != crate::domain::FUEL_CAPACITY
        || e.beacon_upkeep != crate::domain::BEACON_UPKEEP
        || !e.fuel.is_finite()
        || e.fuel < 0.0
        || e.fuel > f64::from(e.capacity)
        || (e.fuel * 4.0).fract() != 0.0
        || e.elapsed_seconds > crate::domain::MAX_SAFE_INTEGER
        || (e.blackout && world.lighthouses.iter().any(|l| l.active))
    {
        return Err("Invalid economy".into());
    }
    let positive = |v: f64| v.is_finite() && v > 0.0;
    if world.revision > crate::domain::MAX_SAFE_INTEGER
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
        if (world.salvage.is_none() && light.specialization.is_some())
            || light.id.is_empty()
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
    crate::research::validate(world)?;
    crate::salvage::validate(world)?;
    Ok(())
}
