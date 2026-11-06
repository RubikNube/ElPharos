//! Fresh archipelagos. Loading a save never invokes the generator.
use crate::domain::*;
use rand::{Rng, SeedableRng, rngs::StdRng, seq::SliceRandom};
use std::collections::BTreeSet;

const GENERATION_ATTEMPTS: usize = 8;
const GUARANTEED_RADIUS: f64 = 470.0;

pub fn new_world() -> WorldState {
    seeded_world(rand::random())
}

fn seeded_world(seed: u64) -> WorldState {
    let mut rng = StdRng::seed_from_u64(seed);
    let count = rng.random_range(6..=12);
    for _ in 0..GENERATION_ATTEMPTS {
        let world = generate(&mut rng, count, 35.0);
        if playable(&world) {
            return world;
        }
    }
    // Zero jitter on the same connected lattice is a bounded, safe fallback.
    let world = generate(&mut StdRng::seed_from_u64(0), count, 0.0);
    assert!(playable(&world), "Invalid archipelago fallback");
    world
}

fn generate(rng: &mut StdRng, count: usize, jitter: f64) -> WorldState {
    let minimum_fuel = (((7 * count).saturating_sub(8)).div_ceil(12)).max(3);
    let fuel_count = rng.random_range(minimum_fuel..=(minimum_fuel + 1).min(count - 3));
    let mut extra_ids: Vec<_> = (7..=count).collect();
    extra_ids.shuffle(rng);
    let fuel_ids: BTreeSet<_> = (2..=4)
        .chain(extra_ids.into_iter().take(fuel_count - 3))
        .collect();

    // Grow a random tree through adjacent cells. The excluded cell leaves water
    // around the nearby starter yard. Sorted frontiers make seeded runs repeatable.
    let mut occupied = BTreeSet::from([(0_i32, 0_i32)]);
    let mut frontier = BTreeSet::from([(-1, 0), (1, 0), (0, 1)]);
    let mut positions = vec![Point { x: 0.0, y: 0.0 }; count];
    positions[4] = Point {
        x: rng.random_range(-10.0..=10.0),
        y: -230.0 + rng.random_range(-10.0..=10.0),
    };
    let mut placement_ids: Vec<_> = (1..count).filter(|&i| i != 4).collect();
    placement_ids.shuffle(rng);
    for index in placement_ids {
        let cell = *frontier
            .iter()
            .nth(rng.random_range(0..frontier.len()))
            .unwrap();
        frontier.remove(&cell);
        occupied.insert(cell);
        positions[index] = Point {
            x: f64::from(cell.0) * 360.0 + rng.random_range(-jitter..=jitter),
            y: f64::from(cell.1) * 360.0 + rng.random_range(-jitter..=jitter),
        };
        for next in [
            (cell.0 - 1, cell.1),
            (cell.0 + 1, cell.1),
            (cell.0, cell.1 - 1),
            (cell.0, cell.1 + 1),
        ] {
            if (-3..=3).contains(&next.0)
                && (-2..=2).contains(&next.1)
                && next != (0, -1)
                && !occupied.contains(&next)
            {
                frontier.insert(next);
            }
        }
    }
    let angle = rng.random_range(0.0..std::f64::consts::TAU);
    let (sin, cos) = angle.sin_cos();
    for point in &mut positions {
        (point.x, point.y) = (point.x * cos - point.y * sin, point.x * sin + point.y * cos);
    }
    let min_x = positions.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
    let min_y = positions.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
    for point in &mut positions {
        point.x += 310.0 - min_x;
        point.y += 310.0 - min_y;
    }
    let mut world = WorldState {
        expedition: None,
        veil: Some(crate::veil::Veil::default()),
        doctor: None,
        voyages: crate::voyages::VoyageTraffic::default(),
        research: Some(crate::research::Research::default()),
        salvage: Some(crate::salvage::Salvage::default()),
        economy: Economy::default(),
        revision: 0,
        radius_step: 60.0,
        radius_max: 650.0,
        width: positions.iter().map(|p| p.x).fold(0.0, f64::max) + 310.0,
        height: positions.iter().map(|p| p.y).fold(0.0, f64::max) + 310.0,
        islands: vec![],
        lighthouses: vec![],
    };
    for (index, position) in positions.into_iter().enumerate() {
        let n = index + 1;
        let fuel_facility = if n == 1 {
            FuelFacility::Haven
        } else if fuel_ids.contains(&n) {
            FuelFacility::Ruined
        } else {
            FuelFacility::None
        };
        let name = match n {
            1 => "First Haven".into(),
            2 => "Amber Shoal".into(),
            3 => "Quiet Reach".into(),
            4 => "Last Anchorage".into(),
            5 => "Wreckers' Cove".into(),
            6 => "Iron Shoal".into(),
            _ => format!(
                "{} {n}",
                if fuel_facility == FuelFacility::Ruined {
                    "Ember Isle"
                } else {
                    "Wreck Shoal"
                }
            ),
        };
        let island = Island {
            fuel_facility,
            id: format!("island-{n}"),
            name,
            position,
            radius: match fuel_facility {
                FuelFacility::Haven => 110.0,
                FuelFacility::None => 65.0,
                _ => 90.0,
            },
        };
        world.lighthouses.push(Lighthouse {
            visited: n == 1,
            secured: false,
            sick: false,
            immune_until: 300,
            specialization: None,
            id: format!("beacon-{n}"),
            island_id: island.id.clone(),
            name: if n == 1 {
                "First Light".into()
            } else {
                format!("{} Light", island.name)
            },
            position: Point {
                x: island.position.x,
                y: island.position.y - 20.0,
            },
            radius: 290.0,
            active: n == 1,
            explored_radius: if n == 1 { 290.0 } else { 0.0 },
        });
        if fuel_facility == FuelFacility::None {
            world
                .salvage
                .as_mut()
                .unwrap()
                .yards
                .push(crate::salvage::Yard {
                    island_id: island.id.clone(),
                    period: match n {
                        5 => 4,
                        6 => 2,
                        _ => {
                            if rng.random_bool(0.5) {
                                2
                            } else {
                                4
                            }
                        }
                    },
                    restored: false,
                    stock: 0,
                    timer: 0,
                    delivered: false,
                });
        }
        world.islands.push(island);
    }
    world.expedition = Some(crate::expedition::Expedition::at_haven(&world));
    world
}

