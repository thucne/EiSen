//! Allowlist validation for renderer-supplied filesystem paths.
//!
//! Custom `#[tauri::command]`s are NOT gated by Tauri capabilities, so any
//! webview window can invoke them with arbitrary arguments. Every command
//! that accepts a path from the renderer MUST route it through
//! [`ensure_allowed`] with an explicit root list before reading, copying or
//! writing anything.
//!
//! Paths are canonicalized before comparison and prefix matching is on whole
//! path components (`Path::starts_with`), never raw strings.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Canonicalize `path`, then require the result to live under
/// [`session_temp_dir`] or one of `extra_roots` (each canonicalized first).
/// Prefix matching is on whole components (`Path::strip_prefix` /
/// `Path::starts_with`), never raw strings, so `/tmp/eisen` never authorizes
/// `/tmp/eisen-evil/x`.
///
/// [`session_temp_dir`] (`$TMPDIR/eisen`, canonicalized) is ALWAYS an implicit
/// allowed root — session files live there; `extra_roots` carries save_dir
/// and history entries. The rest of `$TMPDIR` is **not** allowed.
///
/// For a not-yet-existing path (planned output target): canonicalize the
/// nearest existing ancestor and re-append the remaining components, so
/// outputs under an allowed root pass while `..`-escapes still fail.
///
/// Symlink note: canonicalize resolves symlinks; no additional symlink
/// policy is applied beyond that.
///
/// Errors start with `path not allowed: ` and include the offending path
/// display; this function never panics.
pub fn ensure_allowed(path: &Path, extra_roots: &[PathBuf]) -> Result<PathBuf, String> {
    // Renderer-supplied relative paths would otherwise silently resolve
    // against whatever the process cwd happens to be.
    if !path.is_absolute() {
        return Err(format!("path not allowed: {}", path.display()));
    }
    let resolved = resolve(path)?;

    let mut roots: Vec<PathBuf> = vec![session_temp_dir()];
    roots.extend(extra_roots.iter().cloned());
    for root in &roots {
        // Canonicalize each root before comparison (on macOS `/tmp` is a
        // symlink to `/private/tmp`; comparing raw forms breaks matching).
        // A not-yet-existing root (e.g. a newly configured save_dir)
        // resolves through its nearest existing ancestor like any target.
        let canon = resolve(root).unwrap_or_else(|_| root.clone());
        if resolved.starts_with(&canon) {
            return Ok(resolved);
        }
    }
    Err(format!("path not allowed: {}", path.display()))
}

/// Validate a persistent save-target directory: reject empty, relative,
/// filesystem-root, and system-prefix paths; create it if missing
/// (`create_dir_all`); then return its canonicalized form. The same
/// denylist is applied to the canonical result so a symlink to `/` fails.
pub fn ensure_valid_target_dir(dir: &Path) -> Result<PathBuf, String> {
    if dir.as_os_str().is_empty() {
        return Err("save directory must not be empty".to_string());
    }
    reject_illegal_save_dir(dir)?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("failed to create save directory {}: {e}", dir.display()))?;
    let canon = std::fs::canonicalize(dir)
        .map_err(|e| format!("failed to resolve save directory {}: {e}", dir.display()))?;
    reject_illegal_save_dir(&canon)?;
    Ok(canon)
}

/// Session capture directory: `$TMPDIR/eisen`. Created on first use with
/// best-effort `0o700` on Unix (chmod failure never fails the capture).
pub fn session_temp_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("eisen");
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    dir
}

fn save_dir_not_allowed(dir: &Path) -> String {
    format!("save directory not allowed: {}", dir.display())
}

/// Prefixes that must never become `save_dir` extra-roots. Matching is
/// component-wise (`Path::starts_with`), so `/etc` does not match `/etcfoo`.
/// `/opt` is intentionally omitted so `/opt/homebrew/...` is not blocked.
const DENIED_SAVE_PREFIXES: &[&str] = &[
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/private",
    "/Library",
    "/dev",
];

fn reject_illegal_save_dir(dir: &Path) -> Result<(), String> {
    if !dir.is_absolute() {
        return Err(save_dir_not_allowed(dir));
    }
    let preview = resolve(dir).unwrap_or_else(|_| dir.to_path_buf());
    if save_dir_too_shallow(&preview) || denied_save_prefix(&preview) || under_temp_dir(&preview) {
        return Err(save_dir_not_allowed(dir));
    }
    Ok(())
}

fn save_dir_too_shallow(path: &Path) -> bool {
    path.components()
        .filter(|c| matches!(c, std::path::Component::Normal(_)))
        .count()
        < 2
}

