use crate::core::capture::ScreenProvider;
use std::path::Path;
use std::process::Command;

/// Which screen frame contains `point`, both in the **same** coordinate
/// space (Cocoa bottom-left for `NSEvent::mouseLocation` + `NSScreen::frame`).
/// If the point is in no frame, index `0` (first screen / main).
#[cfg(any(target_os = "macos", test))]
pub(crate) fn screen_index_containing(point: (f64, f64), frames: &[(f64, f64, f64, f64)]) -> usize {
    for (i, &(x, y, w, h)) in frames.iter().enumerate() {
        if point.0 >= x && point.0 < x + w && point.1 >= y && point.1 < y + h {
            return i;
        }
    }
    0
}

/// macOS screen capture via the system `screencapture` CLI.
///
/// Requires Screen Recording permission (TCC). `capture_display` takes a
/// clean full-screen PNG before the overlay window opens, and the
/// orchestrator crops the region from this clean full capture so no
/// overlay UI or selection borders are ever recorded in the saved image.
pub struct MacAdapter;

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
struct ActiveScreen {
    /// 1-based `screencapture -D` index (not a CGDirectDisplayID).
    display: u32,
    scale: f64,
    geometry: crate::core::capture::DisplayGeometry,
    /// CGDirectDisplayID, 0 when AppKit does not report one.
    display_id: u32,
}

#[cfg(target_os = "macos")]
static LAST_ACTIVE: std::sync::Mutex<Option<ActiveScreen>> = std::sync::Mutex::new(None);

#[cfg(target_os = "macos")]
fn on_main<T: Send>(f: impl FnOnce() -> T + Send) -> T {
    if objc2::MainThreadMarker::new().is_some() {
        f()
    } else {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        dispatch2::DispatchQueue::main().exec_sync(move || {
            let _ = tx.send(f());
        });
        rx.recv().expect("main-queue screen resolve")
    }
}

#[cfg(target_os = "macos")]
fn screen_display_id(screen: &objc2_app_kit::NSScreen) -> u32 {
    use objc2::rc::Retained;
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let key = objc2_foundation::NSString::from_str("NSScreenNumber");
    unsafe {
        let description: Retained<AnyObject> = msg_send![screen, deviceDescription];
        let number: Option<Retained<AnyObject>> = msg_send![&*description, objectForKey: &*key];
        number.map_or(0, |number| msg_send![&*number, unsignedIntValue])
    }
}

#[cfg(target_os = "macos")]
fn describe_screen(screen: &objc2_app_kit::NSScreen, index: usize) -> ActiveScreen {
    let frame = screen.frame();
    let backing = screen.convertRectToBacking(frame);
    let scale = if frame.size.width > 0.0 {
        backing.size.width / frame.size.width
    } else {
        1.0
    };
    ActiveScreen {
        display: (index as u32) + 1,
        scale,
        display_id: screen_display_id(screen),
        geometry: crate::core::capture::DisplayGeometry {
            x: (frame.origin.x * scale).round() as i32,
            y: (frame.origin.y * scale).round() as i32,
            width: backing.size.width.round() as u32,
            height: backing.size.height.round() as u32,
            scale,
        },
    }
}

#[cfg(target_os = "macos")]
fn resolve_active_screen() -> ActiveScreen {
    on_main(|| {
        use objc2::MainThreadMarker;
        use objc2_app_kit::{NSEvent, NSScreen};

        let mtm = MainThreadMarker::new().expect("AppKit screen list is main-thread-only");
        let loc = NSEvent::mouseLocation();
        let screens = NSScreen::screens(mtm);
        let n = screens.count();
        if n == 0 {
            return ActiveScreen {
                display: 1,
                scale: 1.0,
                display_id: 0,
                geometry: crate::core::capture::DisplayGeometry {
                    x: 0,
                    y: 0,
                    width: 0,
                    height: 0,
                    scale: 1.0,
                },
            };
        }
        let mut frames = Vec::with_capacity(n);
        for i in 0..n {
            let f = screens.objectAtIndex(i).frame();
            frames.push((f.origin.x, f.origin.y, f.size.width, f.size.height));
        }
        let idx = screen_index_containing((loc.x, loc.y), &frames);
        describe_screen(&screens.objectAtIndex(idx), idx)
    })
}

#[cfg(target_os = "macos")]
fn resolve_and_store() -> ActiveScreen {
    let screen = resolve_active_screen();
    *LAST_ACTIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(screen);
    screen
}

/// 0-based index of the display selected by the cursor during the last capture.
#[cfg(target_os = "macos")]
pub fn active_display_index() -> Option<usize> {
    LAST_ACTIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|s| (s.display as usize).saturating_sub(1))
}

impl ScreenProvider for MacAdapter {
    fn capture_display(&self, display: u32, out: &Path) -> Result<(), String> {
        // ScreenCaptureKit skips a process spawn and PNG compression, which
        // cuts capture to backdrop from about 190 ms to 120 ms on an M3 Pro. Any
        // failure, a permission one included, falls through to `screencapture`,
        // which also covers macOS below 14.
        #[cfg(target_os = "macos")]
        {
            let active = *LAST_ACTIVE.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(screen) = active.filter(|s| s.display == display && s.display_id != 0) {
                let size = (screen.geometry.width, screen.geometry.height);
                match screen_capture_kit::capture(screen.display_id, size, out) {
                    Ok(()) => return Ok(()),
                    Err(e) => eprintln!("[eisen] ScreenCaptureKit failed, using screencapture: {e}"),
                }
            }
        }
        let mut cmd = Command::new("screencapture");
        cmd.arg("-x").arg("-t").arg("png");
        // 2026-09-06, macOS: `screencapture -D` is 1-based (`-D 1` is main
        // display, `-D 2` secondary, …). Passing a CGDirectDisplayID (e.g.
        // 69733440) fails with "Invalid display specified". `active_display`
        // returns the 1-based index into `NSScreen::screens`.
        if display >= 1 {
            cmd.arg(format!("-D{display}"));
        }
        cmd.arg(out);
        run(cmd, out)
    }

