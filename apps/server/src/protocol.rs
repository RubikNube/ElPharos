use crate::domain::WorldState;
use serde::{Deserialize, Serialize};

pub const VERSION: u8 = 2;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ClientMessage {
    SaveGame {
        protocol_version: u8,
        request_id: String,
    },
    LoadGame {
        protocol_version: u8,
        request_id: String,
    },
    ExpandLighthouseRadius {
        protocol_version: u8,
        lighthouse_id: String,
    },
    SetLighthouseActive {
        protocol_version: u8,
        lighthouse_id: String,
        active: bool,
    },
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage<'a> {
    CommandResult {
        protocol_version: u8,
        request_id: &'a str,
        success: bool,
        message: &'a str,
    },
    WorldSnapshot {
        protocol_version: u8,
        world: &'a WorldState,
    },
    Error {
        protocol_version: u8,
        message: &'a str,
    },
}
