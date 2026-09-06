//! Global capture hotkeys, registered via `tauri-plugin-global-shortcut` and native double-tap monitors.

use crate::core::capture;
use crate::domain::config::HotkeyPreset;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Register global hotkeys / modifier monitors:
///   • `ctrl+shift+3`   → full-screen capture + auto-save (macOS)
///   • preset shortcut  → crop / selection overlay (Double-Tap or Combo)
pub fn register(app: &AppHandle, preset: &HotkeyPreset) -> Result<(), String> {
    // ── Ctrl+Shift+3: full-screen capture (macOS only) ───────────────────────
    #[cfg(target_os = "macos")]
    {
        let result = app.global_shortcut().on_shortcut(
            "ctrl+shift+3",
            |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    eprintln!("[eisen] ctrl+shift+3 fired — starting fullscreen capture");
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = capture::begin_fullscreen_capture(&app) {
                            eprintln!("[eisen] fullscreen capture failed: {e}");
                        }
                    });
                }
            },
        );
        // Secondary / undocumented; a failure here must not fail crop
        // registration or trigger a spurious settings rollback.
        if let Err(e) = result {
            eprintln!("[eisen] ctrl+shift+3 registration failed: {e}");
        }
    }

    // ── Crop mode shortcut (configurable preset) ──────────────────────────────
    // Double-tap presets register only their plugin shortcuts here; the NSEvent
    // gesture-monitor lifecycle is owned by mac_adapter::apply_monitor_action
    // driven from lib.rs (setup + save_config).
    match preset {
        #[cfg(target_os = "macos")]
        HotkeyPreset::DoubleOption => {
            eprintln!("[eisen] Double Option (⌥⌥) modifier monitor active");
            Ok(())
        }
        #[cfg(target_os = "macos")]
        HotkeyPreset::DoubleShift => {
            eprintln!("[eisen] Double Shift (⇧⇧) modifier monitor active");
            Ok(())
        }
        #[cfg(not(target_os = "macos"))]
        HotkeyPreset::DoubleOption | HotkeyPreset::DoubleShift => {
            let crop = "printscreen";
            let result = app.global_shortcut().on_shortcut(crop, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = capture::begin_capture(&app) {
                            eprintln!("[eisen] hotkey capture failed: {e}");
                        }
                    });
                }
            });
            result.map_err(|e| format!("failed to register hotkey {crop}: {e}"))
        }
        HotkeyPreset::CmdShift4Mac => {
            let crop = "cmd+shift+4";
            let result = app.global_shortcut().on_shortcut(crop, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = capture::begin_capture(&app) {
                            eprintln!("[eisen] hotkey capture failed: {e}");
                        }
                    });
                }
            });
            result.map_err(|e| format!("failed to register hotkey {crop}: {e}"))
        }
        HotkeyPreset::CtrlShift4Mac => {
            let crop = "ctrl+shift+4";
            let result = app.global_shortcut().on_shortcut(crop, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = capture::begin_capture(&app) {
                            eprintln!("[eisen] hotkey capture failed: {e}");
                        }
                    });
                }
            });
            result.map_err(|e| format!("failed to register hotkey {crop}: {e}"))
        }
        HotkeyPreset::PrtScMac | HotkeyPreset::PrtScnWin => {
            let crop = "printscreen";
            let result = app.global_shortcut().on_shortcut(crop, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = capture::begin_capture(&app) {
                            eprintln!("[eisen] hotkey capture failed: {e}");
                        }
                    });
                }
            });
            result.map_err(|e| format!("failed to register hotkey {crop}: {e}"))
        }
    }
}

/// What should happen to the NSEvent gesture monitors when the preset changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MonitorAction {
    /// No gesture monitor installed yet; install `kind`.
    Add(crate::core::double_tap::ModifierKind),
    /// A gesture monitor is installed; install `kind`, then retire the old one.
    Replace(crate::core::double_tap::ModifierKind),
    /// Target preset is a combo shortcut; remove every monitor.
    RemoveAll,
}

