//! Global capture hotkeys, registered via `tauri-plugin-global-shortcut` and native double-tap monitors.

use crate::core::capture;
use crate::domain::config::HotkeyPreset;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Registration {
    pub active: HotkeyPreset,
    pub fallback_from: Option<HotkeyPreset>,
}

#[cfg(any(target_os = "windows", test))]
const WINDOWS_PRINTSCREEN_CANDIDATES: &[(&str, HotkeyPreset)] = &[
    ("printscreen", HotkeyPreset::PrtScnWin),
    ("ctrl+shift+5", HotkeyPreset::CtrlShift5Win),
];
#[cfg(any(target_os = "windows", test))]
const WINDOWS_FALLBACK_CANDIDATES: &[(&str, HotkeyPreset)] =
    &[("ctrl+shift+5", HotkeyPreset::CtrlShift5Win)];

/// Try the requested Windows shortcut and, when PrintScreen is already owned
/// by another application, fall back to a deterministic shortcut that still
/// leaves capture usable on a fresh install.
#[cfg(any(target_os = "windows", test))]
fn register_capture_with_fallback<F>(
    requested: HotkeyPreset,
    mut register: F,
) -> Result<Registration, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let candidates = match requested {
        HotkeyPreset::PrtScnWin => WINDOWS_PRINTSCREEN_CANDIDATES,
        HotkeyPreset::CtrlShift5Win => WINDOWS_FALLBACK_CANDIDATES,
        _ => return Err(format!("unsupported Windows capture preset: {requested:?}")),
    };
    let mut failures = Vec::new();
    for (shortcut, active) in candidates {
        match register(shortcut) {
            Ok(()) => {
                return Ok(Registration {
                    active: *active,
                    fallback_from: (*active != requested).then_some(requested),
                });
            }
            Err(error) => failures.push(format!("{shortcut}: {error}")),
        }
    }
    Err(format!(
        "all Windows capture shortcuts failed ({})",
        failures.join("; ")
    ))
}

fn register_capture_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    let result = app.global_shortcut().on_shortcut(shortcut, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = capture::begin_capture(&app) {
                    eprintln!("[eisen] hotkey capture failed: {e}");
                }
            });
        }
    });
    result.map_err(|e| format!("failed to register hotkey {shortcut}: {e}"))
}

/// Register global hotkeys / modifier monitors:
///   • `ctrl+shift+3`   → full-screen capture + auto-save (macOS)
///   • preset shortcut  → crop / selection overlay (Double-Tap or Combo)
pub fn register(app: &AppHandle, preset: &HotkeyPreset) -> Result<Registration, String> {
    // Normalize persisted or renderer-supplied legacy presets at this runtime
    // boundary as well, so startup cannot register a macOS-only combination
    // before Settings has a chance to migrate the config on disk.
    let preset = effective_preset(*preset);

    #[cfg(target_os = "windows")]
    if matches!(preset, HotkeyPreset::PrtScnWin | HotkeyPreset::CtrlShift5Win) {
        return register_capture_with_fallback(preset, |shortcut| {
            register_capture_shortcut(app, shortcut)
        });
    }

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
    match &preset {
        #[cfg(target_os = "macos")]
        HotkeyPreset::DoubleOption => {
            eprintln!("[eisen] Double Option (⌥⌥) modifier monitor active");
            Ok(Registration {
                active: preset,
                fallback_from: None,
            })
        }
        #[cfg(target_os = "macos")]
        HotkeyPreset::DoubleShift => {
            eprintln!("[eisen] Double Shift (⇧⇧) modifier monitor active");
            Ok(Registration {
                active: preset,
                fallback_from: None,
            })
        }
        #[cfg(not(target_os = "macos"))]
        HotkeyPreset::DoubleOption | HotkeyPreset::DoubleShift => {
            let crop = "printscreen";
            register_capture_shortcut(app, crop).map(|()| Registration {
                active: preset,
                fallback_from: None,
            })
        }
        HotkeyPreset::CmdShift4Mac => {
            let crop = "cmd+shift+4";
            register_capture_shortcut(app, crop).map(|()| Registration {
                active: preset,
                fallback_from: None,
            })
        }
        HotkeyPreset::CtrlShift4Mac => {
            let crop = "ctrl+shift+4";
            register_capture_shortcut(app, crop).map(|()| Registration {
                active: preset,
                fallback_from: None,
            })
        }
        HotkeyPreset::PrtScMac | HotkeyPreset::PrtScnWin => {
            let crop = "printscreen";
            register_capture_shortcut(app, crop).map(|()| Registration {
                active: preset,
                fallback_from: None,
            })
        }
        HotkeyPreset::CtrlShift5Win => {
            let crop = "ctrl+shift+5";
            register_capture_shortcut(app, crop).map(|()| Registration {
                active: preset,
                fallback_from: None,
            })
        }
    }
}

fn effective_preset(preset: HotkeyPreset) -> HotkeyPreset {
    #[cfg(target_os = "windows")]
    {
        match preset {
            HotkeyPreset::CtrlShift5Win => HotkeyPreset::CtrlShift5Win,
            _ => HotkeyPreset::PrtScnWin,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        preset
    }
}

pub fn registration_warning(registration: Registration) -> Option<String> {
    match registration.fallback_from {
        Some(HotkeyPreset::PrtScnWin) => Some(
            "PrintScreen is already in use by another application. EiSen switched to Ctrl + Shift + 5 for capture.".to_string(),
        ),
        _ => None,
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
    #[cfg(target_os = "windows")]
    fn windows_runtime_normalizes_legacy_presets_to_printscreen_but_keeps_fallback() {
        let presets = [
            HotkeyPreset::DoubleOption,
            HotkeyPreset::DoubleShift,
            HotkeyPreset::CmdShift4Mac,
            HotkeyPreset::CtrlShift4Mac,
            HotkeyPreset::PrtScMac,
            HotkeyPreset::PrtScnWin,
        ];
        for preset in presets {
            assert_eq!(effective_preset(preset), HotkeyPreset::PrtScnWin);
        }
        assert_eq!(effective_preset(HotkeyPreset::CtrlShift5Win), HotkeyPreset::CtrlShift5Win);
    }

    #[test]
    fn printscreen_conflict_uses_the_capture_fallback() {
        let mut attempted = Vec::new();
        let registration = register_capture_with_fallback(HotkeyPreset::PrtScnWin, |shortcut| {
            attempted.push(shortcut.to_string());
            if shortcut == "printscreen" {
                Err("HotKey already registered".to_string())
            } else {
                Ok(())
            }
        })
        .expect("fallback shortcut should register");

        assert_eq!(attempted, ["printscreen", "ctrl+shift+5"]);
        assert_eq!(registration.active, HotkeyPreset::CtrlShift5Win);
        assert_eq!(registration.fallback_from, Some(HotkeyPreset::PrtScnWin));
    }

    #[test]
    fn fallback_failure_keeps_both_registration_errors() {
        let error = register_capture_with_fallback(HotkeyPreset::PrtScnWin, |shortcut| {
            Err(format!("{shortcut} is taken"))
        })
        .expect_err("both occupied shortcuts should fail");

        assert!(error.contains("printscreen: printscreen is taken"));
        assert!(error.contains("ctrl+shift+5: ctrl+shift+5 is taken"));
    }

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
