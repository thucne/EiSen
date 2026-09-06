//! Pure thumbnail generator for hub history cards.
//!
//! Decodes a capture image, downsamples it to at most [`THUMB_MAX_WIDTH`] px
//! wide and stores the result as a PNG under a caller-provided cache
//! directory. The cache key is `hex(DefaultHasher over the path string)` +
//! the source's mtime in nanoseconds, so editing (or re-saving) a source
//! invalidates its cached thumbnail automatically.
//!
//! No Tauri types here — this module stays unit-testable without a runtime.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

/// Max thumbnail width in px (cards are ~220 logical px; 2x for Retina).
pub const THUMB_MAX_WIDTH: u32 = 440;

/// Generate (or reuse) a cached thumbnail for `src` under `thumb_dir`.
/// Cache key: hex(DefaultHasher over the path string) + "-" + mtime-nanos.
/// Returns the absolute path of the cached thumbnail PNG.
///
/// Collision tolerance: the hash is a cache key, not a security boundary —
/// a `DefaultHasher` collision would serve a wrong-but-valid image sized
/// like a thumbnail, which is acceptable by design. The mtime suffix is the
/// real invalidation signal.
pub fn generate(src: &Path, thumb_dir: &Path) -> Result<PathBuf, String> {
    let mtime_nanos = mtime_nanos(src)?;
    let cache_path = thumb_dir.join(format!("{:x}-{}.png", path_hash(src), mtime_nanos));

    // Cache hit: never re-decode.
    if cache_path.exists() {
        return Ok(cache_path);
    }

    let img =
        image::open(src).map_err(|e| format!("failed to decode {}: {e}", src.display()))?;
    let (width, height) = (img.width(), img.height());
    // Downsample only — never upscale small sources.
    let target_w = width.min(THUMB_MAX_WIDTH);
    let target_h = (((height as u64) * (target_w as u64)) / (width as u64)).max(1) as u32;
    let thumb = image::imageops::thumbnail(&img, target_w, target_h);

    std::fs::create_dir_all(thumb_dir)
        .map_err(|e| format!("failed to create {}: {e}", thumb_dir.display()))?;
    thumb
        .save(&cache_path)
        .map_err(|e| format!("failed to write {}: {e}", cache_path.display()))?;
    Ok(cache_path)
}

/// Source mtime in nanoseconds since the Unix epoch; the cache-key suffix.
fn mtime_nanos(src: &Path) -> Result<u128, String> {
    let meta = std::fs::metadata(src)
        .map_err(|e| format!("failed to stat {}: {e}", src.display()))?;
    let modified = meta
        .modified()
        .map_err(|e| format!("failed to read mtime of {}: {e}", src.display()))?;
    modified
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .map_err(|_| format!("mtime of {} predates the Unix epoch", src.display()))
}

/// Hash ONLY the path string (mtime travels alongside in the filename).
fn path_hash(src: &Path) -> u64 {
    let mut hasher = DefaultHasher::new();
    src.to_string_lossy().hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Solid-color RGB source saved as PNG at the given size.
    fn write_png(path: &Path, width: u32, height: u32, value: [u8; 3]) {
        let mut img = image::RgbImage::new(width, height);
        for pixel in img.pixels_mut() {
            *pixel = value.into();
        }
        img.save(path).expect("save test png");
    }

    fn dimensions(path: &Path) -> (u32, u32) {
        image::ImageReader::open(path)
            .expect("open generated thumb")
            .into_dimensions()
            .expect("read png header")
    }

    #[test]
    fn thumbnail_generated_with_max_width_440() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("src.png");
        write_png(&src, 800, 600, [255, 0, 0]);

        let thumb_dir = tempfile::tempdir().expect("thumb tempdir");
        let thumb = generate(&src, thumb_dir.path()).expect("generate");
        assert_eq!(dimensions(&thumb), (440, 330), "aspect must be preserved");
    }

    #[test]
    fn small_source_not_upscaled() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("src.png");
        write_png(&src, 200, 100, [0, 255, 0]);

        let thumb_dir = tempfile::tempdir().expect("thumb tempdir");
        let thumb = generate(&src, thumb_dir.path()).expect("generate");
        assert_eq!(dimensions(&thumb), (200, 100));
    }

    #[test]
    fn second_call_hits_cache_path_equality() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("src.png");
        write_png(&src, 800, 600, [0, 0, 255]);

        let thumb_dir = tempfile::tempdir().expect("thumb tempdir");
        let first = generate(&src, thumb_dir.path()).expect("first generate");
        assert!(first.exists(), "cache file must exist after generation");

        let second = generate(&src, thumb_dir.path()).expect("second generate");
        assert_eq!(first, second, "repeat calls must hit the same cache path");
        let first_mtime = std::fs::metadata(&second)
            .expect("stat cache file")
            .modified()
            .expect("mtime of cache file");
        let second_mtime = std::fs::metadata(&first)
            .expect("stat cache file")
            .modified()
            .expect("mtime of cache file");
        assert_eq!(
            first_mtime, second_mtime,
            "cache hit must not rewrite the file"
        );
    }

    #[test]
    fn missing_source_errors() {
        let dir = tempfile::tempdir().expect("tempdir");
        let missing = dir.path().join("nope.png");
        let thumb_dir = tempfile::tempdir().expect("thumb tempdir");
        assert!(generate(&missing, thumb_dir.path()).is_err());
    }

    #[test]
    fn mtime_change_invalidates_cache_key() {
        let dir = tempfile::tempdir().expect("tempdir");
        let src = dir.path().join("src.png");
        write_png(&src, 800, 600, [255, 255, 0]);

        let thumb_dir = tempfile::tempdir().expect("thumb tempdir");
        let first = generate(&src, thumb_dir.path()).expect("first generate");

        // Nanosecond mtimes on APFS make a short sleep reliable for forcing
        // a distinct mtime (no `filetime` dev-dep available).
        std::thread::sleep(std::time::Duration::from_millis(50));
        write_png(&src, 400, 300, [0, 255, 255]);

        let second = generate(&src, thumb_dir.path()).expect("second generate");
        assert_ne!(
            first, second,
            "an mtime bump must produce a fresh cache entry"
        );
    }
}