    fn active_display(&self) -> Result<u32, String> {
        #[cfg(target_os = "macos")]
        {
            Ok(resolve_and_store().display)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Ok(0)
        }
    }

    fn active_scale(&self) -> f64 {
        #[cfg(target_os = "macos")]
        {
            LAST_ACTIVE
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .as_ref()
                .map(|s| s.scale)
                .unwrap_or_else(|| resolve_and_store().scale)
        }
        #[cfg(not(target_os = "macos"))]
        {
            1.0
        }
    }

    #[cfg(target_os = "macos")]
    fn active_geometry(&self) -> Option<crate::core::capture::DisplayGeometry> {
        LAST_ACTIVE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|s| s.geometry)
    }

    #[cfg(target_os = "macos")]
    fn select_display(&self, target: crate::core::capture::DisplayGeometry) -> Option<u32> {
        let screen = on_main(move || {
            let mtm = objc2::MainThreadMarker::new().expect("AppKit screen list is main-thread-only");
            let screens = objc2_app_kit::NSScreen::screens(mtm);
            (0..screens.count())
                .map(|i| describe_screen(&screens.objectAtIndex(i), i))
                .find(|screen| screen.geometry == target)
        })?;
        *LAST_ACTIVE.lock().unwrap_or_else(|e| e.into_inner()) = Some(screen);
        Some(screen.display)
    }
}

fn run(mut cmd: Command, out: &Path) -> Result<(), String> {
    let status = cmd.status().map_err(|e| format!("failed to run screencapture: {e}"))?;
    if !status.success() {
        let _ = std::fs::remove_file(out);
        return Err("macOS Screen Recording permission required. Please grant permission in System Settings -> Privacy & Security -> Screen Recording.".to_string());
    }
    // Verify the output file exists and is non-empty
    let meta = std::fs::metadata(out);
    if meta.is_err() || meta.unwrap().len() == 0 {
        let _ = std::fs::remove_file(out);
        return Err("macOS Screen Recording permission required. Please grant permission in System Settings -> Privacy & Security -> Screen Recording.".to_string());
    }
    // Owner-only perms. The file transiently exists with default perms WHILE
    // `screencapture` runs — residual risk accepted for this minimal fix.
    crate::core::capture::restrict_permissions(out);
    Ok(())
}

/// Whether this process currently holds the macOS Screen Recording (TCC)
/// grant. Non-prompting: `CGPreflightScreenCaptureAccess` only reports
/// status, it never shows a system dialog. Prompting is a deliberate
/// non-goal — the user clicks through to Settings instead.
///
/// Caveats: some macOS versions cache the preflight result per process, so a
/// grant made while EiSen is running may still read `false` until relaunch.
/// The result is also tied to the signed bundle identity — `tauri dev` can
/// differ from a bundled `.app`.
#[cfg(target_os = "macos")]
pub fn has_screen_permission() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }
    unsafe { CGPreflightScreenCaptureAccess() }
}

/// Other platforms have no equivalent TCC gate; report granted so the hub
/// renders no banner.
#[cfg(not(target_os = "macos"))]
pub fn has_screen_permission() -> bool {
    true
}

/// Open System Settings directly on Privacy & Security → Screen Recording.
/// The pane URL is a fixed constant — never parameterized from user input.
#[cfg(target_os = "macos")]
pub fn open_screen_permission_settings() -> Result<(), String> {
    let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
    std::process::Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| format!("failed to open System Settings: {e}"))
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err("System Settings did not open".into())
            }
        })
}

#[cfg(not(target_os = "macos"))]
pub fn open_screen_permission_settings() -> Result<(), String> {
    Ok(())
}

/// Reveal a saved file in Finder. The path comes from a validated IPC argument
/// and is passed as one argv entry, never through a shell.
#[cfg(target_os = "macos")]
pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to open Finder: {e}"))
}

/// Keep the feedback window above other apps, full-screen ones included.
#[cfg(target_os = "macos")]
pub fn elevate_feedback_window(window: &tauri::WebviewWindow) {
    use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};

    if let Ok(ns_win_ptr) = window.ns_window() {
        let ns_win = ns_win_ptr as *mut NSWindow;
        unsafe {
            let win: &NSWindow = &*ns_win;
            win.setLevel(1000);
            win.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );
        }
    }
}

/// Show a window without making it key, so typing stays in the user's app.
#[cfg(target_os = "macos")]
pub fn show_without_activation(window: &tauri::WebviewWindow) {
    use objc2_app_kit::NSWindow;

    if let Ok(ns_win_ptr) = window.ns_window() {
        let ns_win = ns_win_ptr as *mut NSWindow;
        unsafe {
            let win: &NSWindow = &*ns_win;
            win.orderFrontRegardless();
        }
    }
}

