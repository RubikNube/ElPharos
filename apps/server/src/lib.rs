pub mod domain;
pub mod expedition;
mod geometry;
pub mod health;
mod network;
pub mod persistence;
pub mod protocol;
pub mod research;
pub mod rules;
pub mod salvage;
mod scenario;
mod service;
mod validation;
pub mod veil;
pub mod vessel;
pub mod voyages;

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
use service::{CommandOutcome, GameService};
use std::sync::Arc;
use tokio::{
    sync::watch,
    time::{Duration, timeout},
};

type AppState = Arc<GameService>;

pub fn app() -> Router {
    let save_path = std::env::var_os("EL_PHAROS_SAVE_PATH")
        .map(Into::into)
        .unwrap_or_else(|| "data/savegame.json".into());
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(upgrade))
        .with_state(GameService::start(save_path))
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

async fn session(mut socket: WebSocket, state: AppState) {
    let shared = state.clone();
    let Ok(_session) = tokio::task::spawn_blocking(move || shared.register_session()).await else {
        return;
    };
    let mut updates = state.subscribe();
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
                            match tokio::task::spawn_blocking(move || shared.execute(command)).await {
                                Ok(CommandOutcome { request_id: request, changed: _changed, result }) => {
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