/// Which ModifierKind a preset's gesture monitor uses, if any.
pub(crate) fn preset_monitor_kind(preset: &HotkeyPreset) -> Option<crate::core::double_tap::ModifierKind> {
    match preset {
        HotkeyPreset::DoubleOption => Some(crate::core::double_tap::ModifierKind::OptionKey),
        HotkeyPreset::DoubleShift => Some(crate::core::double_tap::ModifierKind::ShiftKey),
        _ => None,
    }
}

/// What `save_config` must do after attempting to register `new`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SaveOutcome {
    /// Preset unchanged: persist, touch no shortcuts.
    PersistOnly,
    /// Registration succeeded: apply monitors, then persist.
    Commit,
    /// Registration failed: restore `old`, persist nothing.
    Rollback,
}

/// Pure — decides the transaction outcome from the preset delta and whether
/// the plugin accepted the new shortcut.
pub fn save_outcome(old: &HotkeyPreset, new: &HotkeyPreset, registered: bool) -> SaveOutcome {
    if old == new {
        SaveOutcome::PersistOnly
    } else if registered {
        SaveOutcome::Commit
    } else {
        SaveOutcome::Rollback
    }
}

/// Decide what should happen to NSEvent gesture monitors when the hotkey
/// preset moves from `old` to `new`. Pure — unit-testable; the ObjC side is not.
pub fn desired_monitors(old: &HotkeyPreset, new: &HotkeyPreset) -> MonitorAction {
    match (preset_monitor_kind(old), preset_monitor_kind(new)) {
        (None, Some(kind)) => MonitorAction::Add(kind),
        (Some(_), Some(kind)) => MonitorAction::Replace(kind),
        (_, None) => MonitorAction::RemoveAll,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::double_tap::ModifierKind;

    #[test]
    fn double_option_to_double_shift_replaces() {
        assert_eq!(
            desired_monitors(&HotkeyPreset::DoubleOption, &HotkeyPreset::DoubleShift),
            MonitorAction::Replace(ModifierKind::ShiftKey)
        );
    }

    #[test]
    fn combo_to_double_option_adds() {
        assert_eq!(
            desired_monitors(&HotkeyPreset::CmdShift4Mac, &HotkeyPreset::DoubleOption),
            MonitorAction::Add(ModifierKind::OptionKey)
        );
    }

    #[test]
    fn double_shift_to_combo_removes_all() {
        assert_eq!(
            desired_monitors(&HotkeyPreset::DoubleShift, &HotkeyPreset::CmdShift4Mac),
            MonitorAction::RemoveAll
        );
    }

    #[test]
    fn printscreen_combo_to_combo_removes_all() {
        assert_eq!(
            desired_monitors(&HotkeyPreset::PrtScMac, &HotkeyPreset::CtrlShift4Mac),
            MonitorAction::RemoveAll
        );
    }

    #[test]
    fn same_double_tap_preset_still_replaces() {
        assert_eq!(
            desired_monitors(&HotkeyPreset::DoubleOption, &HotkeyPreset::DoubleOption),
            MonitorAction::Replace(ModifierKind::OptionKey)
        );
    }

    #[test]
    fn save_outcome_unchanged_is_persist_only_even_when_unregistered() {
        assert_eq!(
            save_outcome(
                &HotkeyPreset::DoubleOption,
                &HotkeyPreset::DoubleOption,
                false
            ),
            SaveOutcome::PersistOnly
        );
    }

    #[test]
    fn save_outcome_changed_and_registered_is_commit() {
        assert_eq!(
            save_outcome(
                &HotkeyPreset::DoubleOption,
                &HotkeyPreset::CmdShift4Mac,
                true
            ),
            SaveOutcome::Commit
        );
    }

    #[test]
    fn save_outcome_changed_and_unregistered_is_rollback() {
        assert_eq!(
            save_outcome(
                &HotkeyPreset::DoubleOption,
                &HotkeyPreset::CmdShift4Mac,
                false
            ),
            SaveOutcome::Rollback
        );
    }
}
