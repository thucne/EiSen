use crate::domain::region::{LogicalRect, PixelRect};
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub trait ScreenProvider: Send + Sync {
    fn capture_display(&self, display: u32, out: &Path) -> Result<(), String>;
    fn active_display(&self) -> u32;
    /// Backing scale of the display `active_display` selected. Default 1.0
    /// keeps stub tests pixel-sized unless they call `set_scale`.
    fn active_scale(&self) -> f64 {
        1.0
    }
}

fn crop_png(src: &Path, rect: &PixelRect, out: &Path) -> Result<(), String> {
    let mut img = image::open(src).map_err(|e| e.to_string())?;
    let (w, h) = (img.width(), img.height());
    let left = rect.left.min(w.saturating_sub(1));
    let top = rect.top.min(h.saturating_sub(1));
    let width = rect.width.min(w - left).max(1);
    let height = rect.height.min(h - top).max(1);
    img.crop(left, top, width, height)
        .save(out)
        .map_err(|e| e.to_string())?;
    restrict_permissions(out);
    Ok(())
}

/// Restrict a freshly-written capture file to owner-only access
/// (best-effort: a chmod failure must never fail the capture itself).
#[cfg(unix)]
pub(crate) fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
pub(crate) fn restrict_permissions(_path: &Path) {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureError {
    Busy,
    CapturedAlready,
    Io(String),
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CaptureError::Busy => write!(f, "a capture is already in progress"),
            CaptureError::CapturedAlready => write!(f, "no capture in progress to finish"),
            CaptureError::Io(e) => write!(f, "capture failed: {e}"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CaptureResult {
    Ok,
    Err(CaptureError),
}

pub struct CaptureHandle;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CaptureSession {
    pub path: PathBuf,
    pub rect: LogicalRect,
    pub scale: f64,
}

pub struct CaptureOrchestrator {
    provider: Arc<dyn ScreenProvider>,
    busy: AtomicBool,
    /// Exclusive claim for `finish` so two concurrent croppers cannot both
    /// run. Unlike `busy`, this is released on crop Io so overlay retry can
    /// call `finish` again while the session stays busy.
    finishing: AtomicBool,
    /// Entry claim for a capture trigger (`begin_capture`). Trigger sites
    /// (hotkey, tray, command) can run concurrently on worker threads; this
    /// flag serializes them so only one runs the stale-busy recovery +
    /// `start()` sequence at a time.
    entering: AtomicBool,
    last: Mutex<Option<(PathBuf, LogicalRect, f64)>>,
    screen: Mutex<Option<PixelRect>>,
}

impl CaptureOrchestrator {
    pub fn new(provider: impl ScreenProvider + 'static) -> Self {
        CaptureOrchestrator {
            provider: Arc::new(provider),
            busy: AtomicBool::new(false),
            finishing: AtomicBool::new(false),
            entering: AtomicBool::new(false),
            last: Mutex::new(None),
            screen: Mutex::new(None),
        }
    }

    /// Try to become the single holder of the capture-trigger entry claim.
    /// Returns `true` exactly when no other trigger is being processed.
    fn try_claim_trigger(&self) -> bool {
        !self.entering.swap(true, Ordering::SeqCst)
    }

    /// Release the capture-trigger entry claim (also done by
    /// [`TriggerClaimGuard`] on drop).
    fn release_trigger(&self) {
        self.entering.store(false, Ordering::SeqCst);
    }

    fn lock_last(&self) -> std::sync::MutexGuard<'_, Option<(PathBuf, LogicalRect, f64)>> {
        self.last.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn lock_screen(&self) -> std::sync::MutexGuard<'_, Option<PixelRect>> {
        self.screen.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    pub fn active_scale(&self) -> f64 {
        self.provider.active_scale()
    }

    pub fn start(&self) -> Result<CaptureHandle, CaptureError> {
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err(CaptureError::Busy);
        }
        let old = self.lock_last().take();
        if let Some((path, _, _)) = old {
            let _ = std::fs::remove_file(&path);
        }
        let path = temp_capture_path("full");
        let display = self.provider.active_display();
        match self.provider.capture_display(display, &path) {
            Ok(()) => {
                let png_header_started = Instant::now();
                let size = png_dimensions(&path).map(|(w, h)| PixelRect {
                    left: 0,
                    top: 0,
                    width: w,
                    height: h,
                });
                if cfg!(debug_assertions) {
                    eprintln!(
                        "[eisen:timing] png header: {}ms",
                        png_header_started.elapsed().as_millis()
                    );
                }
                *self.lock_screen() = size;
                *self.lock_last() = Some((
                    path,
                    LogicalRect {
                        left: 0.0,
                        top: 0.0,
                        width: 0.0,
                        height: 0.0,
                    },
                    1.0,
                ));
                Ok(CaptureHandle)
            }
            Err(e) => {
                self.busy.store(false, Ordering::SeqCst);
                let _ = std::fs::remove_file(&path);
                Err(CaptureError::Io(e))
            }
        }
    }

    pub fn finish(&self, rect: LogicalRect) -> Result<CaptureSession, CaptureError> {
        // Claim single-flight crop ownership without clearing `busy`. Losers
        // (and callers with no live session) get CapturedAlready; overlay
        // retry after crop Io can CAS again because we release `finishing`
        // on Io while leaving `busy` set.
        if self
            .finishing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(CaptureError::CapturedAlready);
        }
        if !self.is_busy() {
            self.finishing.store(false, Ordering::SeqCst);
            return Err(CaptureError::CapturedAlready);
        }
        let Some((full_path, _, scale)) = self.lock_last().clone() else {
            self.finishing.store(false, Ordering::SeqCst);
            self.busy.store(false, Ordering::SeqCst);
            return Err(CaptureError::CapturedAlready);
        };

        let mut rect = rect;
        // Clamp to the captured display's bounds so a selection dragged past
        // the display edge never produces an out-of-bounds rect. Clamping
        // happens in logical (point) space.
        if let Some(bounds) = *self.lock_screen() {
            let logical_bounds = LogicalRect {
                left: 0.0,
                top: 0.0,
                width: bounds.width as f64 / scale,
                height: bounds.height as f64 / scale,
            };
            rect = rect.clamp_to(logical_bounds);
        }
        let out = temp_capture_path("region");
        let px = rect.scale(scale);

        let crop_started = Instant::now();
        if let Err(e) = crop_png(&full_path, &px, &out) {
            self.finishing.store(false, Ordering::SeqCst);
            let _ = std::fs::remove_file(&out);
            return Err(CaptureError::Io(e));
        }
        if cfg!(debug_assertions) {
            eprintln!(
                "[eisen:timing] crop_png: {}ms",
                crop_started.elapsed().as_millis()
            );
        }

        self.busy.store(false, Ordering::SeqCst);
        self.finishing.store(false, Ordering::SeqCst);
        let old = self.lock_last().replace((out.clone(), rect, scale));
        if let Some((path, _, _)) = old {
            let _ = std::fs::remove_file(&path);
        }
        Ok(CaptureSession {
            path: out,
            rect,
            scale,
        })
    }

    pub fn cancel(&self) {
        self.finishing.store(false, Ordering::SeqCst);
        self.busy.store(false, Ordering::SeqCst);
        let old = self.lock_last().take();
        if let Some((path, _, _)) = old {
            let _ = std::fs::remove_file(&path);
        }
    }

    /// Record the display scale factor for converting logical rects to pixels.
    pub fn set_scale(&self, scale: f64) {
        if let Some((_, _, s)) = self.lock_last().as_mut() {
            *s = scale;
        }
    }

    pub fn last(&self) -> Option<(PathBuf, LogicalRect, f64)> {
        self.lock_last().clone()
    }

    /// Reopen an existing image (e.g. from the session history) as the current
    /// session. The source is copied to a fresh temp file so the
    /// orchestrator's temp-file lifecycle (deleted on the next `start` or
    /// `cancel`) never touches the user's original file. The region is set
    /// from the image's pixel dimensions at scale 1.0 so the editor canvas
    /// sizes correctly.
    pub fn reopen(&self, src: &Path) -> Result<(), String> {
        if !src.is_file() {
            return Err(format!("capture file no longer exists: {}", src.display()));
        }
        if self.is_busy() {
            return Err(
                "a capture is in progress; finish or cancel it before reopening".to_string(),
            );
        }
        let out = temp_capture_path("reopen");
        // `fs::copy` replicates the SOURCE mode, so a world-readable saved
        // capture would otherwise reintroduce 0644 into $TMPDIR.
        std::fs::copy(src, &out).map_err(|e| format!("failed to copy capture: {e}"))?;
        restrict_permissions(&out);
        let (w, h) = png_dimensions(&out).unwrap_or((1, 1));
        self.busy.store(false, Ordering::SeqCst);
        let old = self.lock_last().replace((
            out.clone(),
            LogicalRect {
                left: 0.0,
                top: 0.0,
                width: w as f64,
                height: h as f64,
            },
            1.0,
        ));
        if let Some((path, _, _)) = old {
            let _ = std::fs::remove_file(&path);
        }
        Ok(())
    }
}

/// RAII token holding the capture-trigger entry claim. Releasing on drop
/// guarantees the claim is freed on every early-return path.
struct TriggerClaimGuard<'a> {
    orchestrator: &'a CaptureOrchestrator,
}