/// Check progressive illumination, not just overlap between two expanded circles.
fn playable(world: &WorldState) -> bool {
    if crate::validation::validate(world).is_err() {
        return false;
    }
    let distance = |a: &Point, b: &Point| world.distance(a, b);
    for (i, island) in world.islands.iter().enumerate() {
        if world.islands[..i].iter().any(|other| {
            distance(&island.position, &other.position) < island.radius + other.radius + 20.0
        }) {
            return false;
        }
    }
    let start = &world.lighthouses[0].position;
    let yards = &world.salvage.as_ref().unwrap().yards;
    if yards
        .iter()
        .filter(|yard| {
            let i = world
                .islands
                .iter()
                .position(|i| i.id == yard.island_id)
                .unwrap();
            distance(start, &world.islands[i].position) <= 290.0
                && distance(start, &world.lighthouses[i].position) <= 290.0
        })
        .count()
        != 1
    {
        return false;
    }
    let mut reached = vec![false; world.islands.len()];
    reached[0] = true;
    loop {
        let before = reached.clone();
        for (i, &was_reached) in before.iter().enumerate() {
            if was_reached {
                for (j, island) in world.islands.iter().enumerate() {
                    if distance(&world.lighthouses[i].position, &island.position)
                        <= GUARANTEED_RADIUS
                        && distance(
                            &world.lighthouses[i].position,
                            &world.lighthouses[j].position,
                        ) <= GUARANTEED_RADIUS
                    {
                        reached[j] = true;
                    }
                }
            }
        }
        if before == reached {
            break;
        }
    }
    reached.iter().all(|&r| r)
        && 2.0
            + 3.0
                * world
                    .islands
                    .iter()
                    .filter(|i| i.fuel_facility == FuelFacility::Ruined)
                    .count() as f64
            >= Lighthouse::upkeep_at_radius(GUARANTEED_RADIUS) * world.lighthouses.len() as f64
}

