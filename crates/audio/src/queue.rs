//! Queue manager implementation handling play order, shuffling, looping, and autoplay.

use rand::seq::SliceRandom;
use rand::{thread_rng, Rng};
use std::collections::HashSet;
use std::time::Duration;
use wavery_core::models::{LoopMode, QueueStateSnapshot, Track};
use wavery_core::traits::QueueManager;

/// Default implementation of linear, shuffled, two-tier playback queue, and autoplay engine.
pub struct StandardQueueManager {
    context_queue: Vec<Track>,
    context_idx: Option<usize>,
    queue: Vec<Track>,
    current_idx: Option<usize>,
    shuffle: bool,
    loop_mode: LoopMode,
    is_autoplay: bool,
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
            context_queue: Vec::new(),
            context_idx: None,
            queue: Vec::new(),
            current_idx: None,
            shuffle: false,
            loop_mode: LoopMode::Off,
            is_autoplay: false,
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
        self.shuffle_pos = 0;

        if let Some(curr) = self.current_idx {
            if let Some(pos) = self.shuffled_indices.iter().position(|&x| x == curr) {
                self.shuffled_indices.swap(0, pos);
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
        self.context_queue = tracks.clone();
        self.queue = tracks;
        self.user_queue.clear();
        self.history.clear();
        if self.queue.is_empty() {
            self.current_idx = None;
            self.context_idx = None;
            self.shuffled_indices.clear();
            self.shuffle_pos = 0;
        } else {
            let valid_index = start_index.min(self.queue.len() - 1);
            self.current_idx = Some(valid_index);
            self.context_idx = Some(valid_index);
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

        // Compute next target index and shuffle pointer
        let target = if self.shuffle {
            if self.shuffled_indices.len() != self.queue.len() {
                self.rebuild_shuffle();
            }
            if self.shuffle_pos + 1 < self.shuffled_indices.len() {
                let next_pos = self.shuffle_pos + 1;
                Some((self.shuffled_indices[next_pos], Some(next_pos)))
            } else if self.loop_mode == LoopMode::Queue {
                let prev_idx = self.current_idx.unwrap_or(0);
                self.rebuild_shuffle_for_loop(prev_idx);
                self.current_idx.map(|idx| (idx, Some(0)))
            } else {
                None
            }
        } else if let Some(curr) = self.current_idx {
            if curr + 1 < self.queue.len() {
                Some((curr + 1, None))
            } else if self.loop_mode == LoopMode::Queue {
                Some((0, None))
            } else {
                None
            }
        } else {
            Some((0, None))
        };

        if let Some((next_idx, maybe_shuffle_pos)) = target {
            self.current_idx = Some(next_idx);
            if let Some(pos) = maybe_shuffle_pos {
                self.shuffle_pos = pos;
            }

            // Check user queue provenance and drain only if next item was user-queued
            let next_id = self.queue[next_idx].id.clone();
            if let Some(pos) = self.user_queue.iter().position(|t| t.id == next_id) {
                self.user_queue.remove(pos);
                // context_idx is preserved while playing from user priority queue
            } else if let Some(c_pos) = self.context_queue.iter().position(|t| t.id == next_id) {
                self.context_idx = Some(c_pos);
            }

            self.current_track()
        } else {
            None
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
            }
        } else if let Some(curr) = self.current_idx {
            if curr > 0 {
                self.current_idx = Some(curr - 1);
            }
        } else {
            self.current_idx = Some(0);
        }

        if let Some(curr) = self.current_track() {
            if let Some(c_pos) = self.context_queue.iter().position(|t| t.id == curr.id) {
                self.context_idx = Some(c_pos);
            }
        }

        self.current_track()
    }

    fn set_shuffle(&mut self, enabled: bool) {
        self.shuffle = enabled;
        if enabled {
            self.rebuild_shuffle();
        } else {
            self.shuffled_indices.clear();
            self.shuffle_pos = 0;
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

    fn context_queue(&self) -> &[Track] {
        &self.context_queue
    }

    fn context_index(&self) -> Option<usize> {
        self.context_idx
    }

    fn is_autoplay(&self) -> bool {
        self.is_autoplay
    }

    fn set_autoplay(&mut self, enabled: bool) {
        self.is_autoplay = enabled;
    }

    fn clear_user_queue(&mut self) {
        if self.user_queue.is_empty() {
            return;
        }

        let user_ids: HashSet<_> = self.user_queue.iter().map(|t| t.id.clone()).collect();
        self.user_queue.clear();

        if let Some(curr_idx) = self.current_idx {
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
        let start_idx = self.current_idx.map(|c| c + 1).unwrap_or(0);
        if let Some(pos) = self.queue[start_idx..]
            .iter()
            .position(|t| t.id == removed.id)
        {
            let queue_idx = start_idx + pos;
            self.queue.remove(queue_idx);
            if self.shuffle {
                self.rebuild_shuffle();
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

        let start_idx = self.current_idx.map(|c| c + 1).unwrap_or(0);
        let user_ids: HashSet<&str> = self.user_queue.iter().map(|t| t.id.as_str()).collect();
        let mut user_positions = Vec::new();
        for (i, t) in self.queue.iter().enumerate().skip(start_idx) {
            if user_ids.contains(t.id.as_str()) {
                user_positions.push(i);
            }
        }
        if user_positions.len() == self.user_queue.len() {
            for (pos_idx, &q_idx) in user_positions.iter().enumerate() {
                self.queue[q_idx] = self.user_queue[pos_idx].clone();
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

    fn jump_to_index(&mut self, index: usize) -> Option<&Track> {
        if index >= self.queue.len() {
            return None;
        }

        if let Some(curr) = self.current_track() {
            self.history.push(curr.clone());
            if self.history.len() > 100 {
                self.history.remove(0);
            }
        }

        self.current_idx = Some(index);
        let track_id = self.queue[index].id.clone();
        if let Some(pos) = self.user_queue.iter().position(|t| t.id == track_id) {
            self.user_queue.remove(pos);
        } else if let Some(c_pos) = self.context_queue.iter().position(|t| t.id == track_id) {
            self.context_idx = Some(c_pos);
        }

        if self.shuffle {
            if self.shuffled_indices.len() != self.queue.len() {
                self.rebuild_shuffle();
            } else if let Some(pos) = self.shuffled_indices.iter().position(|&x| x == index) {
                if pos > self.shuffle_pos {
                    let val = self.shuffled_indices.remove(pos);
                    let target_pos = (self.shuffle_pos + 1).min(self.shuffled_indices.len());
                    self.shuffled_indices.insert(target_pos, val);
                    self.shuffle_pos = target_pos;
                } else if pos < self.shuffle_pos {
                    let val = self.shuffled_indices.remove(pos);
                    let target_pos = self.shuffle_pos.min(self.shuffled_indices.len());
                    self.shuffled_indices.insert(target_pos, val);
                    self.shuffle_pos = target_pos;
                }
            }
        }

        self.current_track()
    }

    fn jump_to_context_track(&mut self, context_index: usize) -> Option<&Track> {
        if context_index >= self.context_queue.len() {
            return None;
        }
        let target_id = self.context_queue[context_index].id.clone();
        if let Some(q_idx) = self.queue.iter().position(|t| t.id == target_id) {
            self.jump_to_index(q_idx)
        } else {
            None
        }
    }

    fn jump_to_user_track(&mut self, user_index: usize) -> Option<&Track> {
        if user_index >= self.user_queue.len() {
            return None;
        }
        let target_id = self.user_queue[user_index].id.clone();
        if let Some(q_idx) = self.queue.iter().position(|t| t.id == target_id) {
            self.jump_to_index(q_idx)
        } else {
            None
        }
    }

    fn clear(&mut self) {
        self.set_queue(Vec::new(), 0);
    }

    fn get_state(&self) -> QueueStateSnapshot {
        QueueStateSnapshot {
            current_track: self.current_track().cloned(),
            current_index: self.current_idx,
            user_queue: self.user_queue.clone(),
            context_queue: self.context_queue.clone(),
            context_index: self.context_idx,
            queue: self.queue.clone(),
            is_shuffle: self.shuffle,
            loop_mode: self.loop_mode,
            is_autoplay: self.is_autoplay,
            history: self.history.clone(),
            shuffle_indices: self.shuffled_indices.clone(),
            shuffle_pos: self.shuffle_pos,
        }
    }

    fn select_autoplay_candidate(&self, candidate_pool: &[Track]) -> Option<Track> {
        if candidate_pool.is_empty() {
            return self
                .current_track()
                .cloned()
                .or_else(|| self.queue.first().cloned());
        }

        // Exclude all tracks currently in queue (both context and user items)
        let queued_ids: HashSet<&str> = self.queue.iter().map(|t| t.id.as_str()).collect();
        let history_ids: HashSet<&str> = self.history.iter().map(|t| t.id.as_str()).collect();

        let mut unqueued: Vec<&Track> = candidate_pool
            .iter()
            .filter(|t| !queued_ids.contains(t.id.as_str()))
            .collect();

        // If entire library is queued, allow any track except current track
        if unqueued.is_empty() {
            let curr_id = self.current_track().map(|t| t.id.as_str()).unwrap_or("");
            unqueued = candidate_pool
                .iter()
                .filter(|t| t.id.as_str() != curr_id)
                .collect();
        }
        if unqueued.is_empty() {
            unqueued = candidate_pool.iter().collect();
        }

        if let Some(curr) = self.current_track() {
            let curr_artist = curr
                .metadata
                .artist
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_lowercase();
            let curr_album = curr
                .metadata
                .album
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_lowercase();
            let curr_genre = curr
                .metadata
                .genre
                .as_deref()
                .unwrap_or("")
                .trim()
                .to_lowercase();

            let scored: Vec<(&Track, i32)> = unqueued
                .iter()
                .map(|&t| {
                    let mut score = 0;
                    let cand_artist = t
                        .metadata
                        .artist
                        .as_deref()
                        .unwrap_or("")
                        .trim()
                        .to_lowercase();
                    let cand_album = t
                        .metadata
                        .album
                        .as_deref()
                        .unwrap_or("")
                        .trim()
                        .to_lowercase();
                    let cand_genre = t
                        .metadata
                        .genre
                        .as_deref()
                        .unwrap_or("")
                        .trim()
                        .to_lowercase();

                    // Same Artist: +50 points
                    if !curr_artist.is_empty()
                        && curr_artist != "unknown artist"
                        && cand_artist == curr_artist
                    {
                        score += 50;
                    }
                    // Same Album: +30 points
                    if !curr_album.is_empty()
                        && curr_album != "unknown album"
                        && cand_album == curr_album
                    {
                        score += 30;
                    }
                    // Same Genre: +20 points
                    if !curr_genre.is_empty()
                        && curr_genre != "unknown genre"
                        && cand_genre == curr_genre
                    {
                        score += 20;
                    }
                    // In History: -100 points
                    if history_ids.contains(t.id.as_str()) {
                        score -= 100;
                    }
                    (t, score)
                })
                .collect();

            if let Some(max_score) = scored.iter().map(|(_, s)| *s).max() {
                let top_tier: Vec<&Track> = scored
                    .into_iter()
                    .filter(|(_, s)| *s == max_score)
                    .map(|(t, _)| t)
                    .collect();
                if !top_tier.is_empty() {
                    let mut rng = thread_rng();
                    let chosen = top_tier[rng.gen_range(0..top_tier.len())];
                    return Some(chosen.clone());
                }
            }
        }

        // Fallback when current track is None or scoring produced no candidate
        let mut rng = thread_rng();
        let unplayed: Vec<&Track> = unqueued
            .iter()
            .filter(|t| !history_ids.contains(t.id.as_str()))
            .copied()
            .collect();
        let pool = if !unplayed.is_empty() {
            &unplayed
        } else {
            &unqueued
        };
        if pool.is_empty() {
            None
        } else {
            let chosen = pool[rng.gen_range(0..pool.len())];
            Some(chosen.clone())
        }
    }

    fn append_autoplay_track(&mut self, track: Track) {
        self.context_queue.push(track.clone());
        self.queue.push(track);
        let new_idx = self.queue.len() - 1;
        self.current_idx = Some(new_idx);
        self.context_idx = Some(self.context_queue.len() - 1);
        if self.shuffle {
            self.shuffled_indices.push(new_idx);
            self.shuffle_pos = self.shuffled_indices.len().saturating_sub(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use wavery_core::models::{TrackMetadata, TrackSource};

    fn make_test_track(id: &str, artist: &str, album: &str, genre: &str) -> Track {
        Track {
            id: id.to_string(),
            source: TrackSource::Managed(PathBuf::from(format!("/music/{id}.flac"))),
            metadata: TrackMetadata {
                title: Some(format!("Title {id}")),
                artist: Some(artist.to_string()),
                album: Some(album.to_string()),
                album_artist: None,
                track_number: Some(1),
                disc_number: Some(1),
                year: Some(2026),
                genre: Some(genre.to_string()),
                duration: Duration::from_secs(200),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                channels: Some(2),
                format: "FLAC".to_string(),
                lyrics: None,
                ..Default::default()
            },
            date_added: 1700000000,
        }
    }

    #[test]
    fn test_two_tier_context_idx_preservation_during_user_queue() {
        let mut q = StandardQueueManager::new();
        let c1 = make_test_track("c1", "Artist A", "Album 1", "Rock");
        let c2 = make_test_track("c2", "Artist A", "Album 1", "Rock");
        let c3 = make_test_track("c3", "Artist A", "Album 1", "Rock");
        let u1 = make_test_track("u1", "Artist B", "Album 2", "Pop");

        q.set_context_queue(vec![c1.clone(), c2.clone(), c3.clone()], 0);
        assert_eq!(q.current_index(), Some(0));
        assert_eq!(q.context_index(), Some(0));
        assert_eq!(q.current_track().map(|t| t.id.as_str()), Some("c1"));

        // User queues a track to play next
        q.play_next(u1);
        assert_eq!(q.user_queue().len(), 1);
        assert_eq!(q.context_index(), Some(0));

        // Advance to next: should play u1, context_index remains anchored at 0
        let next_track = q.next();
        assert_eq!(next_track.map(|t| t.id.as_str()), Some("u1"));
        assert_eq!(q.user_queue().len(), 0); // Consumed
        assert_eq!(q.context_index(), Some(0)); // Preserved!

        // Advance to next: should resume context queue at c2 (index 1)
        let next_track2 = q.next();
        assert_eq!(next_track2.map(|t| t.id.as_str()), Some("c2"));
        assert_eq!(q.context_index(), Some(1));
    }

    #[test]
    fn test_reorder_user_queue_preserves_interleaved_context() {
        let mut q = StandardQueueManager::new();
        let c1 = make_test_track("c1", "Artist A", "Album 1", "Rock");
        let c2 = make_test_track("c2", "Artist A", "Album 1", "Rock");
        let c3 = make_test_track("c3", "Artist A", "Album 1", "Rock");
        let u1 = make_test_track("u1", "Artist B", "Album 2", "Pop");
        let u2 = make_test_track("u2", "Artist C", "Album 3", "Jazz");

        q.set_context_queue(vec![c1, c2, c3], 0);
        q.push_back(u1);
        q.push_back(u2);

        assert_eq!(q.user_queue().len(), 2);
        assert_eq!(q.user_queue()[0].id, "u1");
        assert_eq!(q.user_queue()[1].id, "u2");

        // Unified queue should be [c1, c2, c3, u1, u2]
        assert_eq!(q.queue().len(), 5);
        assert_eq!(q.queue()[3].id, "u1");
        assert_eq!(q.queue()[4].id, "u2");

        // Reorder user queue (u1, u2 -> u2, u1)
        q.reorder_user_queue(0, 1);
        assert_eq!(q.user_queue()[0].id, "u2");
        assert_eq!(q.user_queue()[1].id, "u1");

        // Interleaved context items c2, c3 remain at index 1 and 2
        assert_eq!(q.queue()[1].id, "c2");
        assert_eq!(q.queue()[2].id, "c3");
        assert_eq!(q.queue()[3].id, "u2");
        assert_eq!(q.queue()[4].id, "u1");
    }

    #[test]
    fn test_autoplay_scoring_weights() {
        let mut q = StandardQueueManager::new();
        let curr = make_test_track("curr", "Daft Punk", "Discovery", "Electronic");
        let cand_artist = make_test_track("c_artist", "Daft Punk", "Homework", "House"); // +50
        let cand_album_genre = make_test_track("c_ag", "Various", "Discovery", "Electronic"); // +30 + 20 = 50
        let cand_perfect = make_test_track("c_perf", "Daft Punk", "Discovery", "Electronic"); // +50 + 30 + 20 = 100
        let cand_history = make_test_track("c_hist", "Daft Punk", "Discovery", "Electronic"); // 100 - 100 = 0

        q.set_queue(vec![curr.clone()], 0);
        // Put cand_history into history
        q.push_back(cand_history.clone());
        q.next(); // transitions to cand_history, curr enters history
        q.previous(Duration::from_secs(1)); // step back to curr, history has [curr]

        let pool = vec![
            cand_artist.clone(),
            cand_album_genre.clone(),
            cand_perfect.clone(),
            cand_history.clone(),
        ];

        // Should unambiguously select cand_perfect because it scores 100 (vs 50, 50, 0)
        let chosen = q.select_autoplay_candidate(&pool);
        assert_eq!(chosen.map(|t| t.id), Some("c_perf".to_string()));
    }

    #[test]
    fn test_autoplay_fallback_when_all_tracks_in_queue() {
        let mut q = StandardQueueManager::new();
        let t1 = make_test_track("t1", "Artist A", "Album 1", "Rock");
        let t2 = make_test_track("t2", "Artist B", "Album 2", "Pop");
        let t3 = make_test_track("t3", "Artist C", "Album 3", "Jazz");

        q.set_queue(vec![t1.clone(), t2.clone(), t3.clone()], 0);

        let pool = vec![t1.clone(), t2.clone(), t3.clone()];
        // All tracks are in queue; autoplay should pick a track other than current (t1)
        let chosen = q.select_autoplay_candidate(&pool);
        assert!(chosen.is_some());
        let chosen_id = chosen.unwrap().id;
        assert!(chosen_id == "t2" || chosen_id == "t3");
    }

    #[test]
    fn test_autoplay_empty_and_single_track_pool() {
        let mut q = StandardQueueManager::new();

        // Completely empty pool and empty queue -> None
        assert_eq!(q.select_autoplay_candidate(&[]), None);

        let t1 = make_test_track("t1", "Artist A", "Album 1", "Rock");
        q.set_queue(vec![t1.clone()], 0);

        // Empty pool with active track -> returns current track
        assert_eq!(
            q.select_autoplay_candidate(&[]).map(|t| t.id),
            Some("t1".to_string())
        );

        // Single track pool identical to current track -> returns that track as fallback
        assert_eq!(
            q.select_autoplay_candidate(std::slice::from_ref(&t1)).map(|t| t.id),
            Some("t1".to_string())
        );
    }

    #[test]
    fn test_previous_3s_threshold() {
        let mut q = StandardQueueManager::new();
        let t1 = make_test_track("t1", "Artist A", "Album 1", "Rock");
        let t2 = make_test_track("t2", "Artist A", "Album 1", "Rock");

        q.set_queue(vec![t1.clone(), t2.clone()], 0);
        q.next(); // transitions to t2, t1 in history
        assert_eq!(q.current_index(), Some(1));
        assert_eq!(q.history().len(), 1);

        // Position > 3s restarts current track (t2) without changing index or history
        let res = q.previous(Duration::from_secs(4));
        assert_eq!(res.map(|t| t.id.as_str()), Some("t2"));
        assert_eq!(q.current_index(), Some(1));
        assert_eq!(q.history().len(), 1);

        // Position <= 3s steps back to t1, pops history
        let res2 = q.previous(Duration::from_secs(1));
        assert_eq!(res2.map(|t| t.id.as_str()), Some("t1"));
        assert_eq!(q.current_index(), Some(0));
        assert_eq!(q.history().len(), 0);
    }

    #[test]
    fn test_jump_methods_and_snapshot() {
        let mut q = StandardQueueManager::new();
        let c1 = make_test_track("c1", "Artist A", "Album 1", "Rock");
        let c2 = make_test_track("c2", "Artist A", "Album 1", "Rock");
        let u1 = make_test_track("u1", "Artist B", "Album 2", "Pop");

        q.set_context_queue(vec![c1, c2], 0);
        q.push_back(u1);

        // Jump to user track
        let jumped_user = q.jump_to_user_track(0);
        assert_eq!(jumped_user.map(|t| t.id.as_str()), Some("u1"));
        assert_eq!(q.current_index(), Some(2));

        // Jump to context track 1
        let jumped_ctx = q.jump_to_context_track(1);
        assert_eq!(jumped_ctx.map(|t| t.id.as_str()), Some("c2"));
        assert_eq!(q.context_index(), Some(1));

        // Check snapshot
        let snap = q.get_state();
        assert_eq!(snap.context_index, Some(1));
        assert_eq!(snap.current_index, Some(1));
        assert_eq!(snap.queue.len(), 3);

        // Clear
        q.clear();
        assert_eq!(q.queue().len(), 0);
        assert_eq!(q.current_index(), None);
    }

    #[test]
    fn test_shuffle_snapshot_and_next_after_jump() {
        let mut q = StandardQueueManager::new();
        let tracks: Vec<Track> = (0..5)
            .map(|i| make_test_track(&format!("t{i}"), "Artist", "Album", "Genre"))
            .collect();
        q.set_context_queue(tracks, 0);
        q.set_shuffle(true);

        let snap = q.get_state();
        assert!(snap.is_shuffle);
        assert_eq!(snap.shuffle_indices.len(), 5);
        assert_eq!(snap.shuffle_pos, 0);
        assert_eq!(snap.shuffle_indices[0], 0);

        // Even if we jump directly to the track at the end of shuffle_indices,
        // remaining unplayed tracks are preserved and next() still advances.
        let last_shuffled_idx = *snap.shuffle_indices.last().unwrap();
        q.jump_to_index(last_shuffled_idx);
        let snap_after_jump = q.get_state();
        assert_eq!(snap_after_jump.shuffle_pos, 1);
        assert!(snap_after_jump.shuffle_pos < snap_after_jump.shuffle_indices.len() - 1);
        assert!(q.next().is_some());
    }
}