fn denied_save_prefix(path: &Path) -> bool {
    DENIED_SAVE_PREFIXES
        .iter()
        .any(|prefix| path.starts_with(Path::new(prefix)))
}

fn under_temp_dir(path: &Path) -> bool {
    std::fs::canonicalize(std::env::temp_dir())
        .map(|temp| path.starts_with(&temp))
        .unwrap_or(false)
}

/// Canonicalize `path`; for a not-yet-existing target, canonicalize the
/// nearest existing ancestor and re-append the missing components.
///
/// Every skipped component is guaranteed nonexistent (hence symlink-free),
/// so the reconstructed path matches exactly what the kernel would resolve
/// once the target is created. A `..` among the missing components cannot be
/// canonicalized safely and is rejected outright; `..` inside the existing
/// portion is resolved by `canonicalize` before the caller's prefix check.
fn resolve(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canon) = std::fs::canonicalize(path) {
        return Ok(canon);
    }
    let mut tail: Vec<OsString> = Vec::new();
    let mut cur = path.to_path_buf();
    loop {
        let name = cur.file_name();
        let parent = cur.parent();
        let (Some(name), Some(parent)) = (name, parent) else {
            // Exhausted the path (or it ends in `..`, for which `file_name`
            // is None) without finding an existing ancestor.
            return Err(format!("path not allowed: {}", path.display()));
        };
        if name == std::ffi::OsStr::new("..") {
            return Err(format!("path not allowed: {}", path.display()));
        }
        tail.push(name.to_os_string());
        if let Ok(canon) = std::fs::canonicalize(parent) {
            let mut resolved = canon;
            for comp in tail.iter().rev() {
                resolved.push(comp);
            }
            return Ok(resolved);
        }
        cur = parent.to_path_buf();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_bytes(path: &Path, bytes: &[u8]) {
        std::fs::write(path, bytes).expect("write test file");
    }

    /// Writable scratch root OUTSIDE `std::env::temp_dir()` (lives under the
    /// cargo target dir), so negative tests exercise genuine rejection even
    /// when an extra_root is listed. Unique per tag + nanos; cleaned up by
    /// the caller.
    fn outside_scratch(tag: &str) -> PathBuf {
        let exe = std::env::current_exe().expect("current_exe for scratch dir");
        // current_exe = <build-root>/<profile>/deps/<test-binary>; ancestors
        // skips the file itself, so nth(3) is the build root regardless of
        // the target dir's name.
        let build_root = exe
            .ancestors()
            .nth(3)
            .expect("build root above the test executable");
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = build_root.join(format!("eisen-path-guard-scratch/{tag}-{nanos}"));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        let canon_dir = std::fs::canonicalize(&dir).expect("canonicalize scratch dir");
        let canon_temp =
            std::fs::canonicalize(std::env::temp_dir()).expect("canonicalize temp dir");
        assert!(
            !canon_dir.starts_with(&canon_temp),
            "scratch dir must live outside the implicit temp root for these tests"
        );
        dir
    }

    fn cleanup_scratch(dir: &Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn allows_file_under_session_temp_dir() {
        let dir = session_temp_dir();
        let file = dir.join("capture.png");
        write_bytes(&file, b"png");
        let got = ensure_allowed(&file, &[]).expect("under the implicit session temp root");
        assert_eq!(got, std::fs::canonicalize(&file).expect("canonicalize"));
        let _ = std::fs::remove_file(&file);
    }

    #[test]
    fn rejects_file_under_temp_sibling_of_session_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        let file = dir.path().join("x.png");
        write_bytes(&file, b"png");
        assert!(
            ensure_allowed(&file, &[]).is_err(),
            "a file under TMPDIR but outside eisen/ must be rejected"
        );
    }

    #[test]
    fn rejects_path_outside_all_roots() {
        let scratch = outside_scratch("outside-all");
        let file = scratch.join("secret.png");
        write_bytes(&file, b"png");
        // Even with an unrelated extra root listed, the file stays rejected.
        let unrelated = tempfile::tempdir().expect("tempdir");
        assert!(
            ensure_allowed(&file, &[unrelated.path().to_path_buf()]).is_err(),
            "a file outside every allowed root must be rejected"
        );
        cleanup_scratch(&scratch);
    }

    #[test]
    fn rejects_traversal_via_dotdot() {
        let scratch = outside_scratch("dotdot");
        let allowed = scratch.join("allowed");
        std::fs::create_dir_all(&allowed).expect("mkdir allowed");
        let escape = allowed.join("../secret.txt");
        assert!(
            ensure_allowed(&escape, &[allowed.clone()]).is_err(),
            "`..`-escape from an allowed root must be rejected"
        );
        cleanup_scratch(&scratch);
    }

    #[test]
    fn accepts_nonexistent_target_under_allowed_root() {
        let dir = session_temp_dir();
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).expect("mkdir sub");
        let target = sub.join("out.png");
        let got = ensure_allowed(&target, &[]).expect("planned output under session temp root");
        assert_eq!(
            got,
            std::fs::canonicalize(&sub)
                .expect("canonical sub")
                .join("out.png")
        );
        let _ = std::fs::remove_dir_all(&sub);
    }

    #[test]
    fn rejects_nonexistent_target_outside_roots() {
        let scratch = outside_scratch("missing-outside");
        let sub = scratch.join("sub");
        std::fs::create_dir_all(&sub).expect("mkdir sub");
        let target = sub.join("out.png");
        assert!(
            ensure_allowed(&target, &[]).is_err(),
            "a planned output outside every root must be rejected"
        );
        cleanup_scratch(&scratch);
    }

    #[test]
    fn rejects_prefix_confusion_siblings() {
        let scratch = outside_scratch("prefix-confusion");
        let root = scratch.join("eisen");
        std::fs::create_dir_all(&root).expect("mkdir eisen");
        let evil = scratch.join("eisen-evil");
        std::fs::create_dir_all(&evil).expect("mkdir eisen-evil");
        let target = evil.join("x.png");
        write_bytes(&target, b"png");
        assert!(
            ensure_allowed(&target, &[root]).is_err(),
            "raw-string prefix matching would authorize the sibling dir"
        );
        cleanup_scratch(&scratch);
    }

    #[test]
    fn allows_saved_history_entry_via_extra_root() {
        // THE REGRESSION CASE: the hub legitimately sends previously-SAVED
        // file paths from the configured save_dir (+page.svelte re-open).
        // The scratch-based save_dir proves acceptance comes from the extra
        // root itself, not from the implicit temp root.
        let scratch = outside_scratch("history-entry");
        let save_dir = scratch.join("shots");
        std::fs::create_dir_all(&save_dir).expect("mkdir shots");
        let saved = save_dir.join("EiSen_20260825_101010.png");
        write_bytes(&saved, b"png");
        let got = ensure_allowed(&saved, &[save_dir])
            .expect("saved captures must stay re-openable");
        assert_eq!(got, std::fs::canonicalize(&saved).expect("canonical saved"));
        cleanup_scratch(&scratch);
    }

    #[test]
    fn target_dir_empty_rejected() {
        assert!(ensure_valid_target_dir(Path::new("")).is_err());
    }

    #[test]
    fn target_dir_created_when_missing() {
        let scratch = outside_scratch("target-missing");
        let target = scratch.join("nested").join("deeper");
        assert!(!target.exists());
        ensure_valid_target_dir(&target).expect("missing target dir is created");
        assert!(target.is_dir());
        cleanup_scratch(&scratch);
    }

    #[test]
    fn target_dir_canonicalized() {
        let scratch = outside_scratch("target-canon");
        let got = ensure_valid_target_dir(&scratch).expect("existing target dir");
        assert_eq!(got, std::fs::canonicalize(&scratch).expect("canonicalize"));
        cleanup_scratch(&scratch);
    }

    #[test]
    fn save_dir_policy_table() {
        struct Case {
            path: PathBuf,
            allow: bool,
        }
        let scratch = outside_scratch("save-policy");
        let nested = scratch.join("shots");
        let etc = PathBuf::from("/etc/eisen-must-not-create");
        let cases = [
            Case {
                path: PathBuf::from("/"),
                allow: false,
            },
            Case {
                path: PathBuf::from("/Users"),
                allow: false,
            },
            Case {
                path: PathBuf::from("/Volumes"),
                allow: false,
            },
            Case {
                path: PathBuf::from("captures"),
                allow: false,
            },
            Case {
                path: etc.clone(),
                allow: false,
            },
            Case {
                path: nested.clone(),
                allow: true,
            },
        ];
        for case in &cases {
            let result = ensure_valid_target_dir(&case.path);
            if case.allow {
                assert!(
                    result.is_ok(),
                    "expected allow for {}: {result:?}",
                    case.path.display()
                );
            } else {
                let err = result.expect_err("expected deny");
                assert!(
                    err.starts_with("save directory not allowed:"),
                    "{}: {err}",
                    case.path.display()
                );
            }
        }
        assert!(
            !etc.exists(),
            "denied /etc/... must not be created"
        );
        let temp = tempfile::tempdir().expect("tempdir");
        let temp_err = ensure_valid_target_dir(temp.path()).expect_err("save_dir must not be temp");
        assert!(
            temp_err.starts_with("save directory not allowed:"),
            "got {temp_err}"
        );
        cleanup_scratch(&scratch);
    }
}