/// Full-display grabs through `SCScreenshotManager` (macOS 14). The framework is
/// loaded at runtime, since linking it would stop the app launching on macOS 11.
#[cfg(target_os = "macos")]
mod screen_capture_kit {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::{NSArray, NSError};
    use std::ffi::{c_char, c_int, c_void};
    use std::path::Path;
    use std::sync::mpsc::sync_channel;
    use std::sync::{Mutex, Once};
    use std::time::Duration;

    const TIMEOUT: Duration = Duration::from_secs(2);
    const SC_CAPTURE_RESOLUTION_BEST: isize = 2;
    /// 8-bit BGRA: little-endian 32-bit with premultiplied alpha first.
    const BITMAP_INFO_BGRA: u32 = 0x2002;
    const RTLD_LAZY: c_int = 1;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {}

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn CGImageGetWidth(image: *const c_void) -> usize;
        fn CGImageGetHeight(image: *const c_void) -> usize;
        fn CGImageGetBytesPerRow(image: *const c_void) -> usize;
        fn CGImageGetBitmapInfo(image: *const c_void) -> u32;
        fn CGImageGetDataProvider(image: *const c_void) -> *const c_void;
        fn CGDataProviderCopyData(provider: *const c_void) -> *const c_void;
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
        fn CFDataGetLength(data: *const c_void) -> isize;
        fn CFRetain(object: *const c_void) -> *const c_void;
        fn CFRelease(object: *const c_void);
    }

    /// A retained CoreFoundation object, released on drop.
    struct Cf(*const c_void);
    unsafe impl Send for Cf {}
    impl Drop for Cf {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0) };
        }
    }

    struct Filter {
        display_id: u32,
        size: (u32, u32),
        filter: Retained<AnyObject>,
    }
    // SCContentFilter is immutable once created and is only passed to
    // ScreenCaptureKit, which takes it from any queue.
    unsafe impl Send for Filter {}

    /// Listing shareable content costs about 40 ms, so the filter is reused
    /// until the display or its size changes, or a grab fails.
    static FILTER: Mutex<Option<Filter>> = Mutex::new(None);

    fn manager_class() -> Option<&'static AnyClass> {
        static LOAD: Once = Once::new();
        LOAD.call_once(|| unsafe {
            dlopen(
                c"/System/Library/Frameworks/ScreenCaptureKit.framework/ScreenCaptureKit".as_ptr(),
                RTLD_LAZY,
            );
        });
        AnyClass::get(c"SCScreenshotManager")
    }

    fn error_text(error: *mut NSError) -> String {
        unsafe { error.as_ref() }
            .map(|e| e.localizedDescription().to_string())
            .unwrap_or_else(|| "unknown error".to_string())
    }

    fn make_filter(display_id: u32) -> Result<Retained<AnyObject>, String> {
        struct Display(Retained<AnyObject>);
        unsafe impl Send for Display {}

        let (tx, rx) = sync_channel(1);
        let block = RcBlock::new(move |content: *mut AnyObject, error: *mut NSError| {
            if content.is_null() {
                let _ = tx.send(Err(error_text(error)));
                return;
            }
            let displays: Retained<NSArray<AnyObject>> = unsafe { msg_send![content, displays] };
            let found = displays.iter().find(|display| {
                let id: u32 = unsafe { msg_send![&**display, displayID] };
                id == display_id
            });
            let _ = tx.send(found.map(Display).ok_or_else(|| "display not shareable".to_string()));
        });
        let class = AnyClass::get(c"SCShareableContent").ok_or("SCShareableContent is unavailable")?;
        let _: () = unsafe { msg_send![class, getShareableContentWithCompletionHandler: &*block] };
        let display = rx.recv_timeout(TIMEOUT).map_err(|e| e.to_string())??;

        let class = AnyClass::get(c"SCContentFilter").ok_or("SCContentFilter is unavailable")?;
        let none: Retained<NSArray<AnyObject>> = NSArray::new();
        unsafe {
            let filter: Allocated<AnyObject> = msg_send![class, alloc];
            Ok(msg_send![filter, initWithDisplay: &*display.0, excludingWindows: &*none])
        }
    }

    fn grab(manager: &AnyClass, filter: &AnyObject, size: (u32, u32)) -> Result<Cf, String> {
        let class = AnyClass::get(c"SCStreamConfiguration").ok_or("SCStreamConfiguration is unavailable")?;
        let config: Retained<AnyObject> = unsafe { msg_send![class, new] };
        unsafe {
            let _: () = msg_send![&*config, setWidth: size.0 as isize];
            let _: () = msg_send![&*config, setHeight: size.1 as isize];
            let _: () = msg_send![&*config, setShowsCursor: false];
            let _: () = msg_send![&*config, setCaptureResolution: SC_CAPTURE_RESOLUTION_BEST];
        }
        let (tx, rx) = sync_channel(1);
        let block = RcBlock::new(move |image: *const c_void, error: *mut NSError| {
            let _ = tx.send(if image.is_null() {
                Err(error_text(error))
            } else {
                Ok(Cf(unsafe { CFRetain(image) }))
            });
        });
        let _: () = unsafe {
            msg_send![manager, captureImageWithFilter: filter, configuration: &*config, completionHandler: &*block]
        };
        rx.recv_timeout(TIMEOUT).map_err(|e| e.to_string())?
    }

    fn write_png(image: &Cf, out: &Path) -> Result<(), String> {
        let (width, height, stride, info) = unsafe {
            (
                CGImageGetWidth(image.0),
                CGImageGetHeight(image.0),
                CGImageGetBytesPerRow(image.0),
                CGImageGetBitmapInfo(image.0),
            )
        };
        if info != BITMAP_INFO_BGRA {
            return Err(format!("unexpected bitmap info {info:#x}"));
        }
        let data = Cf(unsafe { CGDataProviderCopyData(CGImageGetDataProvider(image.0)) });
        if data.0.is_null() {
            return Err("captured image has no data".to_string());
        }
        let bytes = unsafe {
            std::slice::from_raw_parts(CFDataGetBytePtr(data.0), CFDataGetLength(data.0) as usize)
        };
        let rgba = bgra_rows_to_rgba(bytes, width, height, stride)?;
        write_uncompressed_png(&rgba, width as u32, height as u32, out)
    }

    /// The backdrop is only an intermediate, and `crop_png` compresses what
    /// the user keeps, so skipping compression here costs nothing lasting.
    pub(super) fn write_uncompressed_png(
        rgba: &[u8],
        width: u32,
        height: u32,
        out: &Path,
    ) -> Result<(), String> {
        use image::codecs::png::{CompressionType, FilterType, PngEncoder};
        use image::{ExtendedColorType, ImageEncoder};

        let file = std::fs::File::create(out).map_err(|e| e.to_string())?;
        crate::core::capture::restrict_permissions(out);
        PngEncoder::new_with_quality(
            std::io::BufWriter::with_capacity(1 << 20, file),
            CompressionType::Uncompressed,
            FilterType::NoFilter,
        )
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())
    }

    /// A display has no transparency, so alpha is written as opaque.
    pub(super) fn bgra_rows_to_rgba(
        bytes: &[u8],
        width: usize,
        height: usize,
        stride: usize,
    ) -> Result<Vec<u8>, String> {
        if stride < width * 4 || bytes.len() < stride * height {
            return Err("captured image is smaller than its header says".to_string());
        }
        let mut rgba = Vec::with_capacity(width * height * 4);
        for row in bytes.chunks_exact(stride.max(1)).take(height) {
            for px in row[..width * 4].chunks_exact(4) {
                rgba.extend_from_slice(&[px[2], px[1], px[0], 255]);
            }
        }
        Ok(rgba)
    }

    pub(super) fn capture(display_id: u32, size: (u32, u32), out: &Path) -> Result<(), String> {
        let manager = manager_class().ok_or("needs macOS 14")?;
        let mut cached = FILTER.lock().unwrap_or_else(|e| e.into_inner());
        if !cached.as_ref().is_some_and(|f| f.display_id == display_id && f.size == size) {
            *cached = Some(Filter {
                display_id,
                size,
                filter: make_filter(display_id)?,
            });
        }
        let filter = cached.as_ref().map(|f| f.filter.clone()).ok_or("no filter")?;
        let result = grab(manager, &filter, size).and_then(|image| write_png(&image, out));
        if result.is_err() {
            *cached = None;
            let _ = std::fs::remove_file(out);
        }
        result
    }
}

