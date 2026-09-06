use std::fmt;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum OutputError {
    Encode(String),
    Io(io::Error),
    Clipboard(String),
}

impl fmt::Display for OutputError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OutputError::Encode(e) => write!(f, "image encode failed: {e}"),
            OutputError::Io(e) => write!(f, "output failed: {e}"),
            OutputError::Clipboard(e) => write!(f, "clipboard failed: {e}"),
        }
    }
}

impl From<io::Error> for OutputError {
    fn from(e: io::Error) -> Self {
        OutputError::Io(e)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SaveResult {
    pub path: PathBuf,
}

pub fn save_image(dir: &Path, desired: &str, bytes: &[u8]) -> Result<PathBuf, OutputError> {
    let path = crate::domain::naming::unique_path(dir, desired);
    std::fs::write(&path, bytes)?;
    Ok(path)
}

pub fn copy_image(app: &tauri::AppHandle, bytes: &[u8]) -> Result<(), OutputError> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let image = decode_image(bytes)?;
    app.clipboard()
        .write_image(&image)
        .map_err(|e| OutputError::Clipboard(e.to_string()))
}

/// Decodes PNG bytes into an RGBA image for the clipboard plugin.
fn decode_image(bytes: &[u8]) -> Result<tauri::image::Image<'static>, OutputError> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| OutputError::Encode(e.to_string()))?;
    let rgba = img.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    Ok(tauri::image::Image::new_owned(
        rgba.into_raw(),
        width,
        height,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn save_adds_suffix() {
        let dir = tempdir().unwrap();
        let _ = save_image(dir.path(), "X.png", b"1");
        let p2 = save_image(dir.path(), "X.png", b"2").unwrap();
        assert!(p2.to_string_lossy().contains("_1"));
    }

    #[test]
    fn copy_image_empty_bytes_errs() {
        assert!(matches!(decode_image(&[]), Err(OutputError::Encode(_))));
    }

    #[test]
    fn save_image_writes_exact_bytes() {
        let dir = tempdir().unwrap();
        let p = save_image(dir.path(), "X.png", b"abc").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"abc");
    }
}
