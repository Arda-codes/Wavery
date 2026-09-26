//! Queue manager implementation handling play order, shuffling, and looping.

use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};
use std::time::Duration;
use wavery_core::models::{LoopMode, Track};
use wavery_core::traits::QueueManager;

/// Default implementation of linear and shuffled playback queue.
pub struct StandardQueueManager {
    queue: Vec<Track>,
    current_idx: Option<usize>,
    shuffle: bool,
    loop_mode: LoopMode,
    shuffled_indices: Vec<usize>,
    shuffle_pos: usize,
}

impl StandardQueueManager {
    /// Creates an empty queue manager.
    #[must_use]
    pub fn new() -> Self {
        Self {
            queue: Vec::new(),
            current_idx: None,
            shuffle: false,
            loop_mode: LoopMode::Off,
            shuffled_indices: Vec::new(),
            shuffle_pos: 0,
        }
    }

    fn rebuild_shuffle(&mut self) {
        let count = self.queue.len();
        self.shuffled_indices = (0..count).collect();
        let mut rng = thread_rng();
        self.shuffled_indices.shuffle(&mut rng);

        if let Some(curr) = self.current_idx {
            if let Some(pos) = self.shuffled_indices.iter().position(|&x| x == curr) {
                self.shuffled_indices.swap(0, pos);
                self.shuffle_pos = 0;
            }
        }
    }

    fn rebuild_shuffle_for_loop(&mut self, prev_idx: usize) {
        let count = self.queue.len();
        self.shuffled_indices = (0..count).collect();
        let mut rng = thread_rng();
        self.shuffled_indices.shuffle(&mut rng);

        if count > 1 && self.shuffled_indices.first() == Some(&prev_idx) {
            let swap_target = rng.gen_range(1..count);
            self.shuffled_indices.swap(0, swap_target);
        }
        self.shuffle_pos = 0;
        self.current_idx = self.shuffled_indices.first().copied();
    }
}

impl Default for StandardQueueManager {
    fn default() -> Self {
        Self::new()
    }
}

impl QueueManager for StandardQueueManager {
    fn set_queue(&mut self, tracks: Vec<Track>, start_index: usize) {
        self.queue = tracks;
        if self.queue.is_empty() {
            self.current_idx = None;
            self.shuffled_indices.clear();
            self.shuffle_pos = 0;
        } else {
            let valid_index = start_index.min(self.queue.len() - 1);
            self.current_idx = Some(valid_index);
            if self.shuffle {
                self.rebuild_shuffle();
            }
        }
    }

    fn push_back(&mut self, track: Track) {
        self.queue.push(track);
        let new_index = self.queue.len() - 1;
        if self.queue.len() == 1 {
            self.current_idx = Some(0);
            if self.shuffle {
                self.shuffled_indices = vec![0];
                self.shuffle_pos = 0;
            }
        } else if self.shuffle {
            if self.shuffled_indices.is_empty() {
                self.rebuild_shuffle();
            } else {
                self.shuffled_indices.push(new_index);
            }
        }
    }

    fn play_next(&mut self, track: Track) {
        if self.queue.is_empty() || self.current_idx.is_none() {
            self.queue.push(track);
            self.current_idx = Some(0);
            if self.shuffle {
                self.shuffled_indices = vec![0];
                self.shuffle_pos = 0;
            }
        } else if let Some(idx) = self.current_idx {
            let insert_at = idx + 1;
            if insert_at >= self.queue.len() {
                self.queue.push(track);
            } else {
                self.queue.insert(insert_at, track);
            }

            if self.shuffle {
                if self.shuffled_indices.is_empty() {
                    self.rebuild_shuffle();
                } else {
                    for index in &mut self.shuffled_indices {
                        if *index >= insert_at {
                            *index += 1;
                        }
                    }
                    let splice_pos = (self.shuffle_pos + 1).min(self.shuffled_indices.len());
                    self.shuffled_indices.insert(splice_pos, insert_at);
                }
            }
        }
    }

    fn next(&mut self) -> Option<&Track> {
        if self.queue.is_empty() {
            return None;
        }

        if self.loop_mode == LoopMode::Track {
            return self.current_track();
        }

        if self.shuffle {
            if self.shuffle_pos + 1 < self.shuffled_indices.len() {
                self.shuffle_pos += 1;
                self.current_idx = Some(self.shuffled_indices[self.shuffle_pos]);
                self.current_track()
            } else if self.loop_mode == LoopMode::Queue {
                let prev_idx = self.current_idx.unwrap_or(0);
                self.rebuild_shuffle_for_loop(prev_idx);
                self.current_track()
            } else {
                None
            }
        } else if let Some(curr) = self.current_idx {
            if curr + 1 < self.queue.len() {
                self.current_idx = Some(curr + 1);
                self.current_track()
            } else if self.loop_mode == LoopMode::Queue {
                self.current_idx = Some(0);
                self.current_track()
            } else {
                None
            }
        } else {
            self.current_idx = Some(0);
            self.current_track()
        }
    }

    fn previous(&mut self, current_pos: Duration) -> Option<&Track> {
        if self.queue.is_empty() {
            return None;
        }

        // If played more than 3 seconds into track, restart current track
        if current_pos > Duration::from_secs(3) {
            return self.current_track();
        }

        if self.shuffle {
            if self.shuffle_pos > 0 {
                self.shuffle_pos -= 1;
                self.current_idx = Some(self.shuffled_indices[self.shuffle_pos]);
                self.current_track()
            } else {
                self.current_track()
            }
        } else if let Some(curr) = self.current_idx {
            if curr > 0 {
                self.current_idx = Some(curr - 1);
                self.current_track()
            } else {
                self.current_track()
            }
        } else {
            self.current_track()
        }
    }

    fn set_shuffle(&mut self, enabled: bool) {
        self.shuffle = enabled;
        if enabled {
            self.rebuild_shuffle();
        }
    }

    fn set_loop_mode(&mut self, mode: LoopMode) {
        self.loop_mode = mode;
    }

    fn current_track(&self) -> Option<&Track> {
        self.current_idx.and_then(|idx| self.queue.get(idx))
    }

    fn current_index(&self) -> Option<usize> {
        self.current_idx
    }

    fn queue(&self) -> &[Track] {
        &self.queue
    }

    fn is_shuffle(&self) -> bool {
        self.shuffle
    }

    fn loop_mode(&self) -> LoopMode {
        self.loop_mode
    }
}
