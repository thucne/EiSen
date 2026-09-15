use crate::core::capture::ScreenProvider;
use std::path::Path;

pub struct WindowsAdapter;

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct ActiveScreen {
    display: u32,
    scale: f64,
}

#[cfg(target_os = "windows")]
static LAST_ACTIVE: std::sync::Mutex<Option<ActiveScreen>> = std::sync::Mutex::new(None);

#[cfg(target_os = "windows")]
fn get_cursor_pos() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT::default();
    unsafe {
        if GetCursorPos(&mut pt).is_ok() {
            Some((pt.x, pt.y))
        } else {
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn resolve_active_screen() -> ActiveScreen {
    let monitors = xcap::Monitor::all().unwrap_or_default();
    if monitors.is_empty() {
        return ActiveScreen {
            display: 0,
            scale: 1.0,
        };
    }

    let mut selected_idx = 0;
    if let Some((cx, cy)) = get_cursor_pos() {
        for (i, m) in monitors.iter().enumerate() {
            let mx = m.x().unwrap_or(0);
            let my = m.y().unwrap_or(0);
            let mw = m.width().unwrap_or(0) as i32;
            let mh = m.height().unwrap_or(0) as i32;
            if cx >= mx && cx < mx + mw && cy >= my && cy < my + mh {
                selected_idx = i;
                break;
            }
        }
    }

    let scale = monitors
        .get(selected_idx)
        .and_then(|m| m.scale_factor().ok())
        .map(|s| s as f64)
        .unwrap_or(1.0);

    ActiveScreen {
        display: selected_idx as u32,
        scale,
    }
}

#[cfg(target_os = "windows")]
fn resolve_and_store() -> ActiveScreen {
    let screen = resolve_active_screen();
    *LAST_ACTIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(screen);
    screen
}

/// 0-based index of the display selected by the cursor during the last capture.
#[cfg(target_os = "windows")]
pub fn active_display_index() -> Option<usize> {
    LAST_ACTIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|s| s.display as usize)
}

#[cfg(target_os = "windows")]
impl ScreenProvider for WindowsAdapter {
    fn capture_display(&self, display: u32, out: &Path) -> Result<(), String> {
        let monitors = xcap::Monitor::all().map_err(|e| format!("failed to query monitors: {e}"))?;
        let monitor = monitors
            .get(display as usize)
            .or_else(|| monitors.first())
            .ok_or_else(|| "no monitors found".to_string())?;

        let img = monitor
            .capture_image()
            .map_err(|e| format!("failed to capture screen: {e}"))?;

        img.save(out)
            .map_err(|e| format!("failed to save capture image to disk: {e}"))?;

        crate::core::capture::restrict_permissions(out);
        Ok(())
    }

    fn active_display(&self) -> u32 {
        resolve_and_store().display
    }

    fn active_scale(&self) -> f64 {
        LAST_ACTIVE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|s| s.scale)
            .unwrap_or_else(|| resolve_and_store().scale)
    }
}

#[cfg(not(target_os = "windows"))]
impl ScreenProvider for WindowsAdapter {
    fn capture_display(&self, _display: u32, _out: &Path) -> Result<(), String> {
        Err("WindowsAdapter is only supported on Windows".to_string())
    }

    fn active_display(&self) -> u32 {
        0
    }
}

/// Extract text from an image file using native Windows.Media.Ocr engine.
#[cfg(target_os = "windows")]
pub async fn extract_text_from_image_path(path: &Path) -> Result<String, String> {
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};

    let bytes = std::fs::read(path).map_err(|e| format!("failed to read image file: {e}"))?;

    let stream = InMemoryRandomAccessStream::new()
        .map_err(|e| format!("failed to create in-memory stream: {e}"))?;

    let writer = DataWriter::CreateDataWriter(&stream)
        .map_err(|e| format!("failed to create data writer: {e}"))?;
    writer
        .WriteBytes(&bytes)
        .map_err(|e| format!("failed to write image bytes: {e}"))?;
    writer
        .StoreAsync()
        .map_err(|e| format!("failed to store stream: {e}"))?
        .await
        .map_err(|e| format!("stream store failed: {e}"))?;
    writer
        .DetachStream()
        .map_err(|e| format!("failed to detach stream: {e}"))?;
    stream
        .Seek(0)
        .map_err(|e| format!("failed to seek stream to 0: {e}"))?;

    let decoder = BitmapDecoder::CreateAsync(&stream)
        .map_err(|e| format!("failed to create bitmap decoder: {e}"))?
        .await
        .map_err(|e| format!("bitmap decoder creation failed: {e}"))?;

    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .map_err(|e| format!("failed to get software bitmap: {e}"))?
        .await
        .map_err(|e| format!("software bitmap decode failed: {e}"))?;

    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| format!("failed to initialize Windows OCR engine: {e}"))?;

    let ocr_result = engine
        .RecognizeAsync(&bitmap)
        .map_err(|e| format!("failed to recognize text: {e}"))?
        .await
        .map_err(|e| format!("OCR recognition failed: {e}"))?;

    let lines = ocr_result
        .Lines()
        .map_err(|e| format!("failed to get recognized lines: {e}"))?;

    let mut extracted = Vec::new();
    for line in lines {
        if let Ok(text) = line.Text() {
            let s = text.to_string();
            if !s.trim().is_empty() {
                extracted.push(s);
            }
        }
    }

    Ok(extracted.join("\n"))
}

#[cfg(not(target_os = "windows"))]
pub async fn extract_text_from_image_path(_path: &Path) -> Result<String, String> {
    Err("Windows OCR is supported on Windows only".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_adapter_active_display_is_zero_by_default() {
        let adapter = WindowsAdapter;
        assert_eq!(adapter.active_display(), 0);
    }

    #[test]
    fn windows_adapter_capture_display_non_windows_fails_honestly() {
        #[cfg(not(target_os = "windows"))]
        {
            let adapter = WindowsAdapter;
            let temp_dir = tempfile::tempdir().unwrap();
            let path = temp_dir.path().join("test.png");
            let res = adapter.capture_display(0, &path);
            assert!(res.is_err());
        }
    }

    #[test]
    fn windows_ocr_non_windows_fails_honestly() {
        #[cfg(not(target_os = "windows"))]
        {
            let temp_dir = tempfile::tempdir().unwrap();
            let path = temp_dir.path().join("test.png");
            let fut = extract_text_from_image_path(&path);
            let res = tauri::async_runtime::block_on(fut);
            assert!(res.is_err());
        }
    }
}


