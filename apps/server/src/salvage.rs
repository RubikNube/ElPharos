//! Authoritative construction economy and automatic cargo shipping.
use crate::domain::{Point, WorldState};
use serde::{Deserialize, Serialize};

pub const CAPACITY: u32 = 300;
pub const STARTING_RESERVE: u32 = 100;
pub const HAVEN_PERIOD: u32 = 10;
pub const EXPAND_COST: u32 = 20;
pub const RESTORE_COST: u32 = 40;
pub const RESTORE_FUEL: f64 = 120.0;
pub const SPEED: f64 = 60.0;
pub const HOLD: u32 = 20;
pub const LOCAL_CAPACITY: u32 = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Salvage {
    pub reserve: u32,
    pub haven_timer: u32,
    pub yards: Vec<Yard>,
    pub ships: Vec<Ship>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Yard {
    pub island_id: String,
    pub period: u32,
    pub restored: bool,
    pub stock: u32,
    pub timer: u32,
    pub delivered: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ship {
    pub yard_id: String,
    pub from: String,
    pub to: String,
    pub progress: f64,
    pub cargo: u32,
    pub returning: bool,
    pub route: Vec<String>,
}
impl Default for Salvage {
    fn default() -> Self {
        Self {
            reserve: STARTING_RESERVE,
            haven_timer: 0,
            ships: vec![],
            yards: [("island-5", 4), ("island-6", 2)]
                .into_iter()
                .map(|(id, period)| Yard {
                    island_id: id.into(),
                    period,
                    restored: false,
                    stock: 0,
                    timer: 0,
                    delivered: false,
                })
                .collect(),
        }
    }
}
fn distance(a: &Point, b: &Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
impl WorldState {
    pub fn restore_salvage_yard(&mut self, id: &str) -> Result<bool, &'static str> {
        let yard = self
            .salvage
            .as_ref()
            .and_then(|s| s.yards.iter().find(|y| y.island_id == id))
            .ok_or("Unknown salvage yard")?;
        if yard.restored {
            return Ok(false);
        }
        let island = self
            .islands
            .iter()
            .find(|i| i.id == id)
            .ok_or("Unknown island")?;
        if !self.is_network_illuminated(&island.position) {
            return Err("Connect illumination to restore this yard");
        }
        if self.economy.fuel < RESTORE_FUEL || self.salvage.as_ref().unwrap().reserve < RESTORE_COST
        {
            return Err("Restoration requires 120 fuel and 40 Salvage");
        }
        let beacon = self
            .lighthouses
            .iter()
            .find(|l| l.island_id == id)
            .ok_or("Missing yard beacon")?
            .id
            .clone();
        self.economy.fuel -= RESTORE_FUEL;
        let s = self.salvage.as_mut().unwrap();
        s.reserve -= RESTORE_COST;
        s.yards
            .iter_mut()
            .find(|y| y.island_id == id)
            .unwrap()
            .restored = true;
        s.ships.push(Ship {
            yard_id: id.into(),
            from: beacon.clone(),
            to: beacon,
            progress: 0.0,
            cargo: 0,
            returning: false,
            route: vec![],
        });
        self.revision += 1;
        Ok(true)
    }
    /// Dijkstra over safe links. IDs settle equal-distance choices deterministically.
    pub fn cargo_route(&self, start: &str, goal: &str) -> Vec<String> {
        let connected = self.connected_beacons();
        let n = self.lighthouses.len();
        let Some(a) = self.lighthouses.iter().position(|l| l.id == start) else {
            return vec![];
        };
        let Some(b) = self.lighthouses.iter().position(|l| l.id == goal) else {
            return vec![];
        };
        if !connected[a] || !connected[b] {
            return vec![];
        }
        let mut cost = vec![f64::INFINITY; n];
        let mut prev = vec![None; n];
        let mut done = vec![false; n];
        cost[a] = 0.0;
        for _ in 0..n {
            let Some(u) = (0..n).filter(|&i| !done[i]).min_by(|&i, &j| {
                cost[i]
                    .total_cmp(&cost[j])
                    .then(self.lighthouses[i].id.cmp(&self.lighthouses[j].id))
            }) else {
                break;
            };
            if !cost[u].is_finite() {
                break;
            }
            done[u] = true;
            for v in 0..n {
                if !done[v]
                    && connected[v]
                    && Self::overlap(&self.lighthouses[u], &self.lighthouses[v])
                {
                    let next = cost[u]
                        + distance(&self.lighthouses[u].position, &self.lighthouses[v].position);
                    if next < cost[v] {
                        cost[v] = next;
                        prev[v] = Some(u);
                    }
                }
            }
        }
        if !cost[b].is_finite() {
            return vec![];
        }
        let mut path = vec![b];
        let mut cur = b;
        while cur != a {
            cur = prev[cur].unwrap();
            path.push(cur);
        }
        path.reverse();
        path.into_iter()
            .map(|i| self.lighthouses[i].id.clone())
            .collect()
    }
    pub fn tick_salvage(&mut self) {
        let Some(mut s) = self.salvage.take() else {
            return;
        };
        let connected = self.connected_beacons();
        let haven = self
            .lighthouses
            .iter()
            .find(|l| {
                self.islands.iter().any(|i| {
                    i.id == l.island_id && i.fuel_facility == crate::domain::FuelFacility::Haven
                })
            })
            .unwrap()
            .id
            .clone();
        s.haven_timer += 1;
        if s.haven_timer == HAVEN_PERIOD {
            s.haven_timer = 0;
            s.reserve = (s.reserve + 1).min(CAPACITY);
        }
        for yard in &mut s.yards {
            if yard.restored
                && self
                    .lighthouses
                    .iter()
                    .enumerate()
                    .any(|(i, l)| l.island_id == yard.island_id && connected[i])
            {
                yard.timer += 1;
                if yard.timer == yard.period {
                    yard.timer = 0;
                    yard.stock = (yard.stock + 1).min(LOCAL_CAPACITY);
                }
            }
        }
        for ship in &mut s.ships {
            let yard = s
                .yards
                .iter_mut()
                .find(|y| y.island_id == ship.yard_id)
                .unwrap();
            let home = &self
                .lighthouses
                .iter()
                .find(|l| l.island_id == yard.island_id)
                .unwrap()
                .id;
            if ship.from == ship.to {
                if !self
                    .lighthouses
                    .iter()
                    .enumerate()
                    .any(|(i, l)| l.id == ship.to && connected[i])
                {
                    continue;
                }
                if ship.to == haven && !ship.returning {
                    let amount = ship.cargo.min(CAPACITY - s.reserve);
                    s.reserve += amount;
                    ship.cargo -= amount;
                    if amount > 0 {
                        yard.delivered = true;
                    }
                    if ship.cargo > 0 {
                        continue;
                    }
                    ship.returning = true;
                }
                if ship.to == *home && ship.returning {
                    ship.returning = false;
                }
                if ship.to == *home && !ship.returning && ship.cargo == 0 {
                    ship.cargo = yard.stock.min(HOLD);
                    yard.stock -= ship.cargo;
                    if ship.cargo == 0 {
                        continue;
                    }
                }
                let goal = if ship.returning { home } else { &haven };
                ship.route = self.cargo_route(&ship.to, goal);
                if ship.route.len() < 2 {
                    continue;
                }
                ship.from = ship.route[0].clone();
                ship.to = ship.route[1].clone();
                ship.progress = 0.0;
            }
            let a = self
                .lighthouses
                .iter()
                .position(|l| l.id == ship.from)
                .unwrap();
            let b = self
                .lighthouses
                .iter()
                .position(|l| l.id == ship.to)
                .unwrap();
            if !connected[a]
                || !connected[b]
                || !Self::overlap(&self.lighthouses[a], &self.lighthouses[b])
            {
                continue;
            }
            ship.progress = (ship.progress
                + self.lighthouses[a].link_speed(&self.lighthouses[b])
                    / distance(&self.lighthouses[a].position, &self.lighthouses[b].position))
            .min(1.0);
            if ship.progress >= 1.0 {
                ship.from = ship.to.clone();
                ship.progress = 0.0;
                ship.route.clear();
            }
        }
        self.salvage = Some(s);
    }
}

pub fn validate(w: &WorldState) -> Result<(), String> {
    let Some(s) = &w.salvage else {
        return Ok(());
    };
    if s.reserve > CAPACITY || s.haven_timer >= HAVEN_PERIOD || s.yards.len() != 2 {
        return Err("Invalid Salvage reserve or yards".into());
    }
    for (id, period) in [("island-5", 4), ("island-6", 2)] {
        let y = s
            .yards
            .iter()
            .find(|y| y.island_id == id)
            .ok_or("Missing salvage yard")?;
        if y.period != period
            || y.stock > LOCAL_CAPACITY
            || y.timer >= period
            || (!y.restored && (y.stock != 0 || y.delivered || y.timer != 0))
            || !w
                .islands
                .iter()
                .any(|i| i.id == id && i.fuel_facility == crate::domain::FuelFacility::None)
            || w.lighthouses.iter().filter(|l| l.island_id == id).count() != 1
        {
            return Err("Invalid salvage yard".into());
        }
        if s.ships.iter().filter(|ship| ship.yard_id == id).count() != usize::from(y.restored) {
            return Err("Invalid yard fleet".into());
        }
    }
    if s.ships.len() != s.yards.iter().filter(|y| y.restored).count() {
        return Err("Invalid fleet".into());
    }
    for ship in &s.ships {
        let exists = |id: &str| w.lighthouses.iter().any(|l| l.id == id);
        if !exists(&ship.from)
            || !exists(&ship.to)
            || !ship.progress.is_finite()
            || !(0.0..1.0).contains(&ship.progress)
            || ship.cargo > HOLD
            || ship.route.len() > w.lighthouses.len()
            || ship.route.iter().any(|id| !exists(id))
            || (ship.from == ship.to && ship.progress != 0.0)
            || (ship.returning && ship.cargo != 0)
        {
            return Err("Invalid cargo ship".into());
        }
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Rules {
    specialization_cost: u32,
    refit_cost: u32,
    efficiency_saving: f64,
    navigation_multiplier: f64,
    capacity: u32,
    expand_cost: u32,
    restore_cost: u32,
    restore_fuel: f64,
    speed: f64,
    hold: u32,
    local_capacity: u32,
    haven_period: u32,
}
impl Default for Rules {
    fn default() -> Self {
        Self {
            specialization_cost: crate::domain::SPECIALIZATION_COST,
            refit_cost: crate::domain::REFIT_COST,
            efficiency_saving: crate::domain::EFFICIENCY_SAVING,
            navigation_multiplier: crate::domain::NAVIGATION_MULTIPLIER,
            capacity: CAPACITY,
            expand_cost: EXPAND_COST,
            restore_cost: RESTORE_COST,
            restore_fuel: RESTORE_FUEL,
            speed: SPEED,
            hold: HOLD,
            local_capacity: LOCAL_CAPACITY,
            haven_period: HAVEN_PERIOD,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn yard_world() -> WorldState {
        let mut w = WorldState::default();
        w.restore_salvage_yard("island-5").unwrap();
        w.set_lighthouse_active("beacon-5", true).unwrap();
        w
    }
    #[test]
    fn spending_is_atomic_and_haven_recovers() {
        let mut w = WorldState::default();
        for _ in 0..5 {
            w.expand("beacon-1").unwrap();
        }
        let before = serde_json::to_value(&w).unwrap();
        assert!(w.expand("beacon-1").is_err());
        assert_eq!(before, serde_json::to_value(&w).unwrap());
        w.economy.paused = true;
        for _ in 0..10 {
            w.tick();
        }
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 0);
        w.economy.paused = false;
        for _ in 0..200 {
            w.tick();
        }
        assert_eq!(w.salvage.as_ref().unwrap().reserve, 20);
        w.expand("beacon-1").unwrap();
    }
    #[test]
    fn restoration_delivery_outage_and_capacity() {
        let mut w = yard_world();
        let reserve = w.salvage.as_ref().unwrap().reserve;
        assert!(!w.restore_salvage_yard("island-5").unwrap());
        assert_eq!(w.salvage.as_ref().unwrap().reserve, reserve);
        for _ in 0..5 {
            w.tick();
        }
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].cargo, 1);
        w.set_lighthouse_active("beacon-5", false).unwrap();
        let frozen = serde_json::to_value(&w.salvage.as_ref().unwrap().ships).unwrap();
        for _ in 0..5 {
            w.tick();
        }
        assert_eq!(
            frozen,
            serde_json::to_value(&w.salvage.as_ref().unwrap().ships).unwrap()
        );
        w.set_lighthouse_active("beacon-5", true).unwrap();
        for _ in 0..20 {
            w.tick();
        }
        assert!(w.salvage.as_ref().unwrap().yards[0].delivered);
        let s = w.salvage.as_mut().unwrap();
        s.reserve = CAPACITY;
        s.ships[0] = Ship {
            yard_id: "island-5".into(),
            from: "beacon-1".into(),
            to: "beacon-1".into(),
            progress: 0.,
            cargo: 20,
            returning: false,
            route: vec![],
        };
        w.tick();
        assert_eq!(w.salvage.as_ref().unwrap().ships[0].cargo, 20);
        w.salvage.as_mut().unwrap().reserve -= 10;
        w.tick();
        assert!(w.salvage.as_ref().unwrap().ships[0].cargo >= 10);
        assert_eq!(w.salvage.as_ref().unwrap().reserve, CAPACITY);
        validate(&w).unwrap();
    }
    #[test]
    fn routes_choose_distance_and_disconnects() {
        let mut w = yard_world();
        assert_eq!(
            w.cargo_route("beacon-5", "beacon-1"),
            vec!["beacon-5", "beacon-1"]
        );
        w.set_lighthouse_active("beacon-1", false).unwrap();
        assert!(w.cargo_route("beacon-5", "beacon-1").is_empty());
    }
    #[test]
    fn cargo_and_timers_survive_save_load() {
        let mut w = yard_world();
        for _ in 0..5 {
            w.tick();
        }
        let path = std::env::temp_dir().join(format!("salvage-cargo-{}.json", std::process::id()));
        crate::persistence::save(&path, &w).unwrap();
        let mut loaded = crate::persistence::load(&path).unwrap();
        assert_eq!(
            serde_json::to_value(&w).unwrap(),
            serde_json::to_value(&loaded).unwrap()
        );
        for _ in 0..30 {
            w.tick();
            loaded.tick();
        }
        assert_eq!(
            serde_json::to_value(&w).unwrap(),
            serde_json::to_value(&loaded).unwrap()
        );
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn invalid_fleet_and_inventories_are_rejected() {
        let w = yard_world();
        let mut bad = w.clone();
        bad.salvage.as_mut().unwrap().ships[0].cargo = HOLD + 1;
        assert!(validate(&bad).is_err());
        let mut bad = w.clone();
        bad.salvage.as_mut().unwrap().ships[0].to = "missing".into();
        assert!(validate(&bad).is_err());
        let mut bad = w.clone();
        bad.salvage.as_mut().unwrap().yards[0].timer = 4;
        assert!(validate(&bad).is_err());
        let mut bad = w.clone();
        let ship = bad.salvage.as_ref().unwrap().ships[0].clone();
        bad.salvage.as_mut().unwrap().ships.push(ship);
        assert!(validate(&bad).is_err());
    }

    #[test]
    fn format_four_keeps_legacy_map_and_free_expansion_after_resaving() {
        let path =
            std::env::temp_dir().join(format!("salvage-legacy-four-{}.json", std::process::id()));
        let mut w = WorldState::default();
        w.islands.truncate(4);
        w.lighthouses.truncate(4);
        let mut value = serde_json::to_value(&w).unwrap();
        value.as_object_mut().unwrap().remove("salvage");
        std::fs::write(
            &path,
            serde_json::to_vec(&serde_json::json!({"save_version": 4, "world": value})).unwrap(),
        )
        .unwrap();
        let mut loaded = crate::persistence::load(&path).unwrap();
        assert!(loaded.salvage.is_none());
        assert_eq!(loaded.islands.len(), 4);
        for _ in 0..6 {
            loaded.expand("beacon-1").unwrap();
        }
        crate::persistence::save(&path, &loaded).unwrap();
        let loaded = crate::persistence::load(&path).unwrap();
        assert!(loaded.salvage.is_none());
        assert_eq!(loaded.lighthouses[0].radius, 650.0);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn fuel_first_and_salvage_first_are_completable() {
        for salvage_first in [false, true] {
            let mut w = WorldState::default();
            if salvage_first {
                w.restore_salvage_yard("island-5").unwrap();
                w.set_lighthouse_active("beacon-5", true).unwrap();
            }
            // Wait for Haven's recovery supply when a previous investment used the reserve.
            for i in 0..3 {
                let id = format!("beacon-{}", i + 1);
                for _ in 0..4 {
                    while w.salvage.as_ref().unwrap().reserve < EXPAND_COST {
                        w.tick();
                    }
                    w.expand(&id).unwrap();
                }
                let next = format!("beacon-{}", i + 2);
                w.set_lighthouse_active(&next, true).unwrap();
                while w.economy.fuel < RESTORE_FUEL {
                    w.tick();
                }
                w.restore_fuel_facility(&format!("island-{}", i + 2))
                    .unwrap();
            }
            for n in [5, 6] {
                while w.salvage.as_ref().unwrap().reserve < RESTORE_COST
                    || w.economy.fuel < RESTORE_FUEL
                {
                    w.tick();
                }
                w.restore_salvage_yard(&format!("island-{n}")).unwrap();
                w.set_lighthouse_active(&format!("beacon-{n}"), true)
                    .unwrap();
            }
            for _ in 0..40 {
                w.tick();
            }
            assert!(
                w.objective_complete(),
                "strategy salvage_first={salvage_first}"
            );
            crate::persistence::validate(&w).unwrap();
        }
    }
}
