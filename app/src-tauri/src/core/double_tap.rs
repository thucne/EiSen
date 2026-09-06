use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModifierKind {
    OptionKey,
    ShiftKey,
    ControlKey,
    CommandKey,
}

/// A lightweight, robust state machine to detect clean double-tap modifier gestures.
///
/// Ensures zero accidental triggers while typing by isolating pure modifier presses
/// and strictly enforcing time windows (min 40ms debounce, max 350ms gap).
pub struct ModifierStateMachine {
    target: ModifierKind,
    tap_count: u32,
    last_press: Option<Instant>,
    last_release: Option<Instant>,
    min_gap: Duration,
    max_gap: Duration,
}

impl ModifierStateMachine {
    pub fn new(target: ModifierKind) -> Self {
        Self {
            target,
            tap_count: 0,
            last_press: None,
            last_release: None,
            min_gap: Duration::from_millis(40),
            max_gap: Duration::from_millis(350),
        }
    }

    /// Update target modifier (e.g. when changing settings between Option and Shift).
    pub fn set_target(&mut self, target: ModifierKind) {
        self.target = target;
        self.reset();
    }

    /// Reset state machine (e.g. when typing or focus changes).
    pub fn reset(&mut self) {
        self.tap_count = 0;
        self.last_press = None;
        self.last_release = None;
    }

    /// Invoked whenever any non-modifier key is pressed.
    /// Immediately resets the gesture state so typing words never causes a false capture.
    pub fn on_other_key_down(&mut self) {
        self.reset();
    }

    /// Invoked on modifier flag change events.
    /// Returns `true` if a complete, clean double-tap gesture was detected.
    pub fn on_modifier_event(&mut self, modifier: ModifierKind, pressed: bool, now: Instant) -> bool {
        if modifier != self.target {
            // A different modifier was pressed (e.g. Cmd+Option combo) — cancel gesture
            self.reset();
            return false;
        }

        if pressed {
            if self.tap_count == 0 {
                self.tap_count = 1;
                self.last_press = Some(now);
                false
            } else if self.tap_count == 1 {
                if let Some(release_time) = self.last_release {
                    let gap = now.saturating_duration_since(release_time);
                    if gap >= self.min_gap && gap <= self.max_gap {
                        // Successful double-tap!
                        self.reset();
                        true
                    } else {
                        // Too slow (>350ms) or bounce (<40ms) — start fresh with tap 1
                        self.tap_count = 1;
                        self.last_press = Some(now);
                        self.last_release = None;
                        false
                    }
                } else {
                    // Holding without release
                    false
                }
            } else {
                self.reset();
                false
            }
        } else {
            // Key released
            if self.tap_count == 1 {
                if let Some(press_time) = self.last_press {
                    let hold_duration = now.saturating_duration_since(press_time);
                    if hold_duration > Duration::from_millis(200) {
                        // User held the key down (e.g. for Option-drag / combo). Not a quick tap.
                        self.reset();
                        return false;
                    }
                }
                self.last_release = Some(now);
            }
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_double_tap_triggers() {
        let mut sm = ModifierStateMachine::new(ModifierKind::OptionKey);
        let t0 = Instant::now();

        // 1st press
        assert!(!sm.on_modifier_event(ModifierKind::OptionKey, true, t0));
        // 1st release after 50ms
        let t1 = t0 + Duration::from_millis(50);
        assert!(!sm.on_modifier_event(ModifierKind::OptionKey, false, t1));

        // 2nd press after 120ms gap (total 170ms)
        let t2 = t1 + Duration::from_millis(120);
        assert!(sm.on_modifier_event(ModifierKind::OptionKey, true, t2));
    }

    #[test]
    fn slow_double_tap_does_not_trigger() {
        let mut sm = ModifierStateMachine::new(ModifierKind::OptionKey);
        let t0 = Instant::now();

        // 1st press & release
        sm.on_modifier_event(ModifierKind::OptionKey, true, t0);
        let t1 = t0 + Duration::from_millis(50);
        sm.on_modifier_event(ModifierKind::OptionKey, false, t1);

        // 2nd press after 500ms (too slow)
        let t2 = t1 + Duration::from_millis(500);
        assert!(!sm.on_modifier_event(ModifierKind::OptionKey, true, t2));
    }

    #[test]
    fn typing_between_taps_cancels_trigger() {
        let mut sm = ModifierStateMachine::new(ModifierKind::OptionKey);
        let t0 = Instant::now();

        // 1st press & release
        sm.on_modifier_event(ModifierKind::OptionKey, true, t0);
        let t1 = t0 + Duration::from_millis(50);
        sm.on_modifier_event(ModifierKind::OptionKey, false, t1);

        // User types an 'A' key
        sm.on_other_key_down();

        // 2nd press within timing window
        let t2 = t1 + Duration::from_millis(100);
        assert!(!sm.on_modifier_event(ModifierKind::OptionKey, true, t2));
    }

    #[test]
    fn different_modifier_cancels_state() {
        let mut sm = ModifierStateMachine::new(ModifierKind::OptionKey);
        let t0 = Instant::now();

        // 1st Option press
        sm.on_modifier_event(ModifierKind::OptionKey, true, t0);
        // Shift press
        let t1 = t0 + Duration::from_millis(50);
        assert!(!sm.on_modifier_event(ModifierKind::ShiftKey, true, t1));
    }

    #[test]
    fn long_hold_is_not_treated_as_quick_tap() {
        let mut sm = ModifierStateMachine::new(ModifierKind::OptionKey);
        let t0 = Instant::now();

        // 1st press
        sm.on_modifier_event(ModifierKind::OptionKey, true, t0);
        // Held for 300ms (e.g. Option-drag)
        let t1 = t0 + Duration::from_millis(300);
        sm.on_modifier_event(ModifierKind::OptionKey, false, t1);

        // 2nd press within 100ms
        let t2 = t1 + Duration::from_millis(100);
        assert!(!sm.on_modifier_event(ModifierKind::OptionKey, true, t2));
    }
}
