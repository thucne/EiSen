use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Lang {
    #[default]
    En,
    Vi,
}

/// Menu-bar tray copy. Kept next to `Lang` so native UI can localize without
/// pulling in the webview dictionaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MenuLabels {
    pub capture: &'static str,
    pub settings: &'static str,
    pub history: &'static str,
    pub quit: &'static str,
}

impl Lang {
    pub fn menu_labels(self) -> MenuLabels {
        match self {
            Lang::En => MenuLabels {
                capture: "Capture now",
                settings: "Settings…",
                history: "History",
                quit: "Quit",
            },
            Lang::Vi => MenuLabels {
                capture: "Chụp ngay",
                settings: "Cài đặt…",
                history: "Lịch sử",
                quit: "Thoát",
            },
        }
    }

    pub fn editor_title(self) -> &'static str {
        match self {
            Lang::En => "EiSen Editor",
            Lang::Vi => "EiSen Trình sửa",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum HotkeyPreset {
    #[cfg_attr(target_os = "macos", default)]
    DoubleOption,
    DoubleShift,
    CmdShift4Mac,
    CtrlShift4Mac,
    PrtScMac,
    #[cfg_attr(not(target_os = "macos"), default)]
    PrtScnWin,
}

impl HotkeyPreset {
    pub fn default_mac() -> Self {
        HotkeyPreset::DoubleOption
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub lang: Lang,
    pub save_dir: PathBuf,
    pub launch_at_login: bool,
    pub hotkey: HotkeyPreset,
}

impl Default for AppConfig {
    fn default() -> Self {
        let save_dir = std::env::var_os("HOME")
            .map(PathBuf::from)
            .map(|h| h.join("Desktop"))
            .filter(|p| p.is_dir())
            .unwrap_or_else(std::env::temp_dir);
        apply_env_overrides(
            AppConfig {
                lang: Lang::default(),
                save_dir,
                launch_at_login: false,
                hotkey: HotkeyPreset::default(),
            },
            &|k| std::env::var(k).ok(),
        )
    }
}

/// Parses a hotkey preset name exactly as serialized ("DoubleOption", ...).
fn parse_hotkey_preset(s: &str) -> Option<HotkeyPreset> {
    match s.trim() {
        "DoubleOption" => Some(HotkeyPreset::DoubleOption),
        "DoubleShift" => Some(HotkeyPreset::DoubleShift),
        "CmdShift4Mac" => Some(HotkeyPreset::CmdShift4Mac),
        "CtrlShift4Mac" => Some(HotkeyPreset::CtrlShift4Mac),
        "PrtScMac" => Some(HotkeyPreset::PrtScMac),
        "PrtScnWin" => Some(HotkeyPreset::PrtScnWin),
        _ => None,
    }
}

/// Applies EISEN_* environment overrides to a freshly-defaulted config.
/// Injection-based so tests never mutate process-global state.
fn apply_env_overrides(mut cfg: AppConfig, getenv: &dyn Fn(&str) -> Option<String>) -> AppConfig {
    if let Some(dir) = getenv("EISEN_SAVE_DIR").filter(|s| !s.trim().is_empty()) {
        cfg.save_dir = PathBuf::from(dir.trim());
    }
    if let Some(lang) = getenv("EISEN_DEFAULT_LANG").as_deref().map(str::trim) {
        match lang {
            "En" | "en" => cfg.lang = Lang::En,
            "Vi" | "vi" => cfg.lang = Lang::Vi,
            _ => {}
        }
    }
    if let Some(preset) = getenv("EISEN_HOTKEY_PRESET")
        .as_deref()
        .and_then(parse_hotkey_preset)
    {
        cfg.hotkey = preset;
    }
    cfg
}

/// Loads config from `path`; missing or corrupt files fall back to defaults.
pub fn load(path: &Path) -> AppConfig {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Persists `cfg` as pretty JSON; `Ok(())` on success.
pub fn save(path: &Path, cfg: &AppConfig) -> std::io::Result<()> {
    let json = serde_json::to_string_pretty(cfg).map_err(std::io::Error::other)?;
    std::fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_corrupt_json_returns_defaults() {
        let p = std::env::temp_dir().join("eisen-bad.json");
        std::fs::write(&p, b"not json").unwrap();
        let cfg = load(&p);
        assert_eq!(cfg.hotkey, HotkeyPreset::default());
    }

    #[test]
    fn config_load_missing_returns_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = load(&dir.path().join("missing.json"));
        assert_eq!(cfg, AppConfig::default());
    }

    #[test]
    fn config_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("cfg.json");
        let want = AppConfig {
            lang: Lang::Vi,
            save_dir: dir.path().join("shots"),
            launch_at_login: true,
            hotkey: HotkeyPreset::PrtScMac, // roundtrip test uses PrtScMac
        };
        save(&p, &want).unwrap();
        assert_eq!(load(&p), want);
    }

    #[test]
    fn parse_hotkey_preset_accepts_all_serialized_names() {
        let cases = [
            ("DoubleOption", HotkeyPreset::DoubleOption),
            ("DoubleShift", HotkeyPreset::DoubleShift),
            ("CmdShift4Mac", HotkeyPreset::CmdShift4Mac),
            ("CtrlShift4Mac", HotkeyPreset::CtrlShift4Mac),
            ("PrtScMac", HotkeyPreset::PrtScMac),
            ("PrtScnWin", HotkeyPreset::PrtScnWin),
        ];
        for (name, want) in cases {
            assert_eq!(parse_hotkey_preset(name), Some(want));
        }
        assert_eq!(parse_hotkey_preset("Bogus"), None);
        assert_eq!(parse_hotkey_preset(""), None);
    }

    #[test]
    fn env_overrides_apply_all_three_vars() {
        let getenv = |k: &str| match k {
            "EISEN_SAVE_DIR" => Some("  /tmp/eisen shots  ".to_string()),
            "EISEN_DEFAULT_LANG" => Some("Vi".to_string()),
            "EISEN_HOTKEY_PRESET" => Some("CtrlShift4Mac".to_string()),
            _ => None,
        };
        let cfg = apply_env_overrides(AppConfig::default(), &getenv);
        assert_eq!(cfg.save_dir, PathBuf::from("/tmp/eisen shots"));
        assert_eq!(cfg.lang, Lang::Vi);
        assert_eq!(cfg.hotkey, HotkeyPreset::CtrlShift4Mac);
    }

    #[test]
    fn env_overrides_reject_invalid_values() {
        let base = AppConfig {
            lang: Lang::En,
            save_dir: PathBuf::from("/keep"),
            launch_at_login: false,
            hotkey: HotkeyPreset::PrtScMac,
        };
        let getenv = |k: &str| match k {
            "EISEN_DEFAULT_LANG" => Some("Fr".to_string()),
            "EISEN_HOTKEY_PRESET" => Some("Bogus".to_string()),
            _ => None,
        };
        let cfg = apply_env_overrides(base.clone(), &getenv);
        assert_eq!(cfg.lang, Lang::En);
        assert_eq!(cfg.hotkey, HotkeyPreset::PrtScMac);
        assert_eq!(cfg.save_dir, PathBuf::from("/keep"));
    }

    #[test]
    fn env_override_blank_save_dir_is_ignored() {
        let base = AppConfig {
            lang: Lang::En,
            save_dir: PathBuf::from("/keep"),
            launch_at_login: false,
            hotkey: HotkeyPreset::DoubleOption,
        };
        let getenv = |k: &str| match k {
            "EISEN_SAVE_DIR" => Some("   ".to_string()),
            _ => None,
        };
        let cfg = apply_env_overrides(base, &getenv);
        assert_eq!(cfg.save_dir, PathBuf::from("/keep"));
    }

    #[test]
    fn native_copy_follows_lang() {
        let en = Lang::En.menu_labels();
        assert_eq!(en.capture, "Capture now");
        assert_eq!(en.settings, "Settings…");
        assert_eq!(en.history, "History");
        assert_eq!(en.quit, "Quit");
        assert_eq!(Lang::En.editor_title(), "EiSen Editor");

        let vi = Lang::Vi.menu_labels();
        assert_eq!(vi.capture, "Chụp ngay");
        assert_eq!(vi.settings, "Cài đặt…");
        assert_eq!(vi.history, "Lịch sử");
        assert_eq!(vi.quit, "Thoát");
        assert_eq!(Lang::Vi.editor_title(), "EiSen Trình sửa");
    }

    #[test]
    fn env_overrides_without_env_vars_leave_config_untouched() {
        let base = AppConfig {
            lang: Lang::Vi,
            save_dir: PathBuf::from("/unchanged"),
            launch_at_login: true,
            hotkey: HotkeyPreset::DoubleShift,
        };
        let cfg = apply_env_overrides(base.clone(), &|_| None);
        assert_eq!(cfg, base);
    }
}
