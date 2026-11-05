//! Durable, capped, newest-first history of saved captures.

use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// A capture identifier: the on-disk path of a saved capture. Kept as a
/// string so the Editor can reopen the image directly.
pub type CaptureId = String;

const HISTORY_FILE_VERSION: u8 = 1;
const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

#[derive(Clone)]
struct HistoryEntry {
    path: CaptureId,
    root: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct PersistedHistory {
    version: u8,
    entries: Vec<PersistedEntry>,
}

#[derive(Serialize, Deserialize)]
struct PersistedEntry {
    path: String,
    root: String,
}

/// Capped, newest-first history. The optional persistence path is set by
/// `load_or_migrate`; a normal in-memory instance remains useful in unit tests.
#[derive(Clone)]
pub struct CaptureHistory {
    store: VecDeque<HistoryEntry>,
    cap: usize,
    persistence_path: Option<PathBuf>,
}

impl CaptureHistory {
    pub fn new(cap: usize) -> Self {
        CaptureHistory {
            store: VecDeque::new(),
            cap,
            persistence_path: None,
        }
    }

    pub fn with_persistence_path(cap: usize, path: PathBuf) -> Self {
        let mut history = Self::new(cap);
        history.persistence_path = Some(path);
        history
    }

    /// Load the saved history, or perform the one-time migration from the
    /// configured save directory when no history file has ever been written.
    /// The history file itself is the migration marker, including when it
    /// records an empty gallery after the user removed every item.
    pub fn load_or_migrate(
        history_path: &Path,
        save_dir: &Path,
        cap: usize,
    ) -> Result<Self, String> {
        let mut history = Self {
            store: VecDeque::new(),
            cap,
            persistence_path: Some(history_path.to_path_buf()),
        };

        match fs::symlink_metadata(history_path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                let bytes = fs::read(history_path).map_err(|e| {
                    format!("failed to read history {}: {e}", history_path.display())
                })?;
                let snapshot = match serde_json::from_slice::<PersistedHistory>(&bytes) {
                    Ok(snapshot) => snapshot,
                    Err(_) => {
                        // Preserve a corrupt or future-format file. Its
                        // existence still suppresses the one-time migration.
                        history.persistence_path = None;
                        return Ok(history);
                    }
                };
                if snapshot.version != HISTORY_FILE_VERSION {
                    // An older app must not overwrite history written by a
                    // newer version it does not understand.
                    history.persistence_path = None;
                    return Ok(history);
                }
                if cap > 0 {
                    let mut seen = HashSet::new();
                    for entry in snapshot.entries {
                        let Some(entry) = normalize_persisted_entry(&entry) else {
                            continue;
                        };
                        if seen.insert(entry.path.clone()) {
                            history.store.push_back(entry);
                            if history.store.len() == cap {
                                break;
                            }
                        }
                    }
                }
                // Rewrite a normalized snapshot so missing files, invalid
                // entries, and any over-cap data stay removed on later runs.
                history.persist()?;
            }
            Ok(_) => {
                return Err(format!(
                    "history path is not a regular file: {}",
                    history_path.display()
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                history.store = migrate_save_directory(save_dir, cap)?;
                history.persist()?;
            }
            Err(error) => {
                return Err(format!(
                    "failed to inspect history {}: {error}",
                    history_path.display()
                ));
            }
        }

        Ok(history)
    }

    /// Record a capture; the newest entry sits at the front.
    pub fn push(&mut self, id: CaptureId) {
        let path = PathBuf::from(&id);
        let root = path.parent().map(Path::to_path_buf).unwrap_or_default();
        let entry = normalize_capture(&path, &root).unwrap_or(HistoryEntry { path: id, root });
        self.store.retain(|stored| stored.path != entry.path);
        self.store.push_front(entry);
        while self.store.len() > self.cap {
            self.store.pop_back();
        }
    }

    /// The most recent captures, newest first.
    pub fn recent(&self) -> Vec<&CaptureId> {
        self.store.iter().map(|entry| &entry.path).collect()
    }

    /// Return gallery paths after pruning removed or invalid files. The
    /// pruned list is persisted so external file removal cannot make an item
    /// reappear on the next launch.
    pub fn recent_paths(&mut self) -> Vec<CaptureId> {
        let before = self.store.len();
        self.store
            .retain(|entry| normalize_capture(Path::new(&entry.path), &entry.root).is_some());
        if self.store.len() != before {
            if let Err(error) = self.persist() {
                eprintln!("[eisen] failed to persist pruned history: {error}");
            }
        }
        self.store.iter().map(|entry| entry.path.clone()).collect()
    }

    /// The most recent capture id (the front of the deque).
    pub fn last(&self) -> Option<&CaptureId> {
        self.store.front().map(|entry| &entry.path)
    }

    /// Remove the first entry equal to `id`. Returns true if it was present.
    pub fn remove(&mut self, id: &str) -> bool {
        match self.store.iter().position(|entry| entry.path == id) {
            Some(pos) => {
                self.store.remove(pos);
                true
            }
            None => false,
        }
    }

    /// Remove and persist as one logical operation. A failed write restores
    /// the in-memory gallery, so the UI can safely roll back the removal.
    pub fn remove_and_persist(&mut self, id: &str) -> Result<bool, String> {
        let previous = self.store.clone();
        if !self.remove(id) {
            return Ok(false);
        }
        if let Err(error) = self.persist() {
            self.store = previous;
            return Err(error);
        }
        Ok(true)
    }

    /// Persist the current snapshot with a same-directory atomic replacement.
    pub fn persist(&self) -> Result<(), String> {
        let Some(path) = &self.persistence_path else {
            return Ok(());
        };

        let entries = self
            .store
            .iter()
            .filter_map(|entry| {
                normalize_capture(Path::new(&entry.path), &entry.root).map(|normalized| {
                    PersistedEntry {
                        path: normalized.path,
                        root: normalized.root.to_string_lossy().into_owned(),
                    }
                })
            })
            .collect();
        let snapshot = PersistedHistory {
            version: HISTORY_FILE_VERSION,
            entries,
        };
        let bytes = serde_json::to_vec_pretty(&snapshot)
            .map_err(|e| format!("failed to encode history: {e}"))?;
        write_atomic(path, &bytes)
    }

    pub fn len(&self) -> usize {
        self.store.len()
    }

    pub fn is_empty(&self) -> bool {
        self.store.is_empty()
    }
}

fn migrate_save_directory(save_dir: &Path, cap: usize) -> Result<VecDeque<HistoryEntry>, String> {
    let mut entries = Vec::new();
    let root = match fs::canonicalize(save_dir) {
        Ok(root) => root,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(VecDeque::new());
        }
        Err(error) => {
            return Err(format!(
                "failed to resolve capture directory {}: {error}",
                save_dir.display()
            ));
        }
    };
    let directory = fs::read_dir(&root)
        .map_err(|e| format!("failed to scan capture directory {}: {e}", root.display()))?;
    for item in directory {
        let item = item.map_err(|e| format!("failed to read capture directory entry: {e}"))?;
        let path = item.path();
        let Some(entry) = normalize_capture(&path, &root) else {
            continue;
        };
        let modified = item
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        entries.push((modified, entry));
    }
    entries.sort_by(|(left_time, left), (right_time, right)| {
        right_time
            .cmp(left_time)
            .then_with(|| right.path.cmp(&left.path))
    });
    Ok(entries
        .into_iter()
        .take(cap)
        .map(|(_, entry)| entry)
        .collect())
}

fn normalize_persisted_entry(entry: &PersistedEntry) -> Option<HistoryEntry> {
    normalize_capture(Path::new(&entry.path), Path::new(&entry.root))
}

/// Validate persisted or migrated paths before they become renderer roots:
/// require an absolute direct child of its recorded save directory, a regular
/// non-symlink EiSen PNG, and the PNG file signature. Canonicalization ensures
/// a symlinked parent cannot escape the recorded directory.
fn normalize_capture(path: &Path, root: &Path) -> Option<HistoryEntry> {
    if !path.is_absolute() || !root.is_absolute() || !is_capture_filename(path.file_name()?) {
        return None;
    }

    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() {
        return None;
    }

    let canonical_root = fs::canonicalize(root).ok()?;
    if !canonical_root.is_dir() {
        return None;
    }
    let canonical_path = fs::canonicalize(path).ok()?;
    if canonical_path.parent()? != canonical_root
        || !is_capture_filename(canonical_path.file_name()?)
    {
        return None;
    }

    let mut signature = [0; PNG_SIGNATURE.len()];
    File::open(&canonical_path)
        .ok()?
        .read_exact(&mut signature)
        .ok()?;
    if &signature != PNG_SIGNATURE {
        return None;
    }

    Some(HistoryEntry {
        path: canonical_path.to_string_lossy().into_owned(),
        root: canonical_root,
    })
}

fn is_capture_filename(name: &std::ffi::OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    let Some(stamp_and_suffix) = name
        .strip_prefix("EiSen_")
        .and_then(|s| s.strip_suffix(".png"))
    else {
        return false;
    };
    if stamp_and_suffix.len() < 15 {
        return false;
    }
    let stamp = &stamp_and_suffix.as_bytes()[..15];
    if stamp[8] != b'_'
        || !stamp
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 8 || byte.is_ascii_digit())
    {
        return false;
    }
    let Some(suffix) = stamp_and_suffix.get(15..) else {
        return false;
    };
    match suffix {
        "" => true,
        suffix => suffix.strip_prefix('_').is_some_and(|digits| {
            !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
        }),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("history path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| {
        format!(
            "failed to create history directory {}: {e}",
            parent.display()
        )
    })?;