#[cfg(all(test, target_os = "macos"))]
mod screen_capture_kit_tests {
    use super::screen_capture_kit::{bgra_rows_to_rgba, write_uncompressed_png};

    #[test]
    fn bgra_conversion_skips_row_padding_and_makes_pixels_opaque() {
        // Two rows of two pixels; each row has 4 padding bytes.
        let bytes = [
            1, 2, 3, 0, 4, 5, 6, 0, 99, 99, 99, 99, //
            7, 8, 9, 0, 10, 11, 12, 0, 99, 99, 99, 99,
        ];
        assert_eq!(
            bgra_rows_to_rgba(&bytes, 2, 2, 12).unwrap(),
            [3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255]
        );
    }

    #[test]
    fn bgra_conversion_rejects_a_short_buffer() {
        assert!(bgra_rows_to_rgba(&[0; 15], 2, 2, 8).is_err());
        assert!(bgra_rows_to_rgba(&[0; 16], 2, 2, 4).is_err());
    }

    #[test]
    fn uncompressed_png_reads_back_with_the_same_pixels() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("eisen-full.png");
        let rgba = [3, 2, 1, 255, 6, 5, 4, 255, 9, 8, 7, 255, 12, 11, 10, 255];
        write_uncompressed_png(&rgba, 2, 2, &out).unwrap();
        assert_eq!(crate::core::capture::png_dimensions(&out), Some((2, 2)));
        assert_eq!(image::open(&out).unwrap().to_rgba8().as_raw(), &rgba);
    }
}

/// Answers AppKit during a file drag: dropping copies, so Finder never moves
/// the file away, and the end of the drag is reported to the feedback window.
#[cfg(target_os = "macos")]
mod file_drag {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol};
    use objc2::{define_class, msg_send, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSDragOperation, NSDraggingContext, NSDraggingSession, NSDraggingSource};
    use objc2_foundation::NSPoint;
    use tauri::{Emitter, Manager};

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "EiSenFileDragSource"]
        #[ivars = tauri::AppHandle]
        pub struct FileDragSource;

        unsafe impl NSObjectProtocol for FileDragSource {}

        unsafe impl NSDraggingSource for FileDragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation_mask(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                NSDragOperation::Copy
            }

            #[unsafe(method(draggingSession:endedAtPoint:operation:))]
            fn ended(&self, _session: &NSDraggingSession, _at: NSPoint, _operation: NSDragOperation) {
                if let Some(window) = self.ivars().get_webview_window("feedback") {
                    let _ = window.emit("feedback-drag-ended", ());
                }
            }
        }
    );

    impl FileDragSource {
        pub fn new(app: tauri::AppHandle, mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(app);
            unsafe { msg_send![super(this), init] }
        }
    }
}

