# Privacy

EiSen is a **local macOS app**. It does not send captures, OCR text, or usage data to the authors or to any third-party service.

## What EiSen stores on this Mac

**Screen Recording.** macOS Screen Recording permission is required to capture. EiSen never shows a system permission prompt; you grant access in System Settings → Privacy & Security → Screen Recording. Captured images **are written to disk**.

**Temp session files.** While you crop and annotate, EiSen writes PNGs under `$TMPDIR/eisen/` with owner-only file permissions. Those files are removed when the capture finishes or when the app starts and sweeps leftovers. They are not encrypted.

**Saved captures.** If you Save (or copy-and-save), a PNG is written to the folder you chose in Settings (`save_dir`). The default is `~/Desktop` when that folder exists. Those files are ordinary PNGs you own. EiSen does not encrypt them at rest. Removing an item from the in-app History gallery does **not** delete the file on disk.

**Session History.** The hub gallery is in-memory for the current launch (up to 50 paths). After a relaunch the gallery is empty; that is expected. Files already saved remain in the save folder.

**Settings.** Language, save folder, hotkey, and “launch at login” are stored in the app’s config file under macOS Application Support (`config.json`). Launch-at-login uses a local Launch Agent, not a network service.

**OCR.** Overlay OCR runs **on-device** via the macOS Vision framework. Recognized text stays on this Mac unless you copy it yourself.

## What EiSen does not do

- No analytics or telemetry.
- No crash-reporter that phones home.
- No auto-updater and no periodic network check for new versions. You download a new DMG from GitHub Releases when you want one.
- No account, cloud sync, or remote OCR.

This version makes **no outbound network requests** for capture, save, OCR, or settings. Opening GitHub Releases or System Settings is something **you** do in the browser or in macOS, not a background check from EiSen.

`tauri dev` and a notarized `.app` are different code identities. A Screen Recording grant for one does not automatically apply to the other.

## Contact

Questions or corrections: [GitHub issues](https://github.com/thucne/EiSen/issues) on this repository.
