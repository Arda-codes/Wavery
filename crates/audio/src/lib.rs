//! Audio playback subsystem for desktop Wavery using Rodio.
//!
//! Encapsulates all concrete audio output and hardware interactions.

pub mod player;
pub mod queue;

pub use player::RodioPlayer;
pub use queue::StandardQueueManager;

#[cfg(test)]
mod tests;
