use crate::domain::WorldState;
use serde::{Deserialize, Serialize};

pub const VERSION: u8 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientMessage {
    SetLighthouseActive {
        protocol_version: u8,
        lighthouse_id: String,
        active: bool,
    },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage<'a> {
    WorldSnapshot {
        protocol_version: u8,
        world: &'a WorldState,
    },
    Error {
        protocol_version: u8,
        message: &'a str,
    },
}
