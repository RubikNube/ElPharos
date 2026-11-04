use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Lighthouse {
    pub id: String,
    pub island_id: String,
    pub name: String,
    pub position: Point,
    pub radius: f64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Island {
    pub id: String,
    pub name: String,
    pub position: Point,
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorldState {
    pub revision: u64,
    pub width: f64,
    pub height: f64,
    pub islands: Vec<Island>,
    pub lighthouses: Vec<Lighthouse>,
}

impl Default for WorldState {
    fn default() -> Self {
        Self {
            revision: 0,
            width: 1600.0,
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
            }],
        }
    }
}

impl WorldState {
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
        self.revision += 1;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
