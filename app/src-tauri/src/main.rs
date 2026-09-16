// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Set the activation policy to Accessory *before* Tauri initialises any
    // NSWindow.  This must happen here — doing it inside `.setup()` is too
    // late: Tauri has already created the default window by then and macOS
    // Launch Services has already logged the process as a regular app,
    // causing it to appear in the Dock's "Recent Applications" section even
    // though `LSUIElement = true` is present in the bundle's Info.plist.
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
