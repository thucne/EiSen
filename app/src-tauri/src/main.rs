// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Set the activation policy to Accessory *before* Tauri initialises Cocoa.
    // `lib.rs` also configures `Accessory` + `set_dock_visibility(false)` on the
    // built `App` before `app.run(...)`, because `.setup()` runs after `tao`'s
    // `applicationDidFinishLaunching:` has already applied its `Regular` default
    // (which logs EiSen into the Dock's Recent Applications).
    #[cfg(target_os = "macos")]
    {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy};
        // SAFETY: main() is always called on the main thread.
        let mtm = unsafe { MainThreadMarker::new_unchecked() };
        let _ = NSApplication::sharedApplication(mtm)
            .setActivationPolicy(NSApplicationActivationPolicy::Accessory);
    }

    tauri_app_lib::run()
}
