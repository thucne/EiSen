# Privacy

EiSen is a **local macOS and Windows app**. It does not send captures, OCR text, settings, or usage data to the authors or to any third-party service.

## What EiSen stores on your device

**Screen capture.** On macOS, Screen Recording permission is required to capture pixels outside EiSen. EiSen does not show a system permission prompt; you grant access in System Settings → Privacy & Security → Screen Recording. On Windows, capture works without a special capture-permission prompt. Captured images **are written to disk** on both platforms.

**Temp session files.** While you crop and annotate, EiSen writes PNGs under `$TMPDIR/eisen/` on macOS or `%TEMP%\eisen\` on Windows. Those files are removed when the capture finishes or when the app starts and sweeps leftovers. On macOS, EiSen applies owner-only Unix permissions to the session directory and files. On Windows, access is governed by the operating system's temporary-directory ACLs. Session files are not encrypted.

**Saved captures.** If you Save (or copy-and-save), a PNG is written to the folder you chose in Settings (`save_dir`). The default is your Desktop folder when it exists. Those files are ordinary PNGs you own. EiSen does not encrypt them at rest. Removing an item from the in-app History gallery does **not** delete the file on disk.

**Session History.** The hub gallery is in-memory for the current launch (up to 50 paths). After a relaunch the gallery is empty; that is expected. Files already saved remain in the save folder.

**Settings.** Language, save folder, hotkey, and “launch at login” are stored in `config.json` inside the OS-specific application config directory. Launch-at-login uses local OS startup registration, not a network service.

**OCR.** Overlay OCR runs **on-device**: Apple Vision on macOS and Windows.Media.Ocr on Windows. Recognized text stays on your device unless you copy it yourself.

## What EiSen does not do

- No analytics or telemetry.
- No crash-reporter that phones home.
- No auto-updater and no periodic network check for new versions. You download a new DMG or Windows installer from GitHub Releases when you want one.
- No account, cloud sync, or remote OCR.

This version makes **no outbound network requests** for capture, save, OCR, or settings. Opening GitHub Releases or macOS System Settings is something **you** do, not a background check from EiSen.

On macOS, `tauri dev` and a notarized `.app` are different code identities. A Screen Recording grant for one does not automatically apply to the other. Windows does not use this macOS permission flow.

## Contact

Questions or corrections: [GitHub issues](https://github.com/thucne/EiSen/issues) on this repository.
