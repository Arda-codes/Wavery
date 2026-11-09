//! Audio playback subsystem for desktop Wavery using Rodio.
//!
//! Encapsulates all concrete audio output and hardware interactions.

pub mod opus;
pub mod player;
pub mod queue;

pub use player::{
    calculate_replay_gain_multiplier, compute_loudness_attenuation, RodioPlayer,
};
pub use queue::StandardQueueManager;

#[cfg(test)]
mod tests;
