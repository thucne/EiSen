pub mod core;
pub mod domain;
pub mod platform;

use crate::core::capture::{self, CaptureOrchestrator, CaptureSession};
use crate::core::history::CaptureHistory;
use crate::core::output::{self, SaveResult};
use crate::core::sound::{self, SoundEffect};
use crate::core::{hotkey, tray};
use crate::domain::config::{self, AppConfig, Lang};
use crate::domain::naming;
use crate::domain::region::LogicalRect;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Begin a capture session: captures the whole active display to a temp PNG,
/// shows the overlay window and emits `capture-ready` with the image path.
/// The hotkey and the tray's "Capture now" item use the same path.
#[tauri::command]
async fn cmd_begin_capture(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || capture::begin_capture(&app))
        .await
        .map_err(|e| format!("capture task failed: {e}"))?
}

/// Capture the selected region and return the resulting capture session.
#[tauri::command]
async fn cmd_commit_region(
    app: tauri::AppHandle,
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
    rect: LogicalRect,
    open_editor: Option<bool>,
) -> Result<CaptureSession, String> {
    // Hide the overlay synchronously BEFORE the compute: the user must get
    // immediate visual feedback that the selection was accepted.
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    let orch = Arc::clone(orchestrator.inner());
    let orch_for_ui = Arc::clone(&orch);
    // Only the decode/crop/encode is offloaded; UI follow-ups stay after the
    // await so error-path re-show and editor show keep their order.
    let finished = tauri::async_runtime::spawn_blocking(move || orch.finish(rect))
        .await
        .map_err(|e| format!("commit task failed: {e}"));
    match finished.and_then(|r| r.map_err(|e| e.to_string())) {
        Ok(session) => {
            if open_editor.unwrap_or(false) {
                sound::play(SoundEffect::Shutter, app_config(&app).play_sounds);
                show_editor(&app, &orch_for_ui).map_err(|e| e.to_string())?;
            } else {
                resign_overlay_activation(&app);
            }
            Ok(session)
        }
        Err(e) => {
            if let Some(overlay) = app.get_webview_window("overlay") {
                let _ = overlay.show();
            }
            Err(e)
        }
    }
}

/// Abort the in-progress capture and hide the overlay.
#[tauri::command]
fn cmd_cancel_capture(
    app: tauri::AppHandle,
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
) -> Result<(), String> {
    orchestrator.cancel();
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    resign_overlay_activation(&app);
    Ok(())
}

