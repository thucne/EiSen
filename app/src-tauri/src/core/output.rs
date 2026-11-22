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
    let (path, mut file) = create_unique_file(dir, desired)?;
    if let Err(error) = io::Write::write_all(&mut file, bytes) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(error.into());
    }
    Ok(path)
}

/// Reserve the first available name atomically. The path helper keeps the
/// established `_1`, `_2`, ... naming contract; `create_new` closes the race
/// between choosing a free name and creating it.
fn create_unique_file(dir: &Path, desired: &str) -> io::Result<(PathBuf, std::fs::File)> {
    loop {
        let path = crate::domain::naming::unique_path(dir, desired);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
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
    let img = image::load_from_memory(bytes).map_err(|e| OutputError::Encode(e.to_string()))?;
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
    use std::sync::{Arc, Barrier};
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

    #[test]
    fn concurrent_save_reservations_use_distinct_suffixes() {
        let dir = tempdir().unwrap();
        let workers = 12;
        let barrier = Arc::new(Barrier::new(workers));
        let paths = std::thread::scope(|scope| {
            let handles = (0..workers)
                .map(|worker| {
                    let barrier = barrier.clone();
                    let path = dir.path().to_path_buf();
                    scope.spawn(move || {
                        barrier.wait();
                        let (reserved, mut file) = create_unique_file(&path, "X.png").unwrap();
                        // Keep each reserved path present until every worker
                        // has selected its name.
                        barrier.wait();
                        io::Write::write_all(&mut file, worker.to_string().as_bytes()).unwrap();
                        reserved
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap())
                .collect::<Vec<_>>()
        });

        let unique: std::collections::HashSet<_> = paths.iter().collect();
        assert_eq!(unique.len(), workers);
        assert!(paths.contains(&dir.path().join("X.png")));
        for path in paths {
            let written = std::fs::read_to_string(path).unwrap();
            assert!(written.parse::<usize>().is_ok());
        }
    }
}