#[cfg(target_os = "macos")]
thread_local! {
    /// Keeps the current drag's source alive until the next drag replaces it.
    static FILE_DRAG_SOURCE: std::cell::RefCell<Option<objc2::rc::Retained<file_drag::FileDragSource>>> =
        const { std::cell::RefCell::new(None) };
}

/// Begin dragging `path` from `window`, using the mouse event being handled.
/// Must run on the main thread.
#[cfg(target_os = "macos")]
pub fn start_file_drag(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    path: &Path,
) -> Result<(), String> {
    use objc2::runtime::ProtocolObject;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSDraggingItem, NSImage, NSWindow};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};

    const DRAG_IMAGE_WIDTH: f64 = 140.0;

    let mtm = MainThreadMarker::new().ok_or("file drag must start on the main thread")?;
    let event = NSApplication::sharedApplication(mtm)
        .currentEvent()
        .ok_or("no mouse event to start the drag from")?;
    let ns_win = window.ns_window().map_err(|e| e.to_string())? as *mut NSWindow;
    let win: &NSWindow = unsafe { &*ns_win };
    let view = win.contentView().ok_or("feedback window has no content view")?;

    let path = NSString::from_str(&path.to_string_lossy());
    let url = NSURL::fileURLWithPath(&path);
    let image = NSImage::initWithContentsOfFile(NSImage::alloc(), &path)
        .ok_or("failed to load the drag image")?;
    let size = image.size();
    let height = DRAG_IMAGE_WIDTH * size.height / size.width.max(1.0);
    let at = view.convertPoint_fromView(event.locationInWindow(), None);
    let frame = NSRect::new(
        NSPoint::new(at.x - DRAG_IMAGE_WIDTH / 2.0, at.y - height / 2.0),
        NSSize::new(DRAG_IMAGE_WIDTH, height),
    );

    let item = NSDraggingItem::initWithPasteboardWriter(
        NSDraggingItem::alloc(),
        ProtocolObject::from_ref(&*url),
    );
    unsafe { item.setDraggingFrame_contents(frame, Some(&image)) };

    let source = file_drag::FileDragSource::new(app.clone(), mtm);
    view.beginDraggingSessionWithItems_event_source(
        &NSArray::from_retained_slice(&[item]),
        &event,
        ProtocolObject::from_ref(&*source),
    );
    FILE_DRAG_SOURCE.with(|slot| *slot.borrow_mut() = Some(source));
    Ok(())
}

