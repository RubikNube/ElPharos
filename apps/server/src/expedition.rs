//! The single player-commanded boat and first-visit lighthouse choices.
use crate::domain::{FuelFacility, Point, WorldState};
use serde::{Deserialize, Serialize};

pub const SPEED: f64 = 75.0;
pub const SECURE_SECONDS: u8 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    Explore,
    Secure,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Expedition {
    pub position: Point,
    pub destination: Option<Point>,
    pub target: Option<String>,
    pub pending_choice: Option<String>,
    pub securing: Option<String>,
    pub secure_remaining: u8,
}

impl Expedition {
    pub fn at_haven(world: &WorldState) -> Self {
        let position = world
            .lighthouses
            .iter()
            .find(|light| {
                world.islands.iter().any(|island| {
                    island.id == light.island_id && island.fuel_facility == FuelFacility::Haven
                })
            })
            .expect("Haven lighthouse")
            .position
            .clone();
        Self {
            position,
            destination: None,
            target: None,
            pending_choice: None,
            securing: None,
            secure_remaining: 0,
        }
    }
}

impl WorldState {
    /// Route via active, Haven-connected light circles. Each leg lies within one
    /// circle or connects the centers of two overlapping circles.
    pub fn expedition_route(&self, from: &Point, to: &Point) -> Option<Vec<Point>> {
        let network = crate::network::NetworkView::new(self);
        let nodes: Vec<usize> = network
            .connected
            .iter()
            .enumerate()
            .filter_map(|(i, connected)| connected.then_some(i))
            .collect();
        let contains = |index: usize, point: &Point| {
            self.distance(&self.lighthouses[index].position, point)
                <= self.lighthouses[index].effective_radius() + 1e-8
        };
        let mut best: Option<(f64, Vec<Point>)> = None;
        for &start in &nodes {
            if !contains(start, from) {
                continue;
            }
            if contains(start, to) {
                let length = self.distance(from, to);
                if best.as_ref().is_none_or(|(old, _)| length < *old) {
                    best = Some((length, vec![to.clone()]));
                }
            }
            let mut distances = vec![f64::INFINITY; self.lighthouses.len()];
            let mut previous = vec![None; self.lighthouses.len()];
            let mut done = vec![false; self.lighthouses.len()];
            distances[start] = self.distance(from, &self.lighthouses[start].position);
            for _ in 0..nodes.len() {
                let Some(current) = nodes
                    .iter()
                    .copied()
                    .filter(|i| !done[*i])
                    .min_by(|a, b| distances[*a].total_cmp(&distances[*b]))
                else {
                    break;
                };
                if !distances[current].is_finite() {
                    break;
                }
                done[current] = true;
                for &neighbor in &network.neighbors[current] {
                    let length = distances[current]
                        + self.distance(
                            &self.lighthouses[current].position,
                            &self.lighthouses[neighbor].position,
                        );
                    if length < distances[neighbor] {
                        distances[neighbor] = length;
                        previous[neighbor] = Some(current);
                    }
                }
            }
            for &end in &nodes {
                if !contains(end, to) || !distances[end].is_finite() {
                    continue;
                }
                let length = distances[end] + self.distance(&self.lighthouses[end].position, to);
                if best.as_ref().is_some_and(|(old, _)| length >= *old) {
                    continue;
                }
                let mut indices = vec![end];
                while *indices.last().unwrap() != start {
                    indices.push(previous[*indices.last().unwrap()]?);
                }
                indices.reverse();
                let mut route: Vec<Point> = indices
                    .into_iter()
                    .map(|i| self.lighthouses[i].position.clone())
                    .collect();
                route.push(to.clone());
                best = Some((length, route));
            }
        }
        best.map(|(_, route)| route)
    }

