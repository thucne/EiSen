use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Formats a timestamp as `"YYYYMMDD_HHMMSS"` (all components zero-padded).
pub fn build_timestamp(y: u32, mo: u32, d: u32, h: u32, mi: u32, s: u32) -> String {
    format!("{:04}{:02}{:02}_{:02}{:02}{:02}", y, mo, d, h, mi, s)
}

/// Default capture filename `EiSen_YYYYMMDD_HHMMSS.png` from the real clock.
pub fn default_filename() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0))
        .as_secs();
    let (y, mo, d) = civil_from_days((secs / 86_400) as i64);
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3_600, rem % 3_600 / 60, rem % 60);
    format!("EiSen_{}.png", build_timestamp(y as u32, mo, d, h as u32, mi as u32, s as u32))
}

/// Days since 1970-01-01 -> (year, month, day).
///
/// Standard civil-calendar algorithm (Howard Hinnant's `civil_from_days`),
/// epoch-relative, no external dependencies.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// Returns `dir/desired` if it does not exist; otherwise inserts `_1`, `_2`, ...
/// before the extension until a free name is found.
pub fn unique_path(dir: &Path, desired: &str) -> PathBuf {
    let first = dir.join(desired);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match desired.rsplit_once('.') {
        Some((stem, ext)) => (stem, format!(".{}", ext)),
        None => (desired, String::new()),
    };
    for n in 1u32.. {
        let candidate = dir.join(format!("{}_{}{}", stem, n, ext));
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("u32 collision counter exhausted")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unique_suffix_on_exists() {
        let dir = std::env::temp_dir().join("eisen-naming-test");
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("s.png");
        std::fs::write(&first, b"a").unwrap();
        let got = unique_path(&dir, "s.png");
        assert_eq!(got, dir.join("s_1.png"));
    }

    #[test]
    fn build_timestamp_zero_pads() {
        assert_eq!(build_timestamp(2026, 8, 2, 9, 5, 7), "20260802_090507");
        assert_eq!(build_timestamp(2026, 12, 31, 23, 59, 59), "20261231_235959");
    }

    #[test]
    fn default_filename_matches_spec_format() {
        let name = default_filename();
        assert!(name.starts_with("EiSen_"));
        assert!(name.ends_with(".png"));
        assert_eq!(name.len(), "EiSen_".len() + 8 + 1 + 6 + ".png".len());
        let stamp = &name["EiSen_".len()..name.len() - ".png".len()];
        assert!(stamp.as_bytes().iter().enumerate().all(|(i, b)| {
            if i == 8 {
                *b == b'_'
            } else {
                b.is_ascii_digit()
            }
        }));
    }

    #[test]
    fn civil_from_days_known_values() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_667), (2026, 8, 2));
    }

    #[test]
    fn unique_path_increments_past_existing_collisions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("s.png"), b"a").unwrap();
        std::fs::write(dir.path().join("s_1.png"), b"b").unwrap();
        assert_eq!(unique_path(dir.path(), "s.png"), dir.path().join("s_2.png"));
    }

    #[test]
    fn unique_path_returns_desired_when_free() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(unique_path(dir.path(), "s.png"), dir.path().join("s.png"));
    }
}
