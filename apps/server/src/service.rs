//! Serialized application commands, simulation clock, and session lifecycle.
use crate::{
    domain::WorldState,
    persistence,
    protocol::{ClientMessage, VERSION},
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::{
    sync::{Notify, watch},
    time::Duration,
};

pub(crate) struct CommandOutcome {
    pub request_id: Option<String>,
    pub changed: bool,
    pub result: Result<(), String>,
}

#[derive(Default)]
struct SimulationClock {
    sessions: usize,
    last_tick: Option<Instant>,
}

pub(crate) struct GameService {
    wake: Arc<Notify>,
    world: watch::Sender<WorldState>,
    gate: Mutex<SimulationClock>,
    save_path: PathBuf,
}

impl Drop for GameService {
    fn drop(&mut self) {
        self.wake.notify_one();
    }
}

impl GameService {
    pub(crate) fn start(save_path: PathBuf) -> Arc<Self> {
        let (world, _) = watch::channel(WorldState::default());
        let state = Arc::new(GameService {
            wake: Arc::new(Notify::new()),
            world,
            gate: Mutex::new(SimulationClock::default()),
            save_path,
        });
        let weak = Arc::downgrade(&state);
        let wake = state.wake.clone();
        tokio::spawn(async move {
            loop {
                let Some(state) = weak.upgrade() else {
                    break;
                };
                let Ok(delay) = tokio::task::spawn_blocking(move || {
                    state.advance(Instant::now());
                    let clock = state.gate.lock().unwrap_or_else(|e| e.into_inner());
                    if clock.sessions == 0 || state.world.borrow().economy.paused {
                        return None;
                    }
                    Some(
                        Duration::from_secs(1)
                            .saturating_sub(clock.last_tick.unwrap_or_else(Instant::now).elapsed()),
                    )
                })
                .await
                else {
                    break;
                };
                if let Some(delay) = delay {
                    tokio::select! { _ = tokio::time::sleep(delay) => {}, _ = wake.notified() => {} }
                } else {
                    wake.notified().await;
                }
            }
        });
        state
    }
    pub(crate) fn execute(&self, command: ClientMessage) -> CommandOutcome {
        let state = self;
        let mut clock = state.gate.lock().unwrap_or_else(|e| e.into_inner());
        let version = command.version();
        let request_id = command.request_id();
        let mut changed = false;
        if version != VERSION {
            return CommandOutcome {
                request_id,
                changed: false,
                result: Err("Unsupported protocol version".into()),
            };
        }
        let result = match command {
            ClientMessage::SetSimulationPaused { paused, .. } => {
                let mut result = Ok(());
                changed = state
                    .world
                    .send_if_modified(|world| match world.set_paused(paused) {
                        Ok(changed) => changed,
                        Err(message) => {
                            result = Err(message.into());
                            false
                        }
                    });
                if changed {
                    clock.last_tick = Some(Instant::now());
                    state.wake.notify_one();
                }
                result
            }
            ClientMessage::SaveGame { .. } => {
                persistence::save(&state.save_path, &state.world.borrow())
            }
            ClientMessage::RestartGame { .. } => {
                let revision = state.world.borrow().next_revision().map_err(String::from);
                revision.map(|revision| {
                    let fresh = WorldState {
                        revision,
                        ..WorldState::default()
                    };
                    clock.last_tick = Some(Instant::now());
                    state.world.send_replace(fresh);
                    changed = true;
                    state.wake.notify_one();
                })
            }
            ClientMessage::LoadGame { .. } => {
                persistence::load(&state.save_path).and_then(|mut loaded| {
                    loaded.revision = state.world.borrow().next_revision()?;
                    clock.last_tick = Some(Instant::now());
                    state.world.send_replace(loaded);
                    changed = true;
                    state.wake.notify_one();
                    Ok(())
                })
            }
            command => {
                let mut result = Ok(());
                changed = state.world.send_if_modified(|world| {
                    let change = match command {
                        ClientMessage::ResearchTechnology { technology_id, .. } => {
                            world.research_technology(technology_id)
                        }
                        ClientMessage::SetLighthouseSpecialization {
                            lighthouse_id,
                            specialization,
                            ..
                        } => world.specialize(&lighthouse_id, specialization),
                        ClientMessage::RestoreSalvageYard { island_id, .. } => {
                            world.restore_salvage_yard(&island_id)
                        }
                        ClientMessage::RestoreFuelFacility { island_id, .. } => {
                            world.restore_fuel_facility(&island_id)
                        }
                        ClientMessage::SetLighthouseActive {
                            lighthouse_id,
                            active,
                            ..
                        } => world.set_lighthouse_active(&lighthouse_id, active),
                        ClientMessage::ExpandLighthouseRadius { lighthouse_id, .. } => {
                            world.expand(&lighthouse_id)
                        }
                        _ => unreachable!(),
                    };
                    match change {
                        Ok(changed) => changed,
                        Err(message) => {
                            result = Err(message.into());
                            false
                        }
                    }
                });
                result
            }
        };
        CommandOutcome {
            request_id,
            changed,
            result,
        }
    }

    fn advance(&self, now: Instant) {
        let state = self;
        let mut clock = state.gate.lock().unwrap_or_else(|e| e.into_inner());
        if clock.sessions == 0
            || clock
                .last_tick
                .is_none_or(|last| now.duration_since(last) < Duration::from_secs(1))
        {
            return;
        }
        clock.last_tick = Some(now);
        state.world.send_if_modified(WorldState::tick);
    }

    pub(crate) fn register_session(self: &Arc<Self>) -> SessionGuard {
        let mut clock = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        if clock.sessions == 0 {
            clock.last_tick = Some(Instant::now());
            self.wake.notify_one();
        }
        clock.sessions += 1;
        SessionGuard(self.clone())
    }

    pub(crate) fn subscribe(&self) -> watch::Receiver<WorldState> {
        self.world.subscribe()
    }
}
pub(crate) struct SessionGuard(Arc<GameService>);
impl Drop for SessionGuard {
    fn drop(&mut self) {
        let state = self.0.clone();
        tokio::task::spawn_blocking(move || {
            let mut clock = state.gate.lock().unwrap_or_else(|e| e.into_inner());
            clock.sessions -= 1;
            if clock.sessions == 0 {
                clock.last_tick = None;
                state.wake.notify_one();
            }
        });
    }
}

#[cfg(test)]
mod simulation_tests {
    use super::*;
    fn state(now: Instant) -> Arc<GameService> {
        let (world, _) = watch::channel(crate::scenario::fixed_world());
        Arc::new(GameService {
            wake: Arc::new(Notify::new()),
            world,
            gate: Mutex::new(SimulationClock {
                sessions: 2,
                last_tick: Some(now),
            }),
            save_path: std::env::temp_dir().join(format!(
                "el-pharos-clock-{}-{:?}.json",
                std::process::id(),
                std::thread::current().id()
            )),
        })
    }
    #[test]
    fn timing_pause_disconnection_and_no_catchup() {
        let now = Instant::now();
        let s = state(now);
        s.advance(now + Duration::from_millis(999));
        assert_eq!(s.world.borrow().revision, 0);
        s.advance(now + Duration::from_secs(1));
        s.advance(now + Duration::from_secs(1));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 1);
        s.execute(ClientMessage::SetSimulationPaused {
            protocol_version: VERSION,
            paused: true,
        })
        .result
        .unwrap();
        s.advance(now + Duration::from_secs(10));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 1);
        s.execute(ClientMessage::SetSimulationPaused {
            protocol_version: VERSION,
            paused: false,
        })
        .result
        .unwrap();
        s.gate.lock().unwrap().last_tick = Some(now + Duration::from_secs(10));
        s.advance(now + Duration::from_millis(10999));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 1);
        s.advance(now + Duration::from_secs(100));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 2);
        s.gate.lock().unwrap().sessions = 0;
        s.advance(now + Duration::from_secs(200));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 2);
        {
            let mut c = s.gate.lock().unwrap();
            c.sessions = 1;
            c.last_tick = Some(now + Duration::from_secs(200));
        }
        s.advance(now + Duration::from_millis(200999));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 2);
        s.advance(now + Duration::from_secs(201));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 3);
    }
    #[test]
    fn restart_resets_the_shared_world_and_clock_without_overwriting_save() {
        let s = state(Instant::now());
        s.execute(ClientMessage::ExpandLighthouseRadius {
            protocol_version: VERSION,
            lighthouse_id: "beacon-1".into(),
        })
        .result
        .unwrap();
        s.execute(ClientMessage::SaveGame {
            protocol_version: VERSION,
            request_id: "save".into(),
        })
        .result
        .unwrap();
        let saved = std::fs::read(&s.save_path).unwrap();
        s.execute(ClientMessage::SetSimulationPaused {
            protocol_version: VERSION,
            paused: true,
        })
        .result
        .unwrap();
        let mut observer = s.subscribe();
        let revision = observer.borrow_and_update().revision;
        let result = s.execute(ClientMessage::RestartGame {
            protocol_version: VERSION,
            request_id: "restart".into(),
        });
        assert!(result.result.is_ok());
        assert!(result.changed);
        assert_eq!(result.request_id.as_deref(), Some("restart"));
        assert!(observer.has_changed().unwrap());
        let fresh = observer.borrow().clone();
        crate::validation::validate(&fresh).unwrap();
        assert_eq!(fresh.revision, revision + 1);
        assert!((6..=12).contains(&fresh.islands.len()));
        assert_eq!(fresh.economy.fuel, 300.0);
        assert_eq!(fresh.economy.elapsed_seconds, 0);
        assert!(!fresh.economy.paused);
        assert_eq!(fresh.lighthouses.iter().filter(|l| l.active).count(), 1);
        assert!(
            fresh
                .salvage
                .as_ref()
                .unwrap()
                .yards
                .iter()
                .all(|y| !y.restored)
        );
        assert!(fresh.research.as_ref().unwrap().completed.is_empty());
        assert_ne!(
            serde_json::to_value(&fresh.islands).unwrap(),
            serde_json::to_value(crate::scenario::fixed_world().islands).unwrap()
        );
        assert_eq!(std::fs::read(&s.save_path).unwrap(), saved);
        let restarted_at = s.gate.lock().unwrap().last_tick.unwrap();
        s.advance(restarted_at + Duration::from_millis(999));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 0);
        s.advance(restarted_at + Duration::from_secs(1));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 1);
        std::fs::remove_file(&s.save_path).unwrap();
    }
    #[test]
    fn persistence_and_ticks_share_the_gate() {
        let now = Instant::now();
        let s = state(now);
        s.execute(ClientMessage::SaveGame {
            protocol_version: VERSION,
            request_id: "save".into(),
        })
        .result
        .unwrap();
        s.advance(now + Duration::from_secs(1));
        assert_eq!(s.world.borrow().economy.fuel, 301.0);
        s.execute(ClientMessage::LoadGame {
            protocol_version: VERSION,
            request_id: "load".into(),
        })
        .result
        .unwrap();
        assert_eq!(s.world.borrow().economy.fuel, 300.0);
        assert_eq!(s.world.borrow().revision, 2);
        let restored_at = s.gate.lock().unwrap().last_tick.unwrap();
        s.advance(restored_at + Duration::from_millis(999));
        assert_eq!(s.world.borrow().economy.fuel, 300.0);
        std::fs::remove_file(&s.save_path).unwrap();
    }
}
