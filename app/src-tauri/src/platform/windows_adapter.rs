use crate::core::capture::ScreenProvider;
#[cfg(any(target_os = "windows", test))]
use crate::core::capture::DisplayGeometry;
use std::path::Path;

pub struct WindowsAdapter;

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct ActiveScreen {
    capture_index: u32,
    geometry: DisplayGeometry,
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

#[cfg(any(target_os = "windows", test))]
pub(crate) fn monitor_index_containing(
    point: (i32, i32),
    monitors: &[DisplayGeometry],
) -> Option<usize> {
    monitors.iter().position(|monitor| {
        point.0 >= monitor.x
            && point.0 < monitor.x.saturating_add(monitor.width as i32)
            && point.1 >= monitor.y
            && point.1 < monitor.y.saturating_add(monitor.height as i32)
    })
}

#[cfg(target_os = "windows")]
fn resolve_active_screen() -> Result<ActiveScreen, String> {
    let monitors = xcap::Monitor::all().map_err(|e| format!("failed to query monitors: {e}"))?;
    let geometries = monitors
        .iter()
        .map(|monitor| {
            Ok(DisplayGeometry {
                x: monitor.x().map_err(|e| format!("failed to read monitor x: {e}"))?,
                y: monitor.y().map_err(|e| format!("failed to read monitor y: {e}"))?,
                width: monitor
                    .width()
                    .map_err(|e| format!("failed to read monitor width: {e}"))?,
                height: monitor
                    .height()
                    .map_err(|e| format!("failed to read monitor height: {e}"))?,
                scale: monitor
                    .scale_factor()
                    .map_err(|e| format!("failed to read monitor scale: {e}"))?
                    as f64,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    if geometries.is_empty() {
        return Err("no monitors found".to_string());
    }

    let cursor = get_cursor_pos().ok_or_else(|| "failed to read cursor position".to_string())?;
    let capture_index = monitor_index_containing(cursor, &geometries)
        .ok_or_else(|| "cursor is outside the enumerated monitor bounds".to_string())?;
    let geometry = geometries[capture_index];

    Ok(ActiveScreen {
        capture_index: capture_index as u32,
        geometry,
    })
}

#[cfg(target_os = "windows")]
fn resolve_and_store() -> Result<ActiveScreen, String> {
    let screen = resolve_active_screen()?;
    *LAST_ACTIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(screen);
    Ok(screen)
}

#[cfg(target_os = "windows")]
pub fn active_display_geometry() -> Option<DisplayGeometry> {
    LAST_ACTIVE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|s| s.geometry)
}

#[cfg(target_os = "windows")]
impl ScreenProvider for WindowsAdapter {
    fn capture_display(&self, display: u32, out: &Path) -> Result<(), String> {
        let monitors = xcap::Monitor::all().map_err(|e| format!("failed to query monitors: {e}"))?;
        let monitor = monitors
            .get(display as usize)
            .ok_or_else(|| format!("capture monitor index {display} is no longer available"))?;

        let img = monitor
            .capture_image()
            .map_err(|e| format!("failed to capture screen: {e}"))?;

        img.save(out)
            .map_err(|e| format!("failed to save capture image to disk: {e}"))?;

        crate::core::capture::restrict_permissions(out);
        Ok(())
    }

    fn active_display(&self) -> Result<u32, String> {
        resolve_and_store().map(|screen| screen.capture_index)
    }

    fn active_scale(&self) -> f64 {
        LAST_ACTIVE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|s| s.geometry.scale)
            .or_else(|| resolve_and_store().ok().map(|screen| screen.geometry.scale))
            .unwrap_or(1.0)
    }
}

#[cfg(not(target_os = "windows"))]
impl ScreenProvider for WindowsAdapter {
    fn capture_display(&self, _display: u32, _out: &Path) -> Result<(), String> {
        Err("WindowsAdapter is only supported on Windows".to_string())
    }

    fn active_display(&self) -> Result<u32, String> {
        Ok(0)
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
    fn cursor_selects_the_monitor_containing_it() {
        let monitors = vec![
            DisplayGeometry {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                scale: 1.0,
            },
            DisplayGeometry {
                x: 1920,
                y: 0,
                width: 2560,
                height: 1440,
                scale: 1.25,
            },
        ];
        assert_eq!(monitor_index_containing((2400, 700), &monitors), Some(1));
    }

    #[test]
    fn cursor_outside_all_monitors_does_not_fallback_silently() {
        let monitors = vec![DisplayGeometry {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale: 1.0,
        }];
        assert_eq!(monitor_index_containing((3000, 700), &monitors), None);
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
