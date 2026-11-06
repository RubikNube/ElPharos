//! An operation-local view of the active lighthouse network.
use crate::domain::{FuelFacility, Point, WorldState};
use std::collections::HashMap;

pub(crate) struct NetworkView {
    pub connected: Vec<bool>,
    pub links: Vec<(usize, usize)>,
    pub neighbors: Vec<Vec<usize>>,
    pub lighthouse_by_id: HashMap<String, usize>,
    pub beacon_by_island: HashMap<String, Vec<usize>>,
}

impl NetworkView {
    pub fn new(world: &WorldState) -> Self {
        let mut connected = vec![false; world.lighthouses.len()];
        let mut edges = vec![Vec::new(); world.lighthouses.len()];
        let mut pending = Vec::new();
        let mut lighthouse_by_id = HashMap::new();
        let mut beacon_by_island = HashMap::<String, Vec<usize>>::new();
        for (i, light) in world.lighthouses.iter().enumerate() {
            lighthouse_by_id.insert(light.id.clone(), i);
            beacon_by_island
                .entry(light.island_id.clone())
                .or_default()
                .push(i);
            if light.active
                && world.islands.iter().any(|island| {
                    island.id == light.island_id && island.fuel_facility == FuelFacility::Haven
                })
            {
                connected[i] = true;
                pending.push(i);
            }
            for (j, other) in world.lighthouses.iter().enumerate().take(i) {
                if light.active && other.active && world.overlap(light, other) {
                    edges[i].push(j);
                    edges[j].push(i);
                }
            }
        }
        while let Some(i) = pending.pop() {
            for &j in &edges[i] {
                if !connected[j] {
                    connected[j] = true;
                    pending.push(j);
                }
            }
        }
        let mut links = Vec::new();
        for (i, neighbors) in edges.iter().enumerate() {
            for &j in neighbors {
                if i < j && connected[i] && connected[j] {
                    links.push((i, j));
                }
            }
        }
        links.sort_unstable();
        for (i, neighbors) in edges.iter_mut().enumerate() {
            neighbors.retain(|&j| connected[i] && connected[j]);
            neighbors.sort_unstable();
        }
        Self {
            connected,
            links,
            neighbors: edges,
            lighthouse_by_id,
            beacon_by_island,
        }
    }

    pub fn illuminates(&self, world: &WorldState, position: &Point) -> bool {
        world.lighthouses.iter().enumerate().any(|(i, light)| {
            self.connected[i]
                && world.distance(position, &light.position) <= light.effective_radius()
        })
    }

    pub fn island_connected(&self, id: &str) -> bool {
        self.beacon_by_island
            .get(id)
            .is_some_and(|indices| indices.iter().any(|&i| self.connected[i]))
    }
}