/// Elevate the overlay window above the macOS Menu Bar and Dock (NSScreenSaverWindowLevel)
/// so dragging selection boxes across the menu bar and dock receives pointer events.
#[cfg(target_os = "macos")]
pub fn elevate_overlay_window(window: &tauri::WebviewWindow) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};

    if let Ok(ns_win_ptr) = window.ns_window() {
        let ns_win = ns_win_ptr as *mut NSWindow;
        unsafe {
            let win: &NSWindow = &*ns_win;
            win.setStyleMask(NSWindowStyleMask::from_bits_truncate(0));
            win.setLevel(1000);
            win.setCollectionBehavior(
                NSWindowCollectionBehavior::CanJoinAllSpaces
                    | NSWindowCollectionBehavior::Stationary
                    | NSWindowCollectionBehavior::FullScreenAuxiliary,
            );

            if let Some(mtm) = MainThreadMarker::new() {
                let screens = NSScreen::screens(mtm);
                let n = screens.count();
                let idx = LAST_ACTIVE
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .map(|s| (s.display as usize).saturating_sub(1))
                    .unwrap_or(0);
                if n > 0 {
                    let screen = screens.objectAtIndex(idx.min(n - 1));
                    win.setFrame_display(screen.frame(), true);
                } else if let Some(main_screen) = NSScreen::mainScreen(mtm) {
                    // No NSScreen::screens entries (headless); last resort.
                    win.setFrame_display(main_screen.frame(), true);
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[link(name = "Vision", kind = "framework")]
extern "C" {}

/// Extract text from an image file using macOS Vision framework (VNRecognizeTextRequest).
///
/// The default request reads Latin scripts, Vietnamese included, but returns
/// nothing for scripts such as Japanese or Korean. Language detection reads
/// those, yet turns short Vietnamese into Thai, so it only runs as a fallback.
#[cfg(target_os = "macos")]
pub fn extract_text_from_image_path(path: &Path) -> Result<String, String> {
    let text = recognize_text(path, false)?;
    if !text.trim().is_empty() {
        return Ok(text);
    }
    recognize_text(path, true)
}

#[cfg(target_os = "macos")]
fn recognize_text(path: &Path, detect_language: bool) -> Result<String, String> {
    use objc2::rc::{autoreleasepool, Retained};
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{class, msg_send, sel};
    use std::ffi::{CStr, CString};

    let path_str = path.to_str().ok_or_else(|| "invalid image path".to_string())?;
    let path_c = CString::new(path_str).map_err(|e| e.to_string())?;

    autoreleasepool(|_| unsafe {
        let cls_nsstring = class!(NSString);
        let cls_nsurl = class!(NSURL);
        let cls_nsdict = class!(NSDictionary);
        let cls_nsarray = class!(NSArray);
        let cls_handler = AnyClass::get(c"VNImageRequestHandler")
            .ok_or_else(|| "VNImageRequestHandler class not found".to_string())?;
        let cls_request = AnyClass::get(c"VNRecognizeTextRequest")
            .ok_or_else(|| "VNRecognizeTextRequest class not found".to_string())?;

        let path_nsstring: *mut AnyObject = msg_send![cls_nsstring, stringWithUTF8String: path_c.as_ptr()];
        let url: *mut AnyObject = msg_send![cls_nsurl, fileURLWithPath: path_nsstring];
        let empty_dict: *mut AnyObject = msg_send![cls_nsdict, dictionary];

        let req_alloc: *mut AnyObject = msg_send![cls_request, alloc];
        let req_raw: *mut AnyObject = msg_send![req_alloc, init];
        let req: Retained<AnyObject> = Retained::from_raw(req_raw)
            .ok_or_else(|| "failed to init VNRecognizeTextRequest".to_string())?;

        // 0 = VNRequestTextRecognitionLevelAccurate
        let _: () = msg_send![&*req, setRecognitionLevel: 0isize];
        let _: () = msg_send![&*req, setUsesLanguageCorrection: Bool::YES];

        if detect_language {
            // Language detection needs macOS 13; older systems have no fallback.
            let detects: Bool =
                msg_send![&*req, respondsToSelector: sel!(setAutomaticallyDetectsLanguage:)];
            if !detects.as_bool() {
                return Ok(String::new());
            }
            let _: () = msg_send![&*req, setAutomaticallyDetectsLanguage: Bool::YES];
        }

        let req_array: *mut AnyObject = msg_send![cls_nsarray, arrayWithObject: &*req];
        let handler_alloc: *mut AnyObject = msg_send![cls_handler, alloc];
        let handler: Retained<AnyObject> = Retained::from_raw(msg_send![
            handler_alloc, initWithURL: url, options: empty_dict
        ])
        .ok_or_else(|| "failed to init VNImageRequestHandler".to_string())?;

        let mut error: *mut AnyObject = std::ptr::null_mut();
        let success: Bool = msg_send![&*handler, performRequests: req_array, error: &mut error];

        if !success.as_bool() {
            return Err("Failed to perform Vision OCR text recognition".to_string());
        }

        let results: *mut AnyObject = msg_send![&*req, results];
        if results.is_null() {
            return Ok(String::new());
        }

        let count: usize = msg_send![results, count];
        let mut extracted = Vec::new();

        for i in 0..count {
            let obs: *mut AnyObject = msg_send![results, objectAtIndex: i];
            let candidates: *mut AnyObject = msg_send![obs, topCandidates: 1usize];
            let cand_count: usize = msg_send![candidates, count];
            if cand_count > 0 {
                let candidate: *mut AnyObject = msg_send![candidates, objectAtIndex: 0usize];
                let text_ns: *mut AnyObject = msg_send![candidate, string];
                let utf8: *const std::ffi::c_char = msg_send![text_ns, UTF8String];
                if !utf8.is_null() {
                    let s = CStr::from_ptr(utf8).to_string_lossy().into_owned();
                    extracted.push(s);
                }
            }
        }

        Ok(extracted.join("\n"))
    })
}

#[cfg(target_os = "macos")]
use objc2::rc::Retained;
#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use std::sync::{Arc, Mutex};

/// One installed double-tap gesture monitor set: FlagsChanged + KeyDown/mouse,
/// each as a global *and* a local NSEvent monitor, plus the modifier kind it
/// watches.
///
/// Global-only is deaf while EiSen is the active app (Apple: global monitors
/// only see events sent to *other* applications). After the overlay
/// `set_focus()` then `hide()`, the hidden overlay stays key — Option taps
/// never reach a global-only install until the user clicks another app.
#[cfg(target_os = "macos")]
pub struct ActiveMonitor {
    pub kind: crate::core::double_tap::ModifierKind,
    pub flags_global: Retained<AnyObject>,
    pub flags_local: Retained<AnyObject>,
    pub keys_global: Retained<AnyObject>,
    pub keys_local: Retained<AnyObject>,
}

#[cfg(target_os = "macos")]
impl ActiveMonitor {
    fn uninstall(self) {
        use objc2_app_kit::NSEvent;
        unsafe {
            NSEvent::removeMonitor(&self.flags_global);
            NSEvent::removeMonitor(&self.flags_local);
            NSEvent::removeMonitor(&self.keys_global);
            NSEvent::removeMonitor(&self.keys_local);
        }
    }
}

/// Process to hand focus back to once the overlay or editor is gone; 0 when
/// EiSen itself was frontmost, so one of its own windows keeps the focus.
#[cfg(target_os = "macos")]
static PREVIOUS_APP_PID: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

#[cfg(any(target_os = "macos", test))]
fn previous_app_pid(frontmost: Option<i32>, own: i32) -> i32 {
    frontmost.filter(|pid| *pid != own).unwrap_or(0)
}

/// Remember the app the user is in. Call before the overlay takes focus.
#[cfg(target_os = "macos")]
pub fn remember_previous_app() {
    use objc2_app_kit::{NSRunningApplication, NSWorkspace};

    let frontmost = NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map(|app| app.processIdentifier());
    let own = NSRunningApplication::currentApplication().processIdentifier();
    PREVIOUS_APP_PID.store(
        previous_app_pid(frontmost, own),
        std::sync::atomic::Ordering::SeqCst,
    );
}

/// Give focus back to the remembered app. Overlay `hide()` leaves EiSen
/// Accessory-active with an invisible key window, and `deactivate` alone leaves
/// that app's windows inactive until the user clicks. Falls back to `deactivate`
/// when the app has quit or EiSen was frontmost. Must run on the main thread.
#[cfg(target_os = "macos")]
pub fn restore_previous_app() {
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSApplicationActivationOptions, NSRunningApplication};

    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let ns_app: Retained<NSApplication> = NSApplication::sharedApplication(mtm);
    let pid = PREVIOUS_APP_PID.load(std::sync::atomic::Ordering::SeqCst);
    let previous = (pid != 0)
        .then(|| NSRunningApplication::runningApplicationWithProcessIdentifier(pid))
        .flatten();
    let Some(previous) = previous else {
        ns_app.deactivate();
        return;
    };
    unsafe {
        // macOS 14 only honors an activation the active app has yielded.
        let ns_app_obj: &AnyObject = &ns_app;
        let can_yield: Bool =
            msg_send![ns_app_obj, respondsToSelector: sel!(yieldActivationToApplication:)];
        if can_yield.as_bool() {
            let _: () = msg_send![ns_app_obj, yieldActivationToApplication: &*previous];
        }
    }
    previous.activateWithOptions(NSApplicationActivationOptions::empty());
}

/// All live NSEvent gesture-monitor token pairs. `Retained<AnyObject>` is
/// !Send/!Sync; this wrapper is sound because EVERY access — install, remove,
/// drop — happens inside a `run_on_main_thread` closure (monitors are
/// main-thread objects).
#[cfg(target_os = "macos")]
pub struct MonitorRegistry(std::sync::Mutex<Vec<ActiveMonitor>>);

#[cfg(target_os = "macos")]
impl MonitorRegistry {
    pub fn new() -> Self {
        Self(std::sync::Mutex::new(Vec::new()))
    }

    /// Poison-safe lock (exemplar style from core/capture.rs).
    fn lock(&self) -> std::sync::MutexGuard<'_, Vec<ActiveMonitor>> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(target_os = "macos")]
impl Default for MonitorRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// SAFETY: `Retained<AnyObject>` monitor tokens are main-thread objects, but
// every read, write and drop of the guarded Vec happens inside a
// `run_on_main_thread` closure (see `apply_monitor_action`), so no token ever
// crosses a thread boundary. The `Arc<Mutex<..>>` wrapper only shuttles the
// registry handle across the scheduling boundary; the tokens stay put.
#[cfg(target_os = "macos")]
unsafe impl Send for MonitorRegistry {}
#[cfg(target_os = "macos")]
unsafe impl Sync for MonitorRegistry {}

/// Install global + local FlagsChanged and KeyDown/mouse monitors sharing one
/// state machine. Must run on the main thread.
#[cfg(target_os = "macos")]
fn install_monitor(
    app: tauri::AppHandle,
    target: crate::core::double_tap::ModifierKind,
) -> Result<ActiveMonitor, String> {
    use crate::core::capture;
    use crate::core::double_tap::ModifierStateMachine;
    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags};
    use std::ptr::NonNull;
    use std::time::Instant;

    let state = Arc::new(Mutex::new(ModifierStateMachine::new(target)));

    let consider_flags = {
        let state = Arc::clone(&state);
        let app_handle = app.clone();
        move |event: NonNull<NSEvent>| {
            let evt = unsafe { event.as_ref() };
            let flags = evt.modifierFlags();
            let now = Instant::now();
            let is_option = flags.contains(NSEventModifierFlags::Option);
            let is_shift = flags.contains(NSEventModifierFlags::Shift);
            let triggered = match target {
                crate::core::double_tap::ModifierKind::OptionKey => {
                    let mut sm = state.lock().unwrap_or_else(|e| e.into_inner());
                    sm.on_modifier_event(
                        crate::core::double_tap::ModifierKind::OptionKey,
                        is_option,
                        now,
                    )
                }
                crate::core::double_tap::ModifierKind::ShiftKey => {
                    let mut sm = state.lock().unwrap_or_else(|e| e.into_inner());
                    sm.on_modifier_event(
                        crate::core::double_tap::ModifierKind::ShiftKey,
                        is_shift,
                        now,
                    )
                }
                _ => false,
            };
            if triggered {
                eprintln!("[eisen] double-tap modifier detected — launching capture!");
                let app_handle = app_handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = capture::begin_capture(&app_handle);
                });
            }
        }
    };
    let consider_flags_global = consider_flags.clone();
    let consider_flags_local = consider_flags;

    let mask_flags = NSEventMask::FlagsChanged;
    let block_flags_global = RcBlock::new(move |event: NonNull<NSEvent>| {
        consider_flags_global(event);
    });
    let flags_global =
        NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask_flags, &block_flags_global)
            .ok_or_else(|| "failed to install FlagsChanged global event monitor".to_string())?;

    let block_flags_local = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        consider_flags_local(event);
        // Continue dispatch: swallowing Option would break focused EiSen windows.
        event.as_ptr()
    });
    // SAFETY: the handler returns the same event pointer it received.
    let flags_local = match unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask_flags, &block_flags_local)
    } {
        Some(token) => token,
        None => {
            unsafe { NSEvent::removeMonitor(&flags_global) };
            return Err("failed to install FlagsChanged local event monitor".to_string());
        }
    };

    let mask_keys = NSEventMask::KeyDown | NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown;
    let state_keys_global = Arc::clone(&state);
    let block_keys_global = RcBlock::new(move |_event: NonNull<NSEvent>| {
        let mut sm = state_keys_global.lock().unwrap_or_else(|e| e.into_inner());
        sm.on_other_key_down();
    });
    let keys_global =
        match NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask_keys, &block_keys_global) {
            Some(token) => token,
            None => {
                unsafe {
                    NSEvent::removeMonitor(&flags_global);
                    NSEvent::removeMonitor(&flags_local);
                }
                return Err("failed to install KeyDown global event monitor".to_string());
            }
        };

    let state_keys_local = Arc::clone(&state);
    let block_keys_local = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let mut sm = state_keys_local.lock().unwrap_or_else(|e| e.into_inner());
        sm.on_other_key_down();
        event.as_ptr()
    });
    // SAFETY: the handler returns the same event pointer it received.
    let keys_local = match unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask_keys, &block_keys_local)
    } {
        Some(token) => token,
        None => {
            unsafe {
                NSEvent::removeMonitor(&flags_global);
                NSEvent::removeMonitor(&flags_local);
                NSEvent::removeMonitor(&keys_global);
            }
            return Err("failed to install KeyDown local event monitor".to_string());
        }
    };

    Ok(ActiveMonitor {
        kind: target,
        flags_global,
        flags_local,
        keys_global,
        keys_local,
    })
}