/// After overlay hide, drop Accessory key-window status so the previous app
/// is active again. Double-tap Option is a global NSEvent monitor and would
/// otherwise stay deaf until the user clicked another app.
fn resign_overlay_activation(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        let _ = app.run_on_main_thread(move || {
            crate::platform::mac_adapter::deactivate_app();
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

/// The app config, loaded from the app config dir; missing/corrupt -> defaults.
fn app_config(app: &tauri::AppHandle) -> AppConfig {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("config.json"))
        .map(|path| config::load(&path))
        .unwrap_or_default()
}

/// Read the app config (missing/corrupt -> defaults).
#[tauri::command]
fn cmd_get_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    Ok(app_config(&app))
}

/// Pure assembly of the shared path-validator allowlist: save_dir + session-
/// history entries ([`crate::domain::path_guard::session_temp_dir`] is ALWAYS
/// implicit inside [`crate::domain::path_guard::ensure_allowed`]). Kept pure so tests can
/// pin the exact root shape every path-taking command enforces.
fn validator_roots(save_dir: std::path::PathBuf, history: Vec<String>) -> Vec<std::path::PathBuf> {
    let mut roots = vec![save_dir];
    roots.extend(history.into_iter().map(std::path::PathBuf::from));
    roots
}

/// Gather the shared allowlist roots for renderer-supplied paths from app
/// state. Single source of truth for every command that accepts a path
/// (cmd_open_in_editor, cmd_get_thumbnail, cmd_copy_path), so new commands
/// cannot drift from the settled plan-025 root list.
fn build_validator_roots(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let history = app
        .state::<Arc<Mutex<CaptureHistory>>>()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .recent()
        .into_iter()
        .cloned()
        .collect();
    validator_roots(app_config(app).save_dir, history)
}

/// Persist `cfg`. If the capture hotkey preset changed, re-register first and
/// write config only on success so disk and live shortcuts cannot disagree.
fn save_config(app: &tauri::AppHandle, cfg: &AppConfig) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("config.json");
    let old = config::load(&path);

    if matches!(
        hotkey::save_outcome(&old.hotkey, &cfg.hotkey, false),
        hotkey::SaveOutcome::PersistOnly
    ) {
        persist_config(app, &path, cfg)?;
        return Ok(());
    }

    // Decide the monitor transition up front; apply it only if the
    // re-register below succeeds (a failed re-register must not mutate
    // monitors).
    #[cfg(target_os = "macos")]
    let action = hotkey::desired_monitors(&old.hotkey, &cfg.hotkey);

    // tauri-plugin-global-shortcut has no "try register without disturbing
    // existing" primitive, and some presets share the `printscreen` binding,
    // so register-before-unregister can hit "already registered". Unlike
    // apply_monitor_action (install the new monitor, then retire the old),
    // the safe shape here is unregister → register → on failure, re-register
    // the previous preset.
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| format!("failed to unregister hotkeys: {e}"))?;
    let register_err = hotkey::register(app, &cfg.hotkey).err();
    match hotkey::save_outcome(&old.hotkey, &cfg.hotkey, register_err.is_none()) {
        hotkey::SaveOutcome::PersistOnly => persist_config(app, &path, cfg),
        hotkey::SaveOutcome::Commit => {
            #[cfg(target_os = "macos")]
            {
                let registry = app.state::<Arc<Mutex<platform::mac_adapter::MonitorRegistry>>>();
                platform::mac_adapter::apply_monitor_action(app, &registry, action);
            }
            persist_config(app, &path, cfg)
        }
        hotkey::SaveOutcome::Rollback => {
            let e = register_err.unwrap_or_else(|| "unknown error".into());
            let restored = app
                .global_shortcut()
                .unregister_all()
                .map_err(|e2| format!("failed to unregister hotkeys: {e2}"))
                .and_then(|_| hotkey::register(app, &old.hotkey));
            match restored {
                Ok(()) => Err(format!(
                    "hotkey re-register failed: {e}; restored previous shortcut"
                )),
                Err(e2) => Err(format!(
                    "hotkey re-register failed: {e}; RESTORING PREVIOUS SHORTCUT ALSO FAILED: {e2}"
                )),
            }
        }
    }
}

fn persist_config(
    app: &tauri::AppHandle,
    path: &std::path::Path,
    cfg: &AppConfig,
) -> Result<(), String> {
    config::save(path, cfg).map_err(|e| e.to_string())?;
    apply_lang(app, cfg.lang);
    Ok(())
}

/// Push the active language to the tray, editor title, and every webview.
fn apply_lang(app: &tauri::AppHandle, lang: Lang) {
    if let Err(e) = tray::apply_lang(app, lang) {
        eprintln!("[eisen] tray lang update failed: {e}");
    }
    if let Some(window) = app.get_webview_window("editor") {
        let _ = window.set_title(lang.editor_title());
    }
    let payload = match lang {
        Lang::Vi => "Vi",
        Lang::En => "En",
    };
    let _ = app.emit("lang", payload);
}

/// Persist a full app config from the Settings view.
#[tauri::command]
fn cmd_set_config(app: tauri::AppHandle, cfg: AppConfig) -> Result<(), String> {
    let mut cfg = cfg;
    // Save targets derive solely from this validated dir joined with a
    // generated filename (see cmd_save/cmd_save_bytes), so set-time
    // validation covers them; those commands take no renderer path.
    cfg.save_dir = crate::domain::path_guard::ensure_valid_target_dir(&cfg.save_dir)?;
    save_config(&app, &cfg)
}

/// Restore the default config, re-register the default hotkey, return it.
#[tauri::command]
fn cmd_reset_config(app: tauri::AppHandle) -> Result<AppConfig, String> {
    let cfg = AppConfig::default();
    save_config(&app, &cfg)?;
    Ok(cfg)
}

