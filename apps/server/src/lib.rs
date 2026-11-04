pub mod domain;
pub mod protocol;

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

pub fn app() -> Router {
    let (world, _) = watch::channel(WorldState::default());
    Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/ws", get(upgrade))
        .with_state(world)
}

async fn upgrade(ws: WebSocketUpgrade, State(world): State<watch::Sender<WorldState>>) -> Response {
    ws.max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| session(socket, world))
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

async fn session(mut socket: WebSocket, world: watch::Sender<WorldState>) {
    let mut updates = world.subscribe();
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
                        Ok(ClientMessage::SetLighthouseActive { protocol_version, lighthouse_id, active }) => {
                            if protocol_version != VERSION {
                                Some("Unsupported protocol version")
                            } else {
                                let mut error = None;
                                world.send_if_modified(|state| match state.set_lighthouse_active(&lighthouse_id, active) {
                                    Ok(changed) => changed,
                                    Err(message) => { error = Some(message); false }
                                });
                                // Also acknowledge an idempotent command with the authoritative state.
                                if error.is_none() && !snapshot(&mut socket, &mut updates).await { break; }
                                error
                            }
                        }
                        Err(_) => Some("Invalid command"),
                    },
                    Some(Ok(Message::Binary(_))) => Some("Expected a JSON text message"),
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => None, // Axum handles WebSocket ping/pong control frames.
                };
                if let Some(message) = error
                    && !send(&mut socket, &ServerMessage::Error { protocol_version: VERSION, message }).await {
                    break;
                }
            }
        }
    }
}