/// Apply a preset-transition decision to the gesture monitors. Safe to call
/// from any thread: all install/remove work runs inside a
/// `run_on_main_thread` closure because AppKit monitor objects must be created
/// and removed on the main thread (`save_config` runs on a Tauri command
/// thread).
///
/// Ordering note: for `Add`/`Replace` the NEW pair is installed BEFORE the old
/// tokens are removed, so a failed install leaves the previous gesture working
/// instead of leaving the app gesture-less.
#[cfg(target_os = "macos")]
pub fn apply_monitor_action(
    app: &tauri::AppHandle,
    registry: &std::sync::Arc<std::sync::Mutex<MonitorRegistry>>,
    action: crate::core::hotkey::MonitorAction,
) {
    use crate::core::hotkey::MonitorAction;

    let scheduler = app.clone();
    let app_handle = app.clone();
    let registry = std::sync::Arc::clone(registry);
    let scheduled =
        scheduler.run_on_main_thread(move || {
            let registry = registry.lock().unwrap_or_else(|e| e.into_inner());
            let mut monitors = registry.lock();

            match action {
                // Add and Replace share one path: install new first, then
                // retire every pre-existing entry (a no-op drain for Add).
                MonitorAction::Add(kind) | MonitorAction::Replace(kind) => {
                    match install_monitor(app_handle, kind) {
                        Ok(monitor) => {
                            let retired = std::mem::take(&mut *monitors);
                            monitors.push(monitor);
                            for m in retired {
                                m.uninstall();
                            }
                        }
                        Err(e) => {
                            eprintln!(
                                "[eisen] gesture monitor install failed, keeping existing monitors: {e}"
                            );
                        }
                    }
                }
                MonitorAction::RemoveAll => {
                    let retired = std::mem::take(&mut *monitors);
                    for m in retired {
                        m.uninstall();
                    }
                }
            }
        });
    if let Err(e) = scheduled {
        eprintln!("[eisen] failed to schedule gesture monitor update on main thread: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::screen_index_containing;

    #[test]
    fn screen_index_containing_picks_the_second_of_two_disjoint_frames() {
        let frames = [(0.0, 0.0, 100.0, 100.0), (200.0, 0.0, 100.0, 100.0)];
        assert_eq!(screen_index_containing((250.0, 50.0), &frames), 1);
    }

    #[test]
    fn screen_index_containing_falls_back_to_zero_when_point_is_in_no_frame() {
        let frames = [(0.0, 0.0, 100.0, 100.0), (200.0, 0.0, 100.0, 100.0)];
        assert_eq!(screen_index_containing((150.0, 50.0), &frames), 0);
    }
}




#[cfg(test)]
mod focus_tests {
    use super::previous_app_pid;

    #[test]
    fn remembers_another_app() {
        assert_eq!(previous_app_pid(Some(42), 7), 42);
    }

    #[test]
    fn keeps_focus_inside_eisen_when_it_was_frontmost() {
        assert_eq!(previous_app_pid(Some(7), 7), 0);
        assert_eq!(previous_app_pid(None, 7), 0);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod ocr_tests {
    use super::extract_text_from_image_path;
    use std::path::Path;

    fn ocr_fixture(name: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name);
        extract_text_from_image_path(&path).expect("OCR should run on the fixture")
    }

    #[test]
    fn keeps_short_vietnamese_on_the_default_request() {
        assert_eq!(ocr_fixture("ocr-vi-short.png"), "Đã lưu ảnh");
    }

    #[test]
    fn falls_back_to_language_detection_for_japanese() {
        assert!(ocr_fixture("ocr-ja.png").contains("東京"));
    }
}