/// The current capture session (image path, region, scale) for the editor.
#[tauri::command]
fn cmd_get_last_capture(
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
) -> Result<CaptureSession, String> {
    let (path, rect, scale) = orchestrator
        .last()
        .ok_or_else(|| "no capture session; commit a region first".to_string())?;
    Ok(CaptureSession { path, rect, scale })
}

/// Compute editor window geometry (width, height, x, y) centered within `monitor_frame`
/// and clamped to minimum dimensions (680x480) and monitor dimensions.
pub(crate) fn compute_editor_geometry(
    capture_rect: (f64, f64),
    monitor_frame: (f64, f64, f64, f64),
) -> (f64, f64, f64, f64) {
    const EXTRA_HEIGHT: f64 = 224.0;
    const EXTRA_WIDTH: f64 = 96.0;
    let (mon_x, mon_y, mon_w, mon_h) = monitor_frame;
    let target_w = (capture_rect.0 + EXTRA_WIDTH).max(680.0).min(mon_w);
    let target_h = (capture_rect.1 + EXTRA_HEIGHT).max(540.0).min(mon_h);
    let target_x = mon_x + (mon_w - target_w) / 2.0;
    let target_y = mon_y + (mon_h - target_h) / 2.0;
    (target_w, target_h, target_x, target_y)
}

/// Create (once) and reveal the editor window, sized to the current capture
/// region plus the toolbar, centered on the screen.
fn show_editor(app: &tauri::AppHandle, orchestrator: &CaptureOrchestrator) -> tauri::Result<()> {
    let window = if let Some(w) = app.get_webview_window("editor") {
        w
    } else {
        WebviewWindowBuilder::new(app, "editor", WebviewUrl::App("editor".into()))
            .title(app_config(app).lang.editor_title())
            .always_on_top(true)
            .skip_taskbar(true)
            .min_inner_size(680.0, 480.0)
            .build()?
    };
    let _ = window.set_title(app_config(app).lang.editor_title());
    if let Some((_, rect, _)) = orchestrator.last() {
        let monitors = app.available_monitors().ok().unwrap_or_default();
        #[cfg(target_os = "macos")]
        let active_idx = crate::platform::mac_adapter::active_display_index().unwrap_or(0);
        #[cfg(not(target_os = "macos"))]
        let active_idx = 0;

        let monitor = monitors
            .get(active_idx)
            .cloned()
            .or_else(|| app.primary_monitor().ok().flatten());

        if let Some(mon) = monitor {
            let scale = mon.scale_factor();
            let size = mon.size();
            let pos = mon.position();

            let mon_w = size.width as f64 / scale;
            let mon_h = size.height as f64 / scale;
            let mon_x = pos.x as f64 / scale;
            let mon_y = pos.y as f64 / scale;

            let (target_w, target_h, target_x, target_y) =
                compute_editor_geometry((rect.width, rect.height), (mon_x, mon_y, mon_w, mon_h));

            let _ = window.set_min_size(Some(tauri::LogicalSize::new(680.0, 480.0)));
            let _ = window.set_size(tauri::LogicalSize::new(target_w, target_h));
            let _ = window.set_position(tauri::LogicalPosition::new(target_x, target_y));
        } else {
            const EXTRA_HEIGHT: f64 = 224.0;
            const EXTRA_WIDTH: f64 = 96.0;
            let target_w = (rect.width + EXTRA_WIDTH).max(680.0);
            let target_h = (rect.height + EXTRA_HEIGHT).max(540.0);
            let _ = window.set_min_size(Some(tauri::LogicalSize::new(680.0, 480.0)));
            let _ = window.set_size(tauri::LogicalSize::new(target_w, target_h));
            let _ = window.center();
        }
    }
    window.show()?;
    window.set_focus()?;
    Ok(())
}

/// Reopen an existing capture image (from the session history) in the editor.
#[tauri::command]
fn cmd_open_in_editor(
    app: tauri::AppHandle,
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
    path: String,
) -> Result<(), String> {
    // IPC trust boundary: custom commands bypass Tauri capability gating, so
    // the renderer-supplied path must pass the explicit root allowlist
    // (save_dir + history entries; temp stays implicit inside ensure_allowed)
    // before the orchestrator touches it. The hub legitimately sends
    // previously-SAVED paths from save_dir, which the extra roots keep working.
    let allowed = crate::domain::path_guard::ensure_allowed(
        std::path::Path::new(&path),
        &build_validator_roots(&app),
    )?;
    if let Some(overlay) = app.get_webview_window("overlay") {
        if overlay.is_visible().unwrap_or(false) {
            return Err(
                "a capture is in progress; finish or cancel it before reopening".to_string(),
            );
        }
    }
    orchestrator
        .reopen(&allowed)
        .map_err(|e| e.to_string())?;
    show_editor(&app, &orchestrator).map_err(|e| e.to_string())
}

