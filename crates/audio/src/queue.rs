//! Queue manager implementation handling play order, shuffling, and looping.

use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};
use std::time::Duration;
use wavery_core::models::{LoopMode, Track};
use wavery_core::traits::QueueManager;

/// Default implementation of linear, shuffled, and two-tier playback queue.
pub struct StandardQueueManager {
    queue: Vec<Track>,
    current_idx: Option<usize>,
    shuffle: bool,
    loop_mode: LoopMode,
    shuffled_indices: Vec<usize>,
    shuffle_pos: usize,
    user_queue: Vec<Track>,
    history: Vec<Track>,
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
            user_queue: Vec::new(),
            history: Vec::new(),
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
        self.user_queue.clear();
        self.history.clear();
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

    fn set_context_queue(&mut self, tracks: Vec<Track>, start_index: usize) {
        if tracks.is_empty() {
            self.set_queue(tracks, start_index);
            return;
        }

        let pending_user = std::mem::take(&mut self.user_queue);
        self.set_queue(tracks, start_index);

        // Re-insert pending user queue items in reverse so original order is preserved
        for track in pending_user.into_iter().rev() {
            self.play_next(track);
        }
    }

    fn push_back(&mut self, track: Track) {
        self.user_queue.push(track.clone());
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
        self.user_queue.insert(0, track.clone());
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

        // Record history before transition
        if let Some(curr) = self.current_track() {
            self.history.push(curr.clone());
            if self.history.len() > 100 {
                self.history.remove(0);
            }
        }

        // Pop from user_queue if next item was user-queued
        if !self.user_queue.is_empty() {
            self.user_queue.remove(0);
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

        if !self.history.is_empty() {
            let _ = self.history.pop();
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

    fn user_queue(&self) -> &[Track] {
        &self.user_queue
    }

    fn clear_user_queue(&mut self) {
        if self.user_queue.is_empty() {
            return;
        }

        let user_ids: std::collections::HashSet<_> =
            self.user_queue.iter().map(|t| t.id.clone()).collect();
        self.user_queue.clear();

        if let Some(curr_idx) = self.current_idx {
            // Remove user queued items that appear after curr_idx
            let mut i = curr_idx + 1;
            while i < self.queue.len() {
                if user_ids.contains(&self.queue[i].id) {
                    self.queue.remove(i);
                } else {
                    i += 1;
                }
            }
            if self.shuffle {
                self.rebuild_shuffle();
            }
        }
    }

    fn remove_user_track(&mut self, index: usize) -> Option<Track> {
        if index >= self.user_queue.len() {
            return None;
        }

        let removed = self.user_queue.remove(index);
        if let Some(curr_idx) = self.current_idx {
            // Find in queue starting after current_idx
            if let Some(pos) = self.queue[curr_idx + 1..]
                .iter()
                .position(|t| t.id == removed.id)
            {
                let queue_idx = curr_idx + 1 + pos;
                self.queue.remove(queue_idx);
                if self.shuffle {
                    self.rebuild_shuffle();
                }
            }
        }
        Some(removed)
    }

    fn reorder_user_queue(&mut self, from: usize, to: usize) {
        if from >= self.user_queue.len() || to >= self.user_queue.len() || from == to {
            return;
        }

        let track = self.user_queue.remove(from);
        self.user_queue.insert(to, track);

        // Re-sync items in queue after current_idx
        if let Some(curr_idx) = self.current_idx {
            let start = curr_idx + 1;
            let count = self.user_queue.len();
            if start + count <= self.queue.len() {
                for (offset, item) in self.user_queue.iter().enumerate() {
                    self.queue[start + offset] = item.clone();
                }
            }
        }
    }

    fn history(&self) -> &[Track] {
        &self.history
    }

    fn is_shuffle(&self) -> bool {
        self.shuffle
    }

    fn loop_mode(&self) -> LoopMode {
        self.loop_mode
    }
}