    pub fn order_expedition(
        &mut self,
        destination: Point,
        target: Option<String>,
    ) -> Result<bool, &'static str> {
        let boat = self.expedition.as_ref().ok_or("Expedition unavailable")?;
        if boat.pending_choice.is_some() || boat.securing.is_some() {
            return Err("Resolve the lighthouse visit before moving");
        }
        if !destination.x.is_finite()
            || !destination.y.is_finite()
            || destination.x < 0.0
            || destination.x >= self.width
            || destination.y < 0.0
            || destination.y >= self.height
        {
            return Err("Invalid expedition destination");
        }
        if let Some(id) = &target {
            let light = self
                .lighthouses
                .iter()
                .find(|l| &l.id == id)
                .ok_or("Unknown lighthouse")?;
            if self.distance(&destination, &light.position) > 1e-6 {
                return Err("Destination does not match lighthouse");
            }
        } else if self
            .islands
            .iter()
            .any(|island| self.distance(&destination, &island.position) < island.radius * 0.72)
        {
            return Err("Choose a water destination");
        }
        if self
            .expedition_route(&boat.position, &destination)
            .is_none()
        {
            return Err("No route through connected light");
        }
        let revision = self.next_revision()?;
        let boat = self.expedition.as_mut().unwrap();
        boat.destination = Some(destination);
        boat.target = target;
        self.revision = revision;
        Ok(true)
    }

    pub fn choose_expedition(&mut self, id: &str, choice: Choice) -> Result<bool, &'static str> {
        if self
            .expedition
            .as_ref()
            .and_then(|b| b.pending_choice.as_deref())
            != Some(id)
        {
            return Err("No pending visit at this lighthouse");
        }
        let index = self
            .lighthouses
            .iter()
            .position(|l| l.id == id)
            .ok_or("Unknown lighthouse")?;
        let revision = self.next_revision()?;
        self.lighthouses[index].visited = true;
        let boat = self.expedition.as_mut().unwrap();
        boat.pending_choice = None;
        match choice {
            Choice::Explore => {
                if let Some(salvage) = &mut self.salvage {
                    salvage.reserve = (salvage.reserve + 20).min(crate::salvage::CAPACITY);
                } else {
                    self.economy.fuel =
                        (self.economy.fuel + 20.0).min(f64::from(self.economy.capacity));
                }
            }
            Choice::Secure => {
                boat.securing = Some(id.into());
                boat.secure_remaining = SECURE_SECONDS;
            }
        }
        self.revision = revision;
        Ok(true)
    }

    pub(crate) fn tick_expedition(&mut self) {
        let Some(boat) = self.expedition.as_ref() else {
            return;
        };
        if boat.secure_remaining > 0 {
            let boat = self.expedition.as_mut().unwrap();
            boat.secure_remaining -= 1;
            if boat.secure_remaining == 0 {
                let id = boat.securing.take().unwrap();
                self.lighthouses
                    .iter_mut()
                    .find(|l| l.id == id)
                    .unwrap()
                    .secured = true;
            }
            return;
        }
        if boat.pending_choice.is_some() {
            return;
        }
        let Some(destination) = boat.destination.clone() else {
            return;
        };
        let mut position = boat.position.clone();
        let mut remaining = SPEED;
        while remaining > 0.0 {
            let Some(route) = self.expedition_route(&position, &destination) else {
                break;
            };
            let Some(next) = route
                .into_iter()
                .find(|point| self.distance(&position, point) > 1e-7)
            else {
                position = destination.clone();
                break;
            };
            let displacement = self.displacement(&position, &next);
            let length = displacement.x.hypot(displacement.y);
            let step = remaining.min(length);
            position.x = (position.x + displacement.x * step / length).rem_euclid(self.width);
            position.y = (position.y + displacement.y * step / length).rem_euclid(self.height);
            remaining -= step;
            if step < length {
                break;
            }
        }
        let arrived = self.distance(&position, &destination) < 1e-6;
        let boat = self.expedition.as_mut().unwrap();
        boat.position = position;
        if arrived {
            boat.destination = None;
            if let Some(id) = boat.target.take()
                && self.lighthouses.iter().any(|l| l.id == id && !l.visited)
            {
                boat.pending_choice = Some(id);
            }
        }
    }
}