/// Return the path of a cached thumbnail for a capture image, generating it
/// on first request. The frontend converts the returned path via
/// convertFileSrc.
#[tauri::command]
async fn cmd_get_thumbnail(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // IPC trust boundary: custom commands bypass Tauri capability gating, so
    // validate BEFORE any filesystem access (same rule as plan 025), using
    // the shared root list (save_dir + session-history entries; temp stays
    // implicit inside ensure_allowed).
    let src = crate::domain::path_guard::ensure_allowed(
        std::path::Path::new(&path),
        &build_validator_roots(&app),
    )?;

    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("thumbnails");
    // Decode/resize can take hundreds of ms per image; keep it off the main
    // thread like the other heavy commands (plan 026). Owned values only
    // cross the spawn boundary — State is not Send.
    tauri::async_runtime::spawn_blocking(move || crate::domain::thumbnail::generate(&src, &dir))
        .await
        .map_err(|e| format!("thumbnail task failed: {e}"))?
        .map(|thumb| thumb.to_string_lossy().into_owned())
}

/// Copy the captured region PNG to the system clipboard.
#[tauri::command]
async fn cmd_copy(
    app: tauri::AppHandle,
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
) -> Result<(), String> {
    // State is not Send-friendly: pull the owned path out BEFORE spawning.
    let (path, _, _) = orchestrator
        .last()
        .ok_or_else(|| "no capture in progress; commit a region first".to_string())?;
    // Decode + clipboard write run together in spawn_blocking. Splitting the
    // clipboard onto the main thread would require exporting decode_image from
    // output.rs (out of scope); the plugin is invoked from the blocking pool.
    let app_for_copy = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("failed to read capture image: {e}"))?;
        output::copy_image(&app_for_copy, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("copy task failed: {e}"))??;
    sound::play(SoundEffect::Copy, app_config(&app).play_sounds);
    Ok(())
}

/// Copy the PNG at `path` to the clipboard. Unlike `cmd_copy` this reads the
/// given file (a hub-gallery capture), not the orchestrator's last capture.
#[tauri::command]
fn cmd_copy_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    // IPC trust boundary: route through the shared allowlist like every
    // path-taking command (module invariant in domain/path_guard.rs).
    crate::domain::path_guard::ensure_allowed(
        std::path::Path::new(&path),
        &build_validator_roots(&app),
    )?;
    let bytes = std::fs::read(&path).map_err(|e| format!("failed to read image: {e}"))?;
    output::copy_image(&app, &bytes).map_err(|e| e.to_string())?;
    sound::play(SoundEffect::Copy, app_config(&app).play_sounds);
    Ok(())
}

/// Save the captured region PNG to the configured save directory and record
/// the saved path in the session history.
#[tauri::command]
async fn cmd_save(
    app: tauri::AppHandle,
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
) -> Result<SaveResult, String> {
    // State is not Send-friendly: pull the owned path out BEFORE spawning.
    let (path, _, _) = orchestrator
        .last()
        .ok_or_else(|| "no capture in progress; commit a region first".to_string())?;
    let dir = app_config(&app).save_dir;
    let saved = tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("failed to read capture image: {e}"))?;
        output::save_image(&dir, &naming::default_filename(), &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("save task failed: {e}"))??;
    push_history(&app, saved.to_string_lossy());
    sound::play(SoundEffect::Save, app_config(&app).play_sounds);
    Ok(SaveResult { path: saved })
}

