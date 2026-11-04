use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lighthouse {
    pub id: String,
    pub island_id: String,
    pub name: String,
    pub position: Point,
    pub radius: f64,
    pub active: bool,
    pub explored_radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Island {
    pub id: String,
    pub name: String,
    pub position: Point,
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldState {
    pub revision: u64,
    pub radius_step: f64,
    pub radius_max: f64,
    pub width: f64,
    pub height: f64,
    pub islands: Vec<Island>,
    pub lighthouses: Vec<Lighthouse>,
}

impl Default for WorldState {
    fn default() -> Self {
        let mut world = Self {
            revision: 0,
            radius_step: 60.0,
            radius_max: 650.0,
            width: 2400.0,
            height: 1000.0,
            islands: vec![Island {
                id: "island-1".into(),
                name: "First Haven".into(),
                position: Point { x: 800.0, y: 500.0 },
                radius: 110.0,
            }],
            lighthouses: vec![Lighthouse {
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
                id: format!("island-{n}"),
                name: name.into(),
                position: Point { x, y },
                radius: 90.0,
            });
            world.lighthouses.push(Lighthouse {
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
}

impl WorldState {
    pub fn expand(&mut self, id: &str) -> Result<bool, &'static str> {
        let light = self
            .lighthouses
            .iter_mut()
            .find(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        let radius = (light.radius + self.radius_step).min(self.radius_max);
        if radius == light.radius {
            return Ok(false);
        }
        light.radius = radius;
        if light.active {
            light.explored_radius = light.explored_radius.max(radius);
        }
        self.revision += 1;
        Ok(true)
    }

    pub fn set_lighthouse_active(&mut self, id: &str, active: bool) -> Result<bool, &'static str> {
        let lighthouse = self
            .lighthouses
            .iter_mut()
            .find(|light| light.id == id)
            .ok_or("Unknown lighthouse")?;
        if lighthouse.active == active {
            return Ok(false);
        }
        lighthouse.active = active;
        if active {
            lighthouse.explored_radius = lighthouse.explored_radius.max(lighthouse.radius);
        }
        self.revision += 1;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expansion_caps_and_remembers_only_active_coverage() {
        let mut world = WorldState::default();
        assert_eq!(world.expand("missing"), Err("Unknown lighthouse"));
        world.expand("beacon-2").unwrap();
        assert_eq!(world.lighthouses[1].explored_radius, 0.0);
        world.set_lighthouse_active("beacon-2", true).unwrap();
        assert_eq!(world.lighthouses[1].explored_radius, 350.0);
        world.set_lighthouse_active("beacon-2", false).unwrap();
        assert_eq!(world.lighthouses[1].explored_radius, 350.0);
        for _ in 0..10 {
            world.expand("beacon-1").unwrap();
        }
        assert_eq!(world.lighthouses[0].radius, 650.0);
        let revision = world.revision;
        assert_eq!(world.expand("beacon-1"), Ok(false));
        assert_eq!(world.revision, revision);
        assert_eq!(world.lighthouses[0].explored_radius, 650.0);
    }

    #[test]
    fn commands_are_idempotent_and_unknown_ids_do_not_mutate_world() {
        let mut world = WorldState::default();
        assert_eq!(
            world.set_lighthouse_active("missing", false),
            Err("Unknown lighthouse")
        );
        assert_eq!(world.revision, 0);
        assert_eq!(world.set_lighthouse_active("beacon-1", false), Ok(true));
        assert_eq!(world.set_lighthouse_active("beacon-1", false), Ok(false));
        assert_eq!(world.revision, 1);
        assert!(!world.lighthouses[0].active);
    }
}