impl<'a> TriggerClaimGuard<'a> {
    fn acquire(orchestrator: &'a CaptureOrchestrator) -> Option<Self> {
        if orchestrator.try_claim_trigger() {
            Some(TriggerClaimGuard { orchestrator })
        } else {
            None
        }
    }
}

impl Drop for TriggerClaimGuard<'_> {
    fn drop(&mut self) {
        self.orchestrator.release_trigger();
    }
}

/// Begin a capture session: captures the whole active display to a temp PNG,
/// shows the overlay window and emits `capture-ready` with the image path.
///
/// Shared by the `cmd_begin_capture` command, the global hotkey and the
/// tray's "Capture now" item, so all three trigger the same path.
pub fn begin_capture(app: &tauri::AppHandle) -> Result<String, String> {
    use tauri::{Emitter, Manager};
    if let Some(editor) = app.get_webview_window("editor") {
        let _ = editor.unminimize();
        let _ = editor.show();
        let _ = editor.set_focus();
        return Err("editor is open; finish or close it before a new capture".to_string());
    }
    let orchestrator = app.state::<Arc<CaptureOrchestrator>>();
    // Serialize entry: trigger sites may run concurrently on worker threads,
    // so a second trigger must short-circuit instead of racing through the
    // stale-busy recovery branch against another task's in-flight `start()`.
    let Some(_claim) = TriggerClaimGuard::acquire(&orchestrator) else {
        return Err("a capture trigger is already being processed".to_string());
    };
    if orchestrator.is_busy() {
        if let Some(overlay) = app.get_webview_window("overlay") {
            if !overlay.is_visible().unwrap_or(false) {
                orchestrator.cancel();
            }
        }
    }
    let hide_started = Instant::now();
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    if cfg!(debug_assertions) {
        eprintln!(
            "[eisen:timing] overlay hide: {}ms",
            hide_started.elapsed().as_millis()
        );
    }
    let start_started = Instant::now();
    orchestrator.start().map_err(|e| e.to_string())?;
    if cfg!(debug_assertions) {
        eprintln!(
            "[eisen:timing] orchestrator.start: {}ms",
            start_started.elapsed().as_millis()
        );
    }
    // Scale of the display that was just captured (cursor's screen), not
    // the primary monitor — otherwise a Retina laptop + 1x external crops
    // with the wrong pixel rect.
    let scale_started = Instant::now();
    let scale = orchestrator.active_scale();
    if cfg!(debug_assertions) {
        eprintln!(
            "[eisen:timing] scale lookup: {}ms",
            scale_started.elapsed().as_millis()
        );
    }
    orchestrator.set_scale(scale);
    let (path, _, _) = orchestrator
        .last()
        .ok_or_else(|| "capture did not produce an image".to_string())?;
    let path = path.to_string_lossy().to_string();
    if let Some(overlay) = app.get_webview_window("overlay") {
        // begin_capture may run on a worker thread now; AppKit elevation is
        // main-thread-only (MainThreadMarker::new() returns None elsewhere),
        // so route it through the event loop.
        #[cfg(target_os = "macos")]
        {
            let ov = overlay.clone();
            let _ = app.run_on_main_thread(move || {
                crate::platform::mac_adapter::elevate_overlay_window(&ov);
            });
        }
        let _ = overlay.show();
        let _ = overlay.set_focus();
        let emit_started = Instant::now();
        let _ = overlay.emit_to(
            tauri::EventTarget::webview_window("overlay"),
            "capture-ready",
            path.clone(),
        );
        if cfg!(debug_assertions) {
            eprintln!(
                "[eisen:timing] capture-ready emit: {}ms",
                emit_started.elapsed().as_millis()
            );
        }
    }
    Ok(path)
}

