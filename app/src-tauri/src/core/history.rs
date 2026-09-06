//! Session history of recent captures: a capped, newest-first list of
//! capture identifiers.

use std::collections::VecDeque;

/// A capture identifier: the on-disk path of a saved capture. Kept as a
/// string so the Editor can reopen the image directly (Task 9).
pub type CaptureId = String;

/// Capped, newest-first session history. The front of the deque is the most
/// recent capture; the oldest entries fall off once the history exceeds
/// `cap`.
pub struct CaptureHistory {
    store: VecDeque<CaptureId>,
    cap: usize,
}

impl CaptureHistory {
    pub fn new(cap: usize) -> Self {
        CaptureHistory {
            store: VecDeque::new(),
            cap,
        }
    }

    /// Record a capture; the newest entry sits at the front.
    pub fn push(&mut self, id: CaptureId) {
        self.store.push_front(id);
        while self.store.len() > self.cap {
            self.store.pop_back();
        }
    }

    /// The most recent captures, newest first.
    pub fn recent(&self) -> Vec<&CaptureId> {
        self.store.iter().collect()
    }

    /// The most recent capture id (the front of the deque).
    pub fn last(&self) -> Option<&CaptureId> {
        self.store.front()
    }

    /// Remove the first entry equal to `id`. Returns true if it was present.
    pub fn remove(&mut self, id: &str) -> bool {
        match self.store.iter().position(|e| e == id) {
            Some(pos) => {
                self.store.remove(pos);
                true
            }
            None => false,
        }
    }

    pub fn len(&self) -> usize {
        self.store.len()
    }

    pub fn is_empty(&self) -> bool {
        self.store.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_caps() {
        let mut h = CaptureHistory::new(3);
        for id in ["a", "b", "c", "d"] {
            h.push(id.to_string());
        }
        assert!(h.len() <= 3);
        assert_eq!(h.len(), 3);
        assert_eq!(h.last(), Some(&"d".to_string()));
    }

    #[test]
    fn history_recent_is_newest_first() {
        let mut h = CaptureHistory::new(5);
        for id in ["a", "b", "c"] {
            h.push(id.to_string());
        }
        let recent: Vec<&str> = h.recent().into_iter().map(|s| s.as_str()).collect();
        assert_eq!(recent, ["c", "b", "a"]);
    }

    #[test]
    fn history_empty_reporting() {
        let h = CaptureHistory::new(3);
        assert!(h.is_empty());
        assert_eq!(h.len(), 0);
        assert_eq!(h.last(), None);
    }

    #[test]
    fn history_remove_present_drops_entry_and_keeps_order() {
        let mut h = CaptureHistory::new(5);
        for id in ["a", "b", "c"] {
            h.push(id.to_string());
        }
        assert!(h.remove("b"));
        let recent: Vec<&str> = h.recent().into_iter().map(|s| s.as_str()).collect();
        assert_eq!(recent, ["c", "a"]);
        assert_eq!(h.len(), 2);
    }

    #[test]
    fn history_remove_absent_is_noop_false() {
        let mut h = CaptureHistory::new(5);
        for id in ["a", "b"] {
            h.push(id.to_string());
        }
        assert!(!h.remove("missing"));
        let recent: Vec<&str> = h.recent().into_iter().map(|s| s.as_str()).collect();
        assert_eq!(recent, ["b", "a"]);
        assert_eq!(h.len(), 2);
    }

    #[test]
    fn history_remove_only_element_empties() {
        let mut h = CaptureHistory::new(3);
        h.push("only".to_string());
        assert!(h.remove("only"));
        assert!(h.is_empty());
        assert_eq!(h.last(), None);
    }
}
