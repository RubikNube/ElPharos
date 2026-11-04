pub mod domain;
pub mod persistence;
pub mod protocol;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Instant,
};

use axum::{
    Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    response::Response,
    routing::get,
};
use domain::WorldState;
use protocol::{ClientMessage, ServerMessage, VERSION};
use tokio::{
    sync::{Notify, watch},
    time::{Duration, timeout},
};

type AppState = Arc<SharedState>;

#[derive(Default)]
struct SimulationClock {
    sessions: usize,
    last_tick: Option<Instant>,
}

struct SharedState {
    wake: Arc<Notify>,
    world: watch::Sender<WorldState>,
    gate: Mutex<SimulationClock>,
    save_path: PathBuf,
}

impl Drop for SharedState {
    fn drop(&mut self) {
        self.wake.notify_one();
    }
}

pub fn app() -> Router {
    let (world, _) = watch::channel(WorldState::default());
    let state = Arc::new(SharedState {
        wake: Arc::new(Notify::new()),
        world,
        gate: Mutex::new(SimulationClock::default()),
        save_path: std::env::var_os("EL_PHAROS_SAVE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|| "data/savegame.json".into()),
    });
    let weak = Arc::downgrade(&state);
    let wake = state.wake.clone();
    tokio::spawn(async move {
        loop {
            let Some(state) = weak.upgrade() else {
                break;
            };
            let Ok(delay) = tokio::task::spawn_blocking(move || {
                advance(&state, Instant::now());
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
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(upgrade))
        .with_state(state)
}

async fn upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| session(socket, state))
}

async fn send(socket: &mut WebSocket, message: &ServerMessage<'_>) -> bool {
    let Ok(json) = serde_json::to_string(message) else {
        return false;
    };
    matches!(
        timeout(
            Duration::from_secs(5),
            socket.send(Message::Text(json.into()))
        )
        .await,
        Ok(Ok(()))
    )
}

async fn snapshot(socket: &mut WebSocket, updates: &mut watch::Receiver<WorldState>) -> bool {
    let world = updates.borrow_and_update().clone();
    send(
        socket,
        &ServerMessage::WorldSnapshot {
            protocol_version: VERSION,
            world: &world,
        },
    )
    .await
}

fn execute(state: &AppState, command: ClientMessage) -> (Option<String>, Result<(), String>) {
    let mut clock = state.gate.lock().unwrap_or_else(|e| e.into_inner());
    let version = match &command {
        ClientMessage::SetSimulationPaused {
            protocol_version, ..
        }
        | ClientMessage::SetLighthouseActive {
            protocol_version, ..
        }
        | ClientMessage::ExpandLighthouseRadius {
            protocol_version, ..
        }
        | ClientMessage::SaveGame {
            protocol_version, ..
        }
        | ClientMessage::LoadGame {
            protocol_version, ..
        } => *protocol_version,
    };
    let request = match &command {
        ClientMessage::SaveGame { request_id, .. } | ClientMessage::LoadGame { request_id, .. } => {
            Some(request_id.clone())
        }
        _ => None,
    };
    if version != VERSION {
        return (request, Err("Unsupported protocol version".into()));
    }
    let result = match command {
        ClientMessage::SetSimulationPaused { paused, .. } => {
            if state
                .world
                .send_if_modified(|world| world.set_paused(paused))
            {
                clock.last_tick = Some(Instant::now());
                state.wake.notify_one();
            }
            Ok(())
        }
        ClientMessage::SaveGame { .. } => {
            persistence::save(&state.save_path, &state.world.borrow())
        }
        ClientMessage::LoadGame { .. } => {
            persistence::load(&state.save_path).and_then(|mut loaded| {
                loaded.revision = state
                    .world
                    .borrow()
                    .revision
                    .checked_add(1)
                    .filter(|v| *v <= 9_007_199_254_740_991)
                    .ok_or("World revision exhausted")?;
                clock.last_tick = Some(Instant::now());
                state.world.send_replace(loaded);
                state.wake.notify_one();
                Ok(())
            })
        }
        command => {
            let mut result = Ok(());
            state.world.send_if_modified(|world| {
                let change = match command {
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
    (request, result)
}

fn advance(state: &AppState, now: Instant) {
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

struct SessionGuard(AppState);
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

async fn session(mut socket: WebSocket, state: AppState) {
    let shared = state.clone();
    let Ok(_session) = tokio::task::spawn_blocking(move || {
        {
            let mut clock = shared.gate.lock().unwrap_or_else(|e| e.into_inner());
            if clock.sessions == 0 {
                clock.last_tick = Some(Instant::now());
                shared.wake.notify_one();
            }
            clock.sessions += 1;
        }
        SessionGuard(shared)
    })
    .await
    else {
        return;
    };
    let mut updates = state.world.subscribe();
    if !snapshot(&mut socket, &mut updates).await {
        return;
    }
    loop {
        tokio::select! {
            changed = updates.changed() => {
                if changed.is_err() || !snapshot(&mut socket, &mut updates).await { break; }
            }
            incoming = socket.recv() => {
                let error = match incoming {
                    Some(Ok(Message::Text(text))) => match serde_json::from_str::<ClientMessage>(&text) {
                        Ok(command) => {
                            let shared = state.clone();
                            match tokio::task::spawn_blocking(move || execute(&shared, command)).await {
                                Ok((request, result)) => {
                                    if let Some(request_id) = request {
                                        let message = result.as_ref().err().map(String::as_str).unwrap_or("Done");
                                        if !send(&mut socket, &ServerMessage::CommandResult { protocol_version: VERSION, request_id: &request_id, success: result.is_ok(), message }).await { break; }
                                        if result.is_ok() && !snapshot(&mut socket, &mut updates).await { break; }
                                        None
                                    } else {
                                        if result.is_ok() && !snapshot(&mut socket, &mut updates).await { break; }
                                        result.err()
                                    }
                                }
                                Err(_) => Some("Command failed".into()),
                            }
                        }
                        Err(_) => Some("Invalid command".into()),
                    },
                    Some(Ok(Message::Binary(_))) => Some("Expected a JSON text message".into()),
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => None,
                };
                if let Some(message) = error
                    && !send(&mut socket, &ServerMessage::Error { protocol_version: VERSION, message: &message }).await { break; }
            }
        }
    }
}

#[cfg(test)]
mod simulation_tests {
    use super::*;
    fn state(now: Instant) -> AppState {
        let (world, _) = watch::channel(WorldState::default());
        Arc::new(SharedState {
            wake: Arc::new(Notify::new()),
            world,
            gate: Mutex::new(SimulationClock {
                sessions: 2,
                last_tick: Some(now),
            }),
            save_path: std::env::temp_dir()
                .join(format!("el-pharos-clock-{}.json", std::process::id())),
        })
    }
    #[test]
    fn timing_pause_disconnection_and_no_catchup() {
        let now = Instant::now();
        let s = state(now);
        advance(&s, now + Duration::from_millis(999));
        assert_eq!(s.world.borrow().revision, 0);
        advance(&s, now + Duration::from_secs(1));
        advance(&s, now + Duration::from_secs(1));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 1);
        execute(
            &s,
            ClientMessage::SetSimulationPaused {
                protocol_version: VERSION,
                paused: true,
            },
        )
        .1
        .unwrap();
        advance(&s, now + Duration::from_secs(10));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 1);
        execute(
            &s,
            ClientMessage::SetSimulationPaused {
                protocol_version: VERSION,
                paused: false,
            },
        )
        .1
        .unwrap();
        s.gate.lock().unwrap().last_tick = Some(now + Duration::from_secs(10));
        advance(&s, now + Duration::from_millis(10999));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 1);
        advance(&s, now + Duration::from_secs(100));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 2);
        s.gate.lock().unwrap().sessions = 0;
        advance(&s, now + Duration::from_secs(200));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 2);
        {
            let mut c = s.gate.lock().unwrap();
            c.sessions = 1;
            c.last_tick = Some(now + Duration::from_secs(200));
        }
        advance(&s, now + Duration::from_millis(200999));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 2);
        advance(&s, now + Duration::from_secs(201));
        assert_eq!(s.world.borrow().economy.elapsed_seconds, 3);
    }
    #[test]
    fn persistence_and_ticks_share_the_gate() {
        let now = Instant::now();
        let s = state(now);
        execute(
            &s,
            ClientMessage::SaveGame {
                protocol_version: VERSION,
                request_id: "save".into(),
            },
        )
        .1
        .unwrap();
        advance(&s, now + Duration::from_secs(1));
        assert_eq!(s.world.borrow().economy.fuel, 301.0);
        execute(
            &s,
            ClientMessage::LoadGame {
                protocol_version: VERSION,
                request_id: "load".into(),
            },
        )
        .1
        .unwrap();
        assert_eq!(s.world.borrow().economy.fuel, 300.0);
        assert_eq!(s.world.borrow().revision, 2);
        let restored_at = s.gate.lock().unwrap().last_tick.unwrap();
        advance(&s, restored_at + Duration::from_millis(999));
        assert_eq!(s.world.borrow().economy.fuel, 300.0);
        std::fs::remove_file(&s.save_path).unwrap();
    }
}