#[cfg(test)]
pub(crate) fn fixed_world() -> WorldState {
    let mut world: WorldState =
        serde_json::from_str(include_str!("../../../tests/fixtures/fixed-world.json")).unwrap();
    world.veil = Some(crate::veil::Veil::default());
    world.expedition = Some(crate::expedition::Expedition::at_haven(&world));
    world
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thousands_of_seeds_preserve_geometry_roles_and_reachability() {
        let mut counts = BTreeSet::new();
        let mut yard_counts = BTreeSet::new();
        for seed in 0..4096 {
            let world = seeded_world(seed);
            let count = world.islands.len();
            counts.insert(count);
            yard_counts.insert(world.salvage.as_ref().unwrap().yards.len());
            assert!((6..=12).contains(&count));
            assert!(playable(&world), "seed {seed}");
            assert_eq!(world.lighthouses.len(), count);
            assert_eq!(world.lighthouses.iter().filter(|l| l.active).count(), 1);
            assert!(
                world.lighthouses[1..]
                    .iter()
                    .all(|l| l.explored_radius == 0.0)
            );
            for (i, island) in world.islands.iter().enumerate() {
                assert_eq!(island.id, format!("island-{}", i + 1));
                assert_eq!(world.lighthouses[i].island_id, island.id);
                assert!(island.position.x - island.radius >= 200.0 - 1e-9);
                assert!(island.position.y - island.radius >= 200.0 - 1e-9);
                assert!(island.position.x + island.radius <= world.width - 200.0 + 1e-9);
                assert!(island.position.y + island.radius <= world.height - 200.0 + 1e-9);
            }
            assert_eq!(world.islands[0].fuel_facility, FuelFacility::Haven);
            assert!(
                world.islands[1..4]
                    .iter()
                    .all(|i| i.fuel_facility == FuelFacility::Ruined)
            );
            assert_eq!(world.islands[4].fuel_facility, FuelFacility::None);
            assert_eq!(world.islands[5].fuel_facility, FuelFacility::None);
            for definition in &crate::research::CATALOG {
                assert!(world.islands.iter().any(|i| i.id == definition.island_id));
            }
            let start = &world.lighthouses[0].position;
            let visible_yards = world
                .salvage
                .as_ref()
                .unwrap()
                .yards
                .iter()
                .filter(|y| {
                    let island = world.islands.iter().find(|i| i.id == y.island_id).unwrap();
                    (island.position.x - start.x).hypot(island.position.y - start.y) <= 290.0
                })
                .count();
            assert_eq!(visible_yards, 1);
            let mut connected = world.clone();
            for light in &mut connected.lighthouses {
                light.radius = GUARANTEED_RADIUS;
                light.active = true;
            }
            assert!(connected.connected_beacons().iter().all(|&c| c));
            // Exercise the raw generator too: retrying must not hide invalid layouts.
            let direct = generate(
                &mut StdRng::seed_from_u64(seed),
                6 + seed as usize % 7,
                35.0,
            );
            assert!(playable(&direct), "raw seed {seed}");
        }
        assert_eq!(counts, BTreeSet::from_iter(6..=12));
        assert!(yard_counts.len() >= 3);
    }

    #[test]
    fn seeds_repeat_and_fallbacks_are_valid_for_every_size() {
        assert_eq!(
            serde_json::to_value(seeded_world(123)).unwrap(),
            serde_json::to_value(seeded_world(123)).unwrap()
        );
        let layouts: BTreeSet<_> = (0..100)
            .map(|seed| serde_json::to_string(&seeded_world(seed).islands).unwrap())
            .collect();
        assert_eq!(layouts.len(), 100);
        for count in 6..=12 {
            assert!(playable(&generate(
                &mut StdRng::seed_from_u64(0),
                count,
                0.0
            )));
        }
    }

    #[test]
    fn progressive_commands_can_complete_and_roundtrip_every_size() {
        for count in 6..=12 {
            let mut world = generate(&mut StdRng::seed_from_u64(count as u64), count, 35.0);
            let mut expanded = vec![false; count];
            loop {
                let next = (0..count).find(|&i| {
                    !expanded[i]
                        && world.is_network_illuminated(&world.islands[i].position)
                        && world.is_network_illuminated(&world.lighthouses[i].position)
                });
                let Some(i) = next else {
                    break;
                };
                // Resource earning is independent of geometry; supply construction
                // costs here to exercise the actual discovery/restoration commands.
                world.economy.fuel = 600.0;
                world.salvage.as_mut().unwrap().reserve = 300;
                let island_id = world.islands[i].id.clone();
                let beacon_id = world.lighthouses[i].id.clone();
                match world.islands[i].fuel_facility {
                    FuelFacility::Ruined => {
                        world.restore_fuel_facility(&island_id).unwrap();
                    }
                    FuelFacility::None => {
                        world.restore_salvage_yard(&island_id).unwrap();
                    }
                    _ => {}
                }
                // This test exercises economy playability; visits are covered by
                // the expedition tests below.
                world.lighthouses[i].visited = true;
                world.set_lighthouse_active(&beacon_id, true).unwrap();
                while world.lighthouses[i].radius < GUARANTEED_RADIUS {
                    world.expand(&beacon_id).unwrap();
                }
                expanded[i] = true;
            }
            assert!(expanded.iter().all(|&e| e), "size {count}");
            assert!(world.production() as f64 >= world.upkeep());
            assert!(world.research.as_ref().unwrap().completed.is_empty());
            for _ in 0..600 {
                // Make storage space as a player could by spending Salvage.
                world.salvage.as_mut().unwrap().reserve = 0;
                world.tick();
                if world.objective_complete() {
                    break;
                }
            }
            assert!(world.objective_complete(), "size {count}");
            assert!(!world.economy.blackout);
            let path = std::env::temp_dir().join(format!(
                "el-pharos-generated-{}-{count}.json",
                std::process::id()
            ));
            crate::persistence::save(&path, &world).unwrap();
            let loaded = crate::persistence::load(&path).unwrap();
            assert_eq!(
                serde_json::to_value(&world).unwrap(),
                serde_json::to_value(&loaded).unwrap()
            );
            std::fs::remove_file(path).unwrap();
        }
    }

    #[test]
    fn variable_yards_reject_duplicate_missing_and_invalid_references() {
        let world = generate(&mut StdRng::seed_from_u64(0), 12, 0.0);
        assert!(world.salvage.as_ref().unwrap().yards.len() > 2);
        for mutation in 0..5 {
            let mut bad = world.clone();
            let yards = &mut bad.salvage.as_mut().unwrap().yards;
            match mutation {
                0 => {
                    yards.push(yards[0].clone());
                }
                1 => {
                    yards.pop();
                }
                2 => {
                    yards[0].island_id = "missing".into();
                }
                3 => {
                    yards[0].island_id = "island-2".into();
                }
                _ => {
                    yards[0].period = 0;
                }
            }
            assert!(crate::validation::validate(&bad).is_err());
        }
    }
}
