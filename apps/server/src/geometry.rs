//! Geometry on a rectangular world that repeats in both directions.
use crate::domain::{Point, WorldState};

fn delta(value: f64, span: f64) -> f64 {
    let remainder = value % span;
    if remainder.abs() > span / 2.0 {
        remainder - remainder.signum() * span
    } else {
        remainder
    }
}

impl WorldState {
    pub fn displacement(&self, from: &Point, to: &Point) -> Point {
        Point {
            x: delta(to.x - from.x, self.width),
            y: delta(to.y - from.y, self.height),
        }
    }
    pub fn distance(&self, a: &Point, b: &Point) -> f64 {
        let d = self.displacement(a, b);
        d.x.hypot(d.y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wraps_multiple_spans_and_preserves_half_span_sign() {
        assert_eq!(delta(298.0, 100.0), -2.0);
        assert_eq!(delta(-298.0, 100.0), 2.0);
        assert_eq!(delta(50.0, 100.0), 50.0);
        assert_eq!(delta(-50.0, 100.0), -50.0);
        let mut w = crate::scenario::fixed_world();
        w.width = 1000.0;
        w.height = 1000.0;
        assert_eq!(
            w.distance(&Point { x: 997.0, y: 996.0 }, &Point { x: 0.0, y: 0.0 }),
            5.0
        );
    }
    #[test]
    fn seam_network_research_cargo_doctor_and_save_roundtrip() {
        let mut world = crate::scenario::fixed_world();
        let positions = [
            (20.0, 20.0),
            (2380.0, 980.0),
            (1200.0, 500.0),
            (1500.0, 500.0),
            (2390.0, 20.0),
            (1800.0, 500.0),
        ];
        for (i, &(x, y)) in positions.iter().enumerate() {
            world.islands[i].position = Point { x, y };
            world.lighthouses[i].position = Point { x, y };
        }
        world.economy.fuel = 600.0;
        world.salvage.as_mut().unwrap().reserve = 300;
        assert!(world.is_illuminated(&world.islands[1].position));
        assert!(world.archive_discovered("island-2"));
        assert!(!world.archive_discovered("island-3"));
        world.restore_fuel_facility("island-2").unwrap();
        world.set_lighthouse_active("beacon-2", true).unwrap();
        assert!(world.connected_beacons()[1]);
        world.lighthouses[1].sick = true;
        world.lighthouses[1].immune_until = 0;
        world.send_doctor("beacon-2").unwrap();
        world.tick();
        assert!(!world.lighthouses[1].sick);
        assert!(world.doctor.as_ref().unwrap().returning);
        world.tick();
        assert!(world.doctor.is_none());
        world.restore_salvage_yard("island-5").unwrap();
        world.set_lighthouse_active("beacon-5", true).unwrap();
        assert_eq!(
            world.cargo_route("beacon-5", "beacon-1"),
            vec!["beacon-5", "beacon-1"]
        );
        for _ in 0..20 {
            world.tick();
        }
        assert!(world.salvage.as_ref().unwrap().yards[0].delivered);
        let path = std::env::temp_dir().join(format!("wrapping-save-{}.json", std::process::id()));
        crate::persistence::save(&path, &world).unwrap();
        let loaded = crate::persistence::load(&path).unwrap();
        assert_eq!(
            serde_json::to_value(&world).unwrap(),
            serde_json::to_value(&loaded).unwrap()
        );
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn expedition_crosses_seam_and_avoids_island_images() {
        let mut world = crate::scenario::fixed_world();
        world.islands[0].position = Point {
            x: world.width - 150.0,
            y: 500.0,
        };
        for (i, island) in world.islands.iter_mut().enumerate().skip(1) {
            island.position = Point {
                x: 800.0 + i as f64 * 100.0,
                y: 500.0,
            };
        }
        let clear = world.vessel_route().unwrap();
        assert!(clear[1].x > world.width);
        world.islands[1].position = Point { x: 30.0, y: 500.0 };
        let avoiding = world.vessel_route().unwrap();
        assert!(avoiding[1].y != clear[1].y);
    }
}