    let mut temporary = None;
    for attempt in 0..32u32 {
        let candidate = parent.join(format!(".history-{}-{attempt}.tmp", std::process::id()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(file) => {
                temporary = Some((candidate, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "failed to create history snapshot in {}: {error}",
                    parent.display()
                ));
            }
        }
    }
    let (temporary_path, mut file) = temporary
        .ok_or_else(|| format!("could not reserve history snapshot in {}", parent.display()))?;
    let result = (|| {
        file.write_all(bytes)
            .map_err(|e| format!("failed to write history snapshot: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("failed to flush history snapshot: {e}"))?;
        drop(file);
        // The temporary lives beside the destination, so rename is a single
        // same-volume replacement on both Unix and Windows.
        fs::rename(&temporary_path, path)
            .map_err(|e| format!("failed to replace history {}: {e}", path.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn write_png(dir: &Path, filename: &str) -> PathBuf {
        let path = dir.join(filename);
        fs::write(&path, PNG_SIGNATURE).expect("write PNG fixture");
        fs::canonicalize(path).expect("canonicalize PNG fixture")
    }

    fn load(path: &Path, save_dir: &Path, cap: usize) -> CaptureHistory {
        CaptureHistory::load_or_migrate(path, save_dir, cap).expect("load history")
    }

    fn paths(history: &CaptureHistory) -> Vec<String> {
        history.recent().into_iter().cloned().collect()
    }

    #[test]
    fn history_caps() {
        let mut h = CaptureHistory::new(3);
        for id in ["a", "b", "c", "d"] {
            h.push(id.to_string());
        }
        assert_eq!(h.len(), 3);
        assert_eq!(h.last(), Some(&"d".to_string()));
    }

    #[test]
    fn history_recent_is_newest_first() {
        let mut h = CaptureHistory::new(5);
        for id in ["a", "b", "c"] {
            h.push(id.to_string());
        }
        let recent: Vec<&str> = h.recent().into_iter().map(|s| s.as_str()).collect();
        assert_eq!(recent, ["c", "b", "a"]);
    }

    #[test]
    fn history_empty_reporting() {
        let h = CaptureHistory::new(3);
        assert!(h.is_empty());
        assert_eq!(h.len(), 0);
        assert_eq!(h.last(), None);
    }

    #[test]
    fn history_remove_present_drops_entry_and_keeps_order() {
        let mut h = CaptureHistory::new(5);
        for id in ["a", "b", "c"] {
            h.push(id.to_string());
        }
        assert!(h.remove("b"));
        let recent: Vec<&str> = h.recent().into_iter().map(|s| s.as_str()).collect();
        assert_eq!(recent, ["c", "a"]);
        assert_eq!(h.len(), 2);
    }

    #[test]
    fn history_remove_absent_is_noop_false() {
        let mut h = CaptureHistory::new(5);
        for id in ["a", "b"] {
            h.push(id.to_string());
        }
        assert!(!h.remove("missing"));
        let recent: Vec<&str> = h.recent().into_iter().map(|s| s.as_str()).collect();
        assert_eq!(recent, ["b", "a"]);
        assert_eq!(h.len(), 2);
    }

    #[test]
    fn history_remove_only_element_empties() {
        let mut h = CaptureHistory::new(3);
        h.push("only".to_string());
        assert!(h.remove("only"));
        assert!(h.is_empty());
        assert_eq!(h.last(), None);
    }

    #[test]
    fn persisted_history_survives_restart_with_newest_first_and_cap() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        fs::create_dir_all(&save_dir).unwrap();
        let history_path = dir.path().join("history.json");
        let first = write_png(&save_dir, "EiSen_20261105_100000.png");
        let second = write_png(&save_dir, "EiSen_20261105_100001.png");
        let third = write_png(&save_dir, "EiSen_20261105_100002.png");

        let mut history = load(&history_path, &save_dir, 2);
        history.push(first.to_string_lossy().into_owned());
        history.persist().unwrap();
        history.push(second.to_string_lossy().into_owned());
        history.persist().unwrap();
        history.push(third.to_string_lossy().into_owned());
        history.persist().unwrap();

        let restarted = load(&history_path, &save_dir, 2);
        assert_eq!(
            paths(&restarted),
            [
                third.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ]
        );
    }

    #[test]
    fn gallery_removal_survives_restart_without_deleting_the_png() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        fs::create_dir_all(&save_dir).unwrap();
        let history_path = dir.path().join("history.json");
        let first = write_png(&save_dir, "EiSen_20261105_100000.png");
        let second = write_png(&save_dir, "EiSen_20261105_100001.png");
        let mut history = load(&history_path, &save_dir, 50);
        history.push(first.to_string_lossy().into_owned());
        history.persist().unwrap();
        history.push(second.to_string_lossy().into_owned());
        history.persist().unwrap();

        assert!(history
            .remove_and_persist(&second.to_string_lossy())
            .unwrap());
        assert!(
            second.exists(),
            "gallery removal must preserve the image file"
        );

        let restarted = load(&history_path, &save_dir, 50);
        assert_eq!(paths(&restarted), [first.to_string_lossy().into_owned()]);
    }

    #[test]
    fn migration_scans_timestamped_and_numbered_pngs_only_once() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        fs::create_dir_all(&save_dir).unwrap();
        let history_path = dir.path().join("history.json");
        let old = write_png(&save_dir, "EiSen_20261105_100000.png");
        let newest = write_png(&save_dir, "EiSen_20261105_100001_2.png");
        fs::write(save_dir.join("notes.png"), PNG_SIGNATURE).unwrap();

        let migrated = load(&history_path, &save_dir, 50);
        assert_eq!(migrated.len(), 2);
        assert!(paths(&migrated).contains(&old.to_string_lossy().into_owned()));
        assert!(paths(&migrated).contains(&newest.to_string_lossy().into_owned()));

        let mut after_removal = load(&history_path, &save_dir, 50);
        assert!(after_removal
            .remove_and_persist(&old.to_string_lossy())
            .unwrap());
        let later_capture = write_png(&save_dir, "EiSen_20261105_100002.png");
        let restarted = load(&history_path, &save_dir, 50);
        assert!(!paths(&restarted).contains(&old.to_string_lossy().into_owned()));
        assert!(!paths(&restarted).contains(&later_capture.to_string_lossy().into_owned()));
        assert!(paths(&restarted).contains(&newest.to_string_lossy().into_owned()));
    }

    #[test]
    fn migration_orders_by_modification_time_and_keeps_newest_cap() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        fs::create_dir_all(&save_dir).unwrap();
        let history_path = dir.path().join("history.json");
        let oldest = write_png(&save_dir, "EiSen_20261105_100000.png");
        std::thread::sleep(std::time::Duration::from_millis(10));
        let newest = write_png(&save_dir, "EiSen_20261105_100001.png");

        let history = load(&history_path, &save_dir, 1);
        assert_eq!(paths(&history), [newest.to_string_lossy().into_owned()]);
        assert!(oldest.exists());
    }

    #[test]
    fn migration_ignores_symlinked_pngs_and_invalid_png_bytes() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        let elsewhere = dir.path().join("elsewhere");
        fs::create_dir_all(&save_dir).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        let history_path = dir.path().join("history.json");
        fs::write(save_dir.join("EiSen_20261105_100000.png"), b"not png").unwrap();
        #[cfg(unix)]
        {
            let external = write_png(&elsewhere, "EiSen_20261105_100001.png");
            std::os::unix::fs::symlink(&external, save_dir.join("EiSen_20261105_100002.png"))
                .unwrap();
        }

        let history = load(&history_path, &save_dir, 50);
        assert!(history.is_empty());
    }

    #[test]
    fn failed_gallery_persistence_restores_the_removed_entry() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        fs::create_dir_all(&save_dir).unwrap();
        let history_path = dir.path().join("history.json");
        let image = write_png(&save_dir, "EiSen_20261105_100000.png");
        let mut history = load(&history_path, &save_dir, 50);
        history.push(image.to_string_lossy().into_owned());
        history.persist().unwrap();
        history.persistence_path = Some(save_dir.clone()); // rename over directory fails

        assert!(history
            .remove_and_persist(&image.to_string_lossy())
            .is_err());
        assert_eq!(paths(&history), [image.to_string_lossy().into_owned()]);
    }

    #[test]
    fn malformed_existing_history_is_not_migrated_again() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        fs::create_dir_all(&save_dir).unwrap();
        let old = write_png(&save_dir, "EiSen_20261105_100000.png");
        let history_path = dir.path().join("history.json");
        fs::write(&history_path, b"not json").unwrap();

        assert!(load(&history_path, &save_dir, 50).is_empty());
        assert_eq!(fs::read(&history_path).unwrap(), b"not json");
        assert!(old.exists());
        assert!(load(&history_path, &save_dir, 50).is_empty());
    }

    #[test]
    fn unknown_history_version_is_preserved_without_migration() {
        let dir = tempdir().unwrap();
        let save_dir = dir.path().join("captures");
        fs::create_dir_all(&save_dir).unwrap();
        let old = write_png(&save_dir, "EiSen_20261105_100000.png");
        let history_path = dir.path().join("history.json");
        let future = br#"{"version":2,"entries":[]}"#;
        fs::write(&history_path, future).unwrap();

        assert!(load(&history_path, &save_dir, 50).is_empty());
        assert_eq!(fs::read(&history_path).unwrap(), future);
        assert!(old.exists());
    }

    #[test]
    fn capture_filename_accepts_numbered_suffixes() {
        assert!(is_capture_filename(std::ffi::OsStr::new(
            "EiSen_20261105_100000_12.png"
        )));
        assert!(!is_capture_filename(std::ffi::OsStr::new(
            "EiSen_notes.png"
        )));
        assert!(!is_capture_filename(std::ffi::OsStr::new(
            "EiSen_20261105_100000_x.png"
        )));
    }
}
