//! Small, server-owned stories traveling along the safe lighthouse network.
use crate::domain::{MAX_SAFE_INTEGER, WorldState};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

const SPEED: f64 = 75.0;
const VISIT_SECONDS: u8 = 6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Family,
    Mail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Outbound,
    Visiting,
    Returning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Voyage {
    pub id: u64,
    pub kind: Kind,
    pub message_id: u8,
    pub origin: String,
    pub destination: String,
    pub from: String,
    pub to: String,
    pub progress: f64,
    pub phase: Phase,
    pub visit_timer: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoyageTraffic {
    pub next_id: u64,
    pub spawn_in: u8,
    pub ships: Vec<Voyage>,
}

impl Default for VoyageTraffic {
    fn default() -> Self {
        Self {
            next_id: 1,
            spawn_in: 30,
            ships: vec![],
        }
    }
}

impl WorldState {
    pub(crate) fn tick_voyages(&mut self) {
        let network = crate::network::NetworkView::new(self);
        let old = std::mem::take(&mut self.voyages);
        let mut traffic = old;
        let mut random_state = self.economy.elapsed_seconds
            ^ traffic.next_id.wrapping_mul(0x9e3779b97f4a7c15)
            ^ self.lighthouses[0].position.x.to_bits();
        let mut roll = || {
            random_state = random_state.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = random_state;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
        };
        let mut next = Vec::new();
        for mut ship in traffic.ships.drain(..) {
            if ship.phase == Phase::Visiting {
                ship.visit_timer += 1;
                if ship.visit_timer >= VISIT_SECONDS {
                    ship.phase = Phase::Returning;
                    ship.visit_timer = 0;
                    ship.from = ship.destination.clone();
                    ship.to = ship.destination.clone();
                }
                next.push(ship);
                continue;
            }
            let goal = if ship.phase == Phase::Returning {
                &ship.origin
            } else {
                &ship.destination
            };
            if ship.from == ship.to {
                let route = self.cargo_route(&ship.from, goal);
                if route.len() > 1 {
                    ship.to = route[1].clone();
                }
                next.push(ship);
                continue;
            }
            let a = network.lighthouse_by_id.get(&ship.from).copied();
            let b = network.lighthouse_by_id.get(&ship.to).copied();
            if let (Some(a), Some(b)) = (a, b)
                && network.neighbors[a].contains(&b)
            {
                let length =
                    self.distance(&self.lighthouses[a].position, &self.lighthouses[b].position);
                ship.progress += SPEED / length;
                if ship.progress >= 1.0 {
                    ship.from = ship.to.clone();
                    ship.progress = 0.0;
                    if ship.from == *goal {
                        if ship.phase == Phase::Returning || ship.kind == Kind::Mail {
                            continue;
                        }
                        ship.phase = Phase::Visiting;
                        ship.visit_timer = 0;
                    }
                    ship.to = ship.from.clone();
                }
            }
            next.push(ship);
        }
        traffic.ships = next;
        traffic.spawn_in = traffic.spawn_in.saturating_sub(1);
        if traffic.spawn_in == 0 {
            traffic.spawn_in = 30 + (roll().clamp(0.0, 0.999_999) * 31.0) as u8;
            if traffic.ships.len() < 2 && traffic.next_id < MAX_SAFE_INTEGER {
                let connected: Vec<_> = network
                    .connected
                    .iter()
                    .enumerate()
                    .filter_map(|(i, yes)| yes.then_some(i))
                    .collect();
                if connected.len() >= 2 {
                    let pick = |value: f64, count: usize| {
                        (value.clamp(0.0, 0.999_999) * count as f64) as usize
                    };
                    let a = pick(roll(), connected.len());
                    let b = (a + 1 + pick(roll(), connected.len() - 1)) % connected.len();
                    let origin = self.lighthouses[connected[a]].id.clone();
                    let destination = self.lighthouses[connected[b]].id.clone();
                    let route = self.cargo_route(&origin, &destination);
                    if route.len() > 1 {
                        traffic.ships.push(Voyage {
                            id: traffic.next_id,
                            kind: if roll() < 0.5 {
                                Kind::Family
                            } else {
                                Kind::Mail
                            },
                            message_id: pick(roll(), 6) as u8,
                            origin: origin.clone(),
                            destination,
                            from: origin,
                            to: route[1].clone(),
                            progress: 0.0,
                            phase: Phase::Outbound,
                            visit_timer: 0,
                        });
                        traffic.next_id += 1;
                    }
                }
            }
        }
        self.voyages = traffic;
    }
}

pub fn validate(world: &WorldState) -> Result<(), String> {
    let traffic = &world.voyages;
    if traffic.next_id == 0
        || traffic.next_id > MAX_SAFE_INTEGER
        || traffic.spawn_in > 60
        || traffic.ships.len() > 2
    {
        return Err("Invalid voyage traffic".into());
    }
    let ids: HashSet<_> = world.lighthouses.iter().map(|l| l.id.as_str()).collect();
    let mut seen = HashSet::new();
    for ship in &traffic.ships {
        if ship.id == 0
            || ship.id >= traffic.next_id
            || !seen.insert(ship.id)
            || ship.message_id >= 6
            || !ids.contains(ship.origin.as_str())
            || !ids.contains(ship.destination.as_str())
            || ship.origin == ship.destination
            || !ids.contains(ship.from.as_str())
            || !ids.contains(ship.to.as_str())
            || !ship.progress.is_finite()
            || !(0.0..1.0).contains(&ship.progress)
            || ship.visit_timer >= VISIT_SECONDS
            || (ship.from == ship.to && ship.progress != 0.0)
            || (ship.phase == Phase::Visiting
                && (ship.kind != Kind::Family
                    || ship.from != ship.destination
                    || ship.to != ship.destination))
        {
            return Err("Invalid voyage".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn linked() -> WorldState {
        let mut world = crate::scenario::fixed_world();
        world.lighthouses[4].active = true;
        world.lighthouses[4].explored_radius = world.lighthouses[4].radius;
        world
    }

    #[test]
    fn spawns_only_on_connected_routes_and_holds_at_two() {
        let mut world = crate::scenario::fixed_world();
        world.voyages.spawn_in = 1;
        world.tick_voyages();
        assert!(world.voyages.ships.is_empty());
        world = linked();
        world.voyages.spawn_in = 1;
        world.tick_voyages();
        assert_eq!(world.voyages.ships.len(), 1);
        assert!(world.voyages.ships[0].from != world.voyages.ships[0].to);
        let ship = world.voyages.ships[0].clone();
        world.voyages.ships.push(Voyage { id: 2, ..ship });
        world.voyages.next_id = 3;
        world.voyages.spawn_in = 1;
        world.tick_voyages();
        assert_eq!(world.voyages.ships.len(), 2);
    }

    #[test]
    fn voyage_waits_for_light_and_family_returns_after_visit() {
        let mut world = linked();
        world.voyages.spawn_in = 1;
        world.tick_voyages();
        world.voyages.ships[0].kind = Kind::Family;
        world.voyages.spawn_in = 60;
        let first = world.voyages.ships[0].progress;
        world.economy.paused = true;
        assert!(!world.tick());
        assert_eq!(world.voyages.ships[0].progress, first);
        world.economy.paused = false;
        world.lighthouses[4].active = false;
        world.tick_voyages();
        assert_eq!(world.voyages.ships[0].progress, first);
        world.lighthouses[4].active = true;
        for _ in 0..30 {
            world.tick_voyages();
        }
        assert!(world.voyages.ships.is_empty());
    }

    #[test]
    fn mail_finishes_at_destination_and_invalid_state_is_rejected() {
        let mut world = linked();
        world.voyages.spawn_in = 1;
        world.tick_voyages();
        world.voyages.ships[0].kind = Kind::Mail;
        world.voyages.spawn_in = 60;
        for _ in 0..5 {
            world.tick_voyages();
        }
        assert!(world.voyages.ships.is_empty());
        world.voyages.ships.push(Voyage {
            id: 1,
            kind: Kind::Mail,
            message_id: 0,
            origin: "beacon-1".into(),
            destination: "missing".into(),
            from: "beacon-1".into(),
            to: "beacon-1".into(),
            progress: 0.0,
            phase: Phase::Outbound,
            visit_timer: 0,
        });
        assert!(validate(&world).is_err());
    }
}
