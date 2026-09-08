//! Menu-bar tray icon: Capture now / Settings / History / Quit.
//!
//! The tray makes EiSen a resident app — the overlay stays hidden until a
//! capture is triggered by the hotkey or "Capture now".

use crate::core::{capture, history::CaptureHistory};
use crate::domain::config::Lang;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Runtime,
};

const TRAY_ID: &str = "eisen-tray";

/// Build the tray icon and its menu. "Capture now" drives the same
/// `begin_capture` path as the hotkey; "Quit" exits the app.
pub fn setup(app: &AppHandle, lang: Lang) -> Result<(), String> {
    let menu = build_menu(app, lang)?;
    let icon_bytes = include_bytes!("../../icons/tray-icon.png");
    let icon = tauri::image::Image::from_bytes(icon_bytes)
        .map_err(|e| format!("failed to load tray icon: {e}"))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip(format!("EiSen v{}", env!("CARGO_PKG_VERSION")))
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "capture" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = capture::begin_capture(&app) {
                        eprintln!("[eisen] tray capture failed: {e}");
                    }
                });
            }
            "settings" => {
                show_main_window(app);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("settings", ());
                }
            }
            "history" => show_history(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Replace tray item titles after the user changes language in Settings.
pub fn apply_lang(app: &AppHandle, lang: Lang) -> Result<(), String> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let menu = build_menu(app, lang)?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, lang: Lang) -> Result<Menu<R>, String> {
    let version_title = format!("EiSen v{}", env!("CARGO_PKG_VERSION"));
    let version_item = MenuItem::with_id(app, "version_info", &version_title, false, None::<&str>)
        .map_err(|e| e.to_string())?;
    let labels = lang.menu_labels();
    let capture = MenuItem::with_id(app, "capture", labels.capture, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let settings = MenuItem::with_id(app, "settings", labels.settings, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let history = MenuItem::with_id(app, "history", labels.history, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = MenuItem::with_id(app, "quit", labels.quit, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    Menu::with_items(
        app,
        &[
            &version_item,
            &PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
            &capture,
            &settings,
            &history,
            &PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?,
            &quit,
        ],
    )
    .map_err(|e| e.to_string())
}

/// Reveal and focus the main window (Settings / History surface).
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Show the session history in the main window. Entries whose
/// file no longer exists are dropped so the list never offers a dangling
/// reopen link.
fn show_history(app: &AppHandle) {
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
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("history", &paths);
    }
}