/// Copy the captured region PNG to the clipboard, save it to disk and record
/// the saved path in the session history.
#[tauri::command]
async fn cmd_copy_and_save(
    app: tauri::AppHandle,
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
) -> Result<SaveResult, String> {
    // State is not Send-friendly: pull the owned path out BEFORE spawning.
    let (path, _, _) = orchestrator
        .last()
        .ok_or_else(|| "no capture in progress; commit a region first".to_string())?;
    let dir = app_config(&app).save_dir;
    let app_for_copy = app.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| format!("failed to read capture image: {e}"))?;
        output::copy_image(&app_for_copy, &bytes).map_err(|e| e.to_string())?;
        output::save_image(&dir, &naming::default_filename(), &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("copy-and-save task failed: {e}"))??;
    push_history(&app, saved.to_string_lossy());
    sound::play(SoundEffect::Save, app_config(&app).play_sounds);
    Ok(SaveResult { path: saved })
}

/// Copy custom rasterized image bytes (base image + annotations) to clipboard.
#[tauri::command]
async fn cmd_copy_bytes(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<(), String> {
    let app_for_copy = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        output::copy_image(&app_for_copy, &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("copy-bytes task failed: {e}"))??;
    sound::play(SoundEffect::Copy, app_config(&app).play_sounds);
    Ok(())
}

/// Save custom rasterized image bytes (base image + annotations) to disk.
#[tauri::command]
async fn cmd_save_bytes(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<SaveResult, String> {
    let dir = app_config(&app).save_dir;
    let saved = tauri::async_runtime::spawn_blocking(move || {
        output::save_image(&dir, &naming::default_filename(), &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("save-bytes task failed: {e}"))??;
    push_history(&app, saved.to_string_lossy());
    sound::play(SoundEffect::Save, app_config(&app).play_sounds);
    Ok(SaveResult { path: saved })
}

/// Copy custom rasterized image bytes to clipboard and save to disk in a single IPC call.
#[tauri::command]
async fn cmd_copy_and_save_bytes(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
) -> Result<SaveResult, String> {
    let dir = app_config(&app).save_dir;
    let app_for_copy = app.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || {
        output::copy_image(&app_for_copy, &bytes).map_err(|e| e.to_string())?;
        output::save_image(&dir, &naming::default_filename(), &bytes).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("copy-and-save-bytes task failed: {e}"))??;
    push_history(&app, saved.to_string_lossy());
    sound::play(SoundEffect::Save, app_config(&app).play_sounds);
    Ok(SaveResult { path: saved })
}

/// Play a named sound effect if sounds are enabled in app configuration.
#[tauri::command]
fn cmd_play_sound(app: tauri::AppHandle, effect: String) -> Result<(), String> {
    let sound = match effect.as_str() {
        "shutter" => SoundEffect::Shutter,
        "copy" => SoundEffect::Copy,
        "save" => SoundEffect::Save,
        _ => return Err(format!("unknown sound effect: {effect}")),
    };
    sound::play(sound, app_config(&app).play_sounds);
    Ok(())
}

/// Extract text from the last capture image using native OCR.
#[tauri::command]
async fn cmd_extract_text(
    orchestrator: State<'_, Arc<CaptureOrchestrator>>,
) -> Result<String, String> {
    // State is not Send-friendly: pull the owned path out BEFORE spawning.
    let (path, _, _) = orchestrator
        .last()
        .ok_or_else(|| "no capture session active".to_string())?;
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            platform::mac_adapter::extract_text_from_image_path(&path)
        })
        .await
        .map_err(|e| format!("OCR task failed: {e}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("OCR is currently supported on macOS only".to_string())
    }
}

/// Record a capture id (its persisted image path) in the session history.
fn push_history(app: &tauri::AppHandle, id: std::borrow::Cow<'_, str>) {
    app.state::<Arc<Mutex<CaptureHistory>>>()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(id.into_owned());
}

/// Re-publish the current history to the main window, mirroring the tray's
/// `show_history` emit behavior: entries whose file no longer exists are
/// dropped and the payload stays a `string[]` of paths (newest first).
/// Gallery removal never touches the files themselves.
fn emit_history(app: &tauri::AppHandle) {
    let paths: Vec<String> = app
        .state::<Arc<Mutex<CaptureHistory>>>()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .recent()
        .into_iter()
        .filter(|p| std::path::Path::new(p).is_file())
        .cloned()
        .collect();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("history", &paths);
    }
}

/// Remove a path from the session history. GALLERY-ONLY: the image file on
/// disk is never deleted or moved.
#[tauri::command]
fn cmd_remove_history(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let removed = app
        .state::<Arc<Mutex<CaptureHistory>>>()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&path);
    if !removed {
        return Err(format!("not in history: {path}"));
    }
    emit_history(&app);
    Ok(())
}

/// Last startup hotkey-registration failure, if any. The hub queries this
/// because a `setup` emit can fire before the webview has subscribed.
#[tauri::command]
fn cmd_hotkey_error(slot: State<'_, Arc<Mutex<Option<String>>>>) -> Option<String> {
    slot.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Non-prompting Screen Recording (TCC) preflight. Never shows a system dialog.
#[tauri::command]
fn cmd_screen_permission() -> bool {
    platform::mac_adapter::has_screen_permission()
}

/// Open System Settings on Privacy & Security → Screen Recording.
#[tauri::command]
fn cmd_open_screen_settings() -> Result<(), String> {
    platform::mac_adapter::open_screen_permission_settings()
}

/// Return the application semantic version (from Cargo.toml at compile time).
#[tauri::command]
fn cmd_get_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Arc::new(CaptureOrchestrator::new(platform::MacAdapter)))
        .manage(Arc::new(Mutex::new(CaptureHistory::new(50))))
        .manage(Arc::new(Mutex::new(None::<String>)));

// NOTE: MonitorRegistry must be managed on the Builder chain (applied during
// `build()`), NOT inside `.setup()` — the setup closure runs from the
// runtime's Ready callback, and an in-setup `manage()` was observed missing
// from the state map when the same closure then called `state()` for it
// (launch panic: "state() called before manage()").
#[cfg(target_os = "macos")]
let builder = {
    let builder = builder;
    builder.manage(Arc::new(std::sync::Mutex::new(
        platform::mac_adapter::MonitorRegistry::new(),
    )))
};
#[cfg(not(target_os = "macos"))]
let builder = builder;

builder
        .setup(|app| {
            // Hide from macOS Dock — EiSen lives only in the menu bar / system tray.
            #[cfg(target_os = "macos")]
            {
                use tauri::ActivationPolicy;
                app.set_activation_policy(ActivationPolicy::Accessory);
            }
            core::capture::cleanup_stale_temp_files();

            let cfg = app_config(app.handle());
            let overlay = WebviewWindowBuilder::new(
                app,
                "overlay",
                WebviewUrl::App("overlay".into()),
            )
            .title("EiSen Overlay")
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .visible(false)
            .build()?;
            if let Some(monitor) = app.primary_monitor().ok().flatten() {
                let scale = monitor.scale_factor();
                let size = monitor.size();
                let pos = monitor.position();
                let _ = overlay.set_position(
                    tauri::LogicalPosition::new(pos.x as f64 / scale, pos.y as f64 / scale),
                );
                let _ = overlay.set_size(
                    tauri::LogicalSize::new(size.width as f64 / scale, size.height as f64 / scale),
                );
            }
            if let Err(e) = tray::setup(app.handle(), cfg.lang) {
                eprintln!("[eisen] tray setup failed: {e}");
            }
            match hotkey::register(app.handle(), &cfg.hotkey) {
                Ok(()) => {
                    #[cfg(target_os = "macos")]
                    {
                        use crate::core::hotkey::MonitorAction;
                        let registry =
                            app.state::<Arc<Mutex<platform::mac_adapter::MonitorRegistry>>>();
                        let action = match hotkey::preset_monitor_kind(&cfg.hotkey) {
                            Some(kind) => MonitorAction::Add(kind),
                            None => MonitorAction::RemoveAll,
                        };
                        platform::mac_adapter::apply_monitor_action(app.handle(), &registry, action);
                    }
                }
                Err(e) => {
                    eprintln!("[eisen] hotkey registration failed: {e}");
                    let message = e.to_string();
                    *app.state::<Arc<Mutex<Option<String>>>>()
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = Some(message.clone());
                    let _ = app.emit("hotkey-error", &message);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cmd_begin_capture,
            cmd_commit_region,
            cmd_cancel_capture,
            cmd_copy,
            cmd_copy_path,
            cmd_save,
            cmd_copy_and_save,
            cmd_copy_bytes,
            cmd_save_bytes,
            cmd_copy_and_save_bytes,
            cmd_get_config,
            cmd_set_config,
            cmd_reset_config,
            cmd_get_last_capture,
            cmd_open_in_editor,
            cmd_get_thumbnail,
            cmd_extract_text,
            cmd_remove_history,
            cmd_hotkey_error,
            cmd_screen_permission,
            cmd_open_screen_settings,
            cmd_get_app_version,
            cmd_play_sound
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writable scratch dir OUTSIDE the implicit temp root (under the cargo
    /// target dir), so negative cases genuinely fail the allowlist — same
    /// technique as domain/path_guard.rs tests.
    fn outside_scratch(tag: &str) -> std::path::PathBuf {
        let exe = std::env::current_exe().expect("current_exe for scratch dir");
        let build_root = exe
            .ancestors()
            .nth(3)
            .expect("build root above the test executable");
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = build_root.join(format!("eisen-validator-roots-scratch/{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    /// THE path-command GATE: a renderer-supplied path only reaches disk
    /// after passing ensure_allowed against the build_validator_roots shape
    /// (save_dir + history entries). Saved captures stay readable; arbitrary
    /// paths outside every root are rejected with `path not allowed`.
    #[test]
    fn path_allowlist_accepts_saved_and_rejects_outside_paths() {
        let scratch = outside_scratch("path-allowlist");
        let save_dir = scratch.join("shots");
        std::fs::create_dir_all(&save_dir).expect("mkdir shots");
        let saved = save_dir.join("EiSen_20260826_120000.png");
        std::fs::write(&saved, b"png").expect("write saved capture");

        let roots = validator_roots(save_dir, vec![saved.to_string_lossy().into_owned()]);

        let got = crate::domain::path_guard::ensure_allowed(
            std::path::Path::new(saved.to_str().expect("utf8 path")),
            &roots,
        )
        .expect("a saved capture under save_dir must stay allowed");
        assert_eq!(got, std::fs::canonicalize(&saved).expect("canonicalize"));

        let secret = scratch.join("secret.png");
        std::fs::write(&secret, b"png").expect("write outside file");
        let err = crate::domain::path_guard::ensure_allowed(
            std::path::Path::new(secret.to_str().expect("utf8 path")),
            &roots,
        )
        .expect_err("arbitrary renderer paths outside every root must be rejected");
        assert!(
            err.starts_with("path not allowed"),
            "standard error prefix expected, got: {err}"
        );

        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[test]
    fn compute_editor_geometry_centers_on_primary() {
        let capture = (400.0, 200.0);
        let monitor = (0.0, 0.0, 1920.0, 1080.0);
        let (w, h, x, y) = compute_editor_geometry(capture, monitor);
        assert_eq!(w, 680.0); // min width
        assert_eq!(h, 540.0); // min height
        assert_eq!(x, (1920.0 - 680.0) / 2.0);
        assert_eq!(y, (1080.0 - 540.0) / 2.0);
    }

    #[test]
    fn compute_editor_geometry_centers_on_secondary_display() {
        let capture = (800.0, 600.0);
        let monitor = (1920.0, 0.0, 2560.0, 1440.0);
        let (w, h, x, y) = compute_editor_geometry(capture, monitor);
        assert_eq!(w, 896.0); // 800 + 96
        assert_eq!(h, 824.0); // 600 + 224
        assert_eq!(x, 1920.0 + (2560.0 - 896.0) / 2.0);
        assert_eq!(y, (1440.0 - 824.0) / 2.0);
    }

    #[test]
    fn compute_editor_geometry_clamps_to_small_monitor() {
        let capture = (2000.0, 2000.0);
        let monitor = (0.0, 0.0, 1280.0, 800.0);
        let (w, h, x, y) = compute_editor_geometry(capture, monitor);
        assert_eq!(w, 1280.0);
        assert_eq!(h, 800.0);
        assert_eq!(x, 0.0);
        assert_eq!(y, 0.0);
    }

    #[test]
    fn test_cmd_get_app_version_matches_cargo() {
        assert_eq!(cmd_get_app_version(), env!("CARGO_PKG_VERSION"));
    }
}