/// Capture the entire display and show it in the overlay with the full screen
/// pre-selected, giving the user the same Copy/Edit/Save/OCR/Discard toolbar
/// as a crop capture — triggered by Ctrl+Shift+3.
pub fn begin_fullscreen_capture(app: &tauri::AppHandle) -> Result<String, String> {
    use tauri::{Emitter, Manager};

    // Re-use the normal begin_capture path: this captures the display, stores
    // it in the orchestrator, shows the overlay, and emits `capture-ready`.
    let path = begin_capture(app)?;

    // After the overlay has the image, emit `fullscreen-ready` so the frontend
    // can auto-select the entire viewport and show the toolbar immediately.
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.emit_to(
            tauri::EventTarget::webview_window("overlay"),
            "fullscreen-ready",
            (),
        );
    }

    Ok(path)
}


pub(crate) fn temp_capture_path(kind: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // `SystemTime` is only microsecond-granular on some platforms; the
    // monotonic suffix keeps names unique when captures race (e.g. tests).
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    crate::domain::path_guard::session_temp_dir().join(format!("eisen-{kind}-{nanos}-{seq}.png"))
}

static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn sweep_eisen_pngs(dir: &Path) {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("eisen-") && name.ends_with(".png") {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
}

/// Sweep `$TMPDIR/eisen/` and remove leftover `eisen-*.png` files. Also
/// removes matching names in `$TMPDIR` itself so upgrades from builds that
/// wrote session PNGs next to the eisen directory do not leave leftovers.
pub fn cleanup_stale_temp_files() {
    sweep_eisen_pngs(&crate::domain::path_guard::session_temp_dir());
    sweep_eisen_pngs(&std::env::temp_dir());
}

/// Read the pixel dimensions from a PNG header without decoding the image.
pub(crate) fn png_dimensions(path: &Path) -> Option<(u32, u32)> {
    image::ImageReader::open(path).ok()?.into_dimensions().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct StubProvider;

    impl StubProvider {
        fn new() -> Self {
            StubProvider
        }

        fn write_png(out: &Path) -> Result<(), String> {
            image::RgbaImage::new(200, 100)
                .save(out)
                .map_err(|e| e.to_string())
        }
    }

    impl ScreenProvider for StubProvider {
        fn capture_display(&self, _display: u32, out: &Path) -> Result<(), String> {
            Self::write_png(out)
        }

        fn active_display(&self) -> u32 {
            0
        }
    }

    #[test]
    fn single_flight() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        let r = o.start();
        assert!(r.is_ok());
        assert!(matches!(o.start(), Err(CaptureError::Busy)));
    }

    #[test]
    fn finish_returns_session_and_clears_busy() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        assert!(o.start().is_ok());
        assert!(o.is_busy());
        let rect = LogicalRect {
            left: 10.0,
            top: 20.0,
            width: 30.0,
            height: 20.0,
        };
        let session = o.finish(rect).expect("finish should succeed");
        assert!(!o.is_busy());
        assert_eq!(session.rect, rect);
        assert_eq!(session.scale, 1.0);
        assert!(session.path.exists());
        let _ = std::fs::remove_file(&session.path);
    }

    #[test]
    fn finish_crop_io_keeps_busy_and_allows_retry() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        assert!(o.start().is_ok());
        let (full_path, _, _) = o.last().expect("full capture path");
        let backup = std::fs::read(&full_path).expect("read full capture");
        std::fs::write(&full_path, b"").expect("corrupt full capture");
        let rect = LogicalRect {
            left: 0.0,
            top: 0.0,
            width: 10.0,
            height: 10.0,
        };
        let err = o.finish(rect).expect_err("crop should fail on a non-image");
        assert!(matches!(err, CaptureError::Io(_)), "got {err:?}");
        assert!(
            o.is_busy(),
            "busy must stay true after crop Io so overlay retry can finish"
        );
        let (still, _, _) = o.last().expect("last must remain the full PNG");
        assert_eq!(still, full_path);
        assert!(full_path.exists(), "full capture must not be deleted on crop Io");
        std::fs::write(&full_path, backup).expect("restore full capture");
        let session = o.finish(rect).expect("retry finish should succeed");
        assert!(!o.is_busy());
        assert!(session.path.exists());
        let _ = std::fs::remove_file(&session.path);
    }

    #[test]
    fn concurrent_finish_single_flight() {
        let o = std::sync::Arc::new(CaptureOrchestrator::new(StubProvider::new()));
        assert!(o.start().is_ok());
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let o = std::sync::Arc::clone(&o);
                std::thread::spawn(move || {
                    o.finish(LogicalRect {
                        left: 0.0,
                        top: 0.0,
                        width: 10.0,
                        height: 10.0,
                    })
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().expect("no panic")).collect();
        let oks: Vec<_> = results.iter().filter_map(|r| r.as_ref().ok()).collect();
        assert_eq!(
            oks.len(),
            1,
            "exactly one concurrent finisher may win"
        );
        assert!(
            results
                .iter()
                .filter(|r| matches!(r, Err(CaptureError::CapturedAlready)))
                .count()
                == 1
        );
        assert!(oks[0].path.exists(), "the winning session file must survive");
        assert!(!o.is_busy());
        let _ = std::fs::remove_file(&oks[0].path);
    }

    #[test]
    fn concurrent_trigger_claims_single_flight() {
        let o = std::sync::Arc::new(CaptureOrchestrator::new(StubProvider::new()));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let o = std::sync::Arc::clone(&o);
                std::thread::spawn(move || o.try_claim_trigger())
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().expect("no panic")).collect();
        assert_eq!(
            results.iter().filter(|won| **won).count(),
            1,
            "exactly one concurrent trigger may win the entry claim"
        );
        // The claim must not leak into capture state...
        assert!(!o.is_busy());
        assert!(o.last().is_none());
        // ...and releasing it lets the next trigger proceed.
        o.release_trigger();
        assert!(o.try_claim_trigger(), "a released claim must be re-acquirable");
        o.release_trigger();
    }

    #[test]
    fn trigger_claim_guard_releases_on_drop() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        {
            let _guard = TriggerClaimGuard::acquire(&o).expect("first claim");
            assert!(
                !o.try_claim_trigger(),
                "the claim must be exclusive while the guard is held"
            );
        }
        assert!(
            o.try_claim_trigger(),
            "dropping the guard must release the claim"
        );
        o.release_trigger();
    }

    #[test]
    fn cancel_clears_busy() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        assert!(o.start().is_ok());
        o.cancel();
        assert!(!o.is_busy());
        assert!(o.last().is_none());
        let rect = LogicalRect {
            left: 0.0,
            top: 0.0,
            width: 10.0,
            height: 10.0,
        };
        assert!(matches!(
            o.finish(rect),
            Err(CaptureError::CapturedAlready)
        ));
    }

    #[test]
    fn finish_clamps_region_to_screen_bounds() {
        let provider = StubProvider::new();
        let o = CaptureOrchestrator::new(provider);
        assert!(o.start().is_ok());
        let rect = LogicalRect {
            left: 150.0,
            top: 50.0,
            width: 200.0,
            height: 200.0,
        };
        let session = o.finish(rect).expect("finish should succeed");
        assert_eq!(
            session.rect,
            LogicalRect {
                left: 150.0,
                top: 50.0,
                width: 50.0,
                height: 50.0,
            }
        );
        assert!(session.path.exists());
        let _ = std::fs::remove_file(&session.path);
    }

    #[test]
    fn finish_passes_logical_rect_unscaled_to_provider_at_retina_scale() {
        let provider = StubProvider::new();
        let o = CaptureOrchestrator::new(provider);
        assert!(o.start().is_ok());
        o.set_scale(2.0);
        let rect = LogicalRect {
            left: 20.0,
            top: 10.0,
            width: 50.0,
            height: 30.0,
        };
        let session = o.finish(rect).expect("finish should succeed");
        assert_eq!(
            session.rect,
            LogicalRect {
                left: 20.0,
                top: 10.0,
                width: 50.0,
                height: 30.0,
            }
        );
        assert_eq!(session.scale, 2.0);
        assert!(session.path.exists());
        let _ = std::fs::remove_file(&session.path);
    }

    #[test]
    fn reopen_copies_source_and_sets_session() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        assert!(o.start().is_ok());
        o.cancel();
        let src = std::env::temp_dir().join("eisen-reopen-src.png");
        image::RgbaImage::new(30, 20).save(&src).unwrap();
        o.reopen(&src).expect("reopen should succeed");
        let (path, rect, scale) = o.last().expect("last session");
        assert_eq!(rect, LogicalRect { left: 0.0, top: 0.0, width: 30.0, height: 20.0 });
        assert_eq!(scale, 1.0);
        assert_ne!(path, src, "reopen must copy, not reuse the source file");
        assert!(path.exists());
        assert!(src.exists(), "the source file must be untouched");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(&src);
    }

    #[test]
    fn reopen_missing_source_errors() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        let missing = std::env::temp_dir().join("eisen-reopen-missing.png");
        assert!(o.reopen(&missing).is_err());
        assert!(o.last().is_none());
    }

    #[test]
    fn reopen_rejects_while_busy_and_keeps_last() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        assert!(o.start().is_ok());
        let (live_path, _, _) = o.last().expect("full capture path");
        assert!(live_path.exists());
        let src = std::env::temp_dir().join("eisen-reopen-busy-src.png");
        image::RgbaImage::new(16, 16).save(&src).unwrap();
        let err = o.reopen(&src).expect_err("reopen while busy");
        assert!(
            err.contains("in progress"),
            "error should mention in progress, got: {err}"
        );
        let (still, _, _) = o.last().expect("last must survive");
        assert_eq!(still, live_path);
        assert!(live_path.exists(), "live full capture must not be deleted");
        assert!(o.is_busy());
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&live_path);
    }

    #[test]
    fn temp_capture_path_parent_is_eisen_session_dir() {
        let path = temp_capture_path("full");
        let parent = path.parent().expect("parent");
        assert_eq!(parent.file_name().and_then(|n| n.to_str()), Some("eisen"));
        assert_eq!(parent, crate::domain::path_guard::session_temp_dir());
    }

    #[test]
    #[cfg(unix)]
    fn session_temp_dir_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::domain::path_guard::session_temp_dir();
        let mode = std::fs::metadata(&dir)
            .expect("session dir metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700, "the eisen session dir must be 0700");
    }

    #[test]
    fn sweep_eisen_pngs_deletes_matching_names_only() {
        let dir = tempfile::tempdir().expect("tempdir");
        let stale = dir.path().join("eisen-stale-cleanup.png");
        let keep = dir.path().join("not-a-session.png");
        std::fs::write(&stale, b"png").expect("plant stale png");
        std::fs::write(&keep, b"keep").expect("plant unrelated file");
        sweep_eisen_pngs(dir.path());
        assert!(!stale.exists(), "eisen-*.png in the swept dir must go");
        assert!(keep.exists(), "non-matching names must survive");
    }

    #[test]
    #[cfg(unix)]
    fn temp_files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let o = CaptureOrchestrator::new(StubProvider::new());
        assert!(o.start().is_ok());
        let rect = LogicalRect {
            left: 10.0,
            top: 20.0,
            width: 30.0,
            height: 20.0,
        };
        let session = o.finish(rect).expect("finish should succeed");
        let mode = std::fs::metadata(&session.path)
            .expect("session metadata")
            .permissions()
            .mode();
        assert_eq!(
            mode & 0o777,
            0o600,
            "the session temp PNG must be owner-only"
        );
        let _ = std::fs::remove_file(&session.path);
    }

    #[test]
    fn temp_files_are_cleaned_up() {
        let o = CaptureOrchestrator::new(StubProvider::new());
        assert!(o.start().is_ok());
        let (full, _, _) = o.last().expect("full capture path");
        let session = o
            .finish(LogicalRect {
                left: 0.0,
                top: 0.0,
                width: 50.0,
                height: 50.0,
            })
            .expect("finish should succeed");
        assert!(
            !full.exists(),
            "finish should delete the full-display temp PNG"
        );
        assert!(session.path.exists());
        assert!(o.start().is_ok());
        assert!(
            !session.path.exists(),
            "the next start should delete the previous region temp PNG"
        );
        o.cancel();
        assert!(o.last().is_none(), "cancel should drop the temp PNG");
    }
}