pub fn validate(world: &WorldState) -> Result<(), String> {
    let boat = world.expedition.as_ref().ok_or("Missing expedition")?;
    let valid_point = |p: &Point| {
        p.x.is_finite()
            && p.y.is_finite()
            && p.x >= 0.0
            && p.x < world.width
            && p.y >= 0.0
            && p.y < world.height
    };
    if !valid_point(&boat.position)
        || boat.destination.as_ref().is_some_and(|p| !valid_point(p))
        || boat.target.is_some() != boat.destination.is_some()
        || boat.secure_remaining > SECURE_SECONDS
        || boat.securing.is_some() != (boat.secure_remaining > 0)
        || boat.pending_choice.is_some() && (boat.destination.is_some() || boat.securing.is_some())
        || boat.securing.is_some() && boat.destination.is_some()
    {
        return Err("Invalid expedition state".into());
    }
    for id in [&boat.target, &boat.pending_choice, &boat.securing]
        .into_iter()
        .flatten()
    {
        let light = world
            .lighthouses
            .iter()
            .find(|l| &l.id == id)
            .ok_or("Invalid expedition target")?;
        if boat.target.as_ref() == Some(id)
            && boat
                .destination
                .as_ref()
                .is_some_and(|p| world.distance(p, &light.position) > 1e-6)
            || boat.pending_choice.as_ref() == Some(id)
                && (light.visited || world.distance(&boat.position, &light.position) > 1e-6)
            || boat.securing.as_ref() == Some(id) && (!light.visited || light.secured)
        {
            return Err("Invalid expedition target".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visit_choice_unlocks_lighting_and_grants_reward_once() {
        let mut world = crate::scenario::fixed_world();
        world.lighthouses[4].visited = false;
        assert_eq!(
            world.set_lighthouse_active("beacon-5", true),
            Err("Send the expedition to this lighthouse first")
        );
        let target = world.lighthouses[4].position.clone();
        world
            .order_expedition(target, Some("beacon-5".into()))
            .unwrap();
        for _ in 0..4 {
            world.tick_expedition();
        }
        assert_eq!(
            world.expedition.as_ref().unwrap().pending_choice.as_deref(),
            Some("beacon-5")
        );
        assert_eq!(
            world.set_lighthouse_active("beacon-5", true),
            Err("Send the expedition to this lighthouse first")
        );
        let before = world.salvage.as_ref().unwrap().reserve;
        world
            .choose_expedition("beacon-5", Choice::Explore)
            .unwrap();
        assert_eq!(world.salvage.as_ref().unwrap().reserve, before + 20);
        assert!(
            world
                .choose_expedition("beacon-5", Choice::Explore)
                .is_err()
        );
        world.set_lighthouse_active("beacon-5", true).unwrap();
        world.set_lighthouse_active("beacon-5", false).unwrap();
        world.set_lighthouse_active("beacon-5", true).unwrap();
        validate(&world).unwrap();
    }

    #[test]
    fn secure_waits_and_reduces_upkeep_with_existing_lamp() {
        let mut world = crate::scenario::fixed_world();
        world.lighthouses[4].visited = false;
        let target = world.lighthouses[4].position.clone();
        world
            .order_expedition(target, Some("beacon-5".into()))
            .unwrap();
        for _ in 0..4 {
            world.tick_expedition();
        }
        world.choose_expedition("beacon-5", Choice::Secure).unwrap();
        assert!(world.lighthouses[4].visited);
        assert!(!world.lighthouses[4].secured);
        assert!(
            world
                .order_expedition(
                    world.lighthouses[0].position.clone(),
                    Some("beacon-1".into())
                )
                .is_err()
        );
        for _ in 0..SECURE_SECONDS {
            world.tick_expedition();
        }
        assert!(world.lighthouses[4].secured);
        let before = WorldState::lighthouse_upkeep_at_radius(&world, &world.lighthouses[4], 290.0);
        assert_eq!(before, 0.75);
        world.lighthouses[4].specialization = Some(crate::domain::Specialization::EfficientLamp);
        assert_eq!(
            world.lighthouse_upkeep_at_radius(&world.lighthouses[4], 290.0),
            0.25
        );
    }

    #[test]
    fn outage_stops_and_resumes_order() {
        let mut world = crate::scenario::fixed_world();
        let target = world.lighthouses[4].position.clone();
        world
            .order_expedition(target.clone(), Some("beacon-5".into()))
            .unwrap();
        world.tick_expedition();
        let stopped = world.expedition.as_ref().unwrap().position.clone();
        world.set_lighthouse_active("beacon-1", false).unwrap();
        world.tick_expedition();
        assert!(world.distance(&stopped, &world.expedition.as_ref().unwrap().position) < 1e-6);
        world.set_lighthouse_active("beacon-1", true).unwrap();
        for _ in 0..4 {
            world.tick_expedition();
        }
        assert!(world.distance(&target, &world.expedition.as_ref().unwrap().position) < 1e-6);
    }

    #[test]
    fn new_order_replaces_route_and_save_resumes_secure_timer() {
        let mut world = crate::scenario::fixed_world();
        world.lighthouses[4].visited = false;
        let first = world.lighthouses[4].position.clone();
        let other = world.lighthouses[5].position.clone();
        world
            .order_expedition(first.clone(), Some("beacon-5".into()))
            .unwrap();
        world.tick_expedition();
        world
            .order_expedition(other, Some("beacon-6".into()))
            .unwrap();
        assert_eq!(
            world.expedition.as_ref().unwrap().target.as_deref(),
            Some("beacon-6")
        );
        world
            .order_expedition(first, Some("beacon-5".into()))
            .unwrap();
        let path = std::env::temp_dir().join(format!("expedition-{}.json", std::process::id()));
        crate::persistence::save(&path, &world).unwrap();
        let mut loaded = crate::persistence::load(&path).unwrap();
        while loaded.expedition.as_ref().unwrap().pending_choice.is_none() {
            loaded.tick_expedition();
        }
        loaded
            .choose_expedition("beacon-5", Choice::Secure)
            .unwrap();
        for _ in 0..10 {
            loaded.tick_expedition();
        }
        crate::persistence::save(&path, &loaded).unwrap();
        let restored = crate::persistence::load(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(restored.expedition.unwrap().secure_remaining, 20);
    }

    #[test]
    fn route_crosses_wrapped_edge_and_legacy_explore_grants_fuel() {
        let mut world = crate::scenario::fixed_world();
        world.salvage = None;
        world.research = None;
        world.veil = None;
        world.lighthouses[0].position.x = 20.0;
        world.lighthouses[4].position.x = world.width - 20.0;
        world.lighthouses[4].visited = false;
        world.expedition = Some(Expedition::at_haven(&world));
        let target = world.lighthouses[4].position.clone();
        world
            .order_expedition(target.clone(), Some("beacon-5".into()))
            .unwrap();
        for _ in 0..3 {
            world.tick_expedition();
        }
        assert!(world.distance(&world.expedition.as_ref().unwrap().position, &target) < 1e-6);
        let fuel = world.economy.fuel;
        world
            .choose_expedition("beacon-5", Choice::Explore)
            .unwrap();
        assert_eq!(world.economy.fuel, fuel + 20.0);
    }
}
