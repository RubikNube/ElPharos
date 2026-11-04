pub mod domain;
pub mod persistence;
pub mod protocol;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
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
    sync::watch,
    time::{Duration, timeout},
};

#[derive(Clone)]
struct AppState {
    world: watch::Sender<WorldState>,
    gate: Arc<Mutex<()>>,
    save_path: PathBuf,
}

pub fn app() -> Router {
    let (world, _) = watch::channel(WorldState::default());
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(upgrade))
        .with_state(AppState {
            world,
            gate: Arc::new(Mutex::new(())),
            save_path: std::env::var_os("EL_PHAROS_SAVE_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|| "data/savegame.json".into()),
        })
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
    let _guard = state.gate.lock().unwrap_or_else(|e| e.into_inner());
    let version = match &command {
        ClientMessage::SetLighthouseActive {
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
                state.world.send_replace(loaded);
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

async fn session(mut socket: WebSocket, state: AppState) {
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
