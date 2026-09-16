# EiSen

Fast screen capture and annotation for **macOS** and **Windows**. Built with **Tauri v2**, **Rust**, and **SvelteKit**. Fully local — no telemetry, no network calls for capture or OCR.

---

## Install & use

1. **Platforms:** macOS 11+ and Windows 10/11.
2. Install the signed DMG (macOS) or the Windows NSIS setup installer `.exe` from [GitHub Releases](https://github.com/thucne/EiSen/releases) or [eisen.a302.link/download](https://eisen.a302.link/download). There is **no auto-updater**; each version is a new download (see `docs/RELEASE.md` §8).
3. **Windows v0.2.1 note:** this compatibility release uses an unsigned installer while Windows code signing is being prepared. SmartScreen may show **Unknown publisher** or **Windows protected your PC**, and managed devices may block it. Verify the published `.sha256` sidecar and only continue when you trust the download source.
4. After you open EiSen there is **no Dock / Taskbar icon** by default. Look for the EiSen icon in the **menu bar / system tray**: Capture now, Settings, History, Quit.
5. On macOS, the first capture needs **Screen Recording** permission (use the hub banner to open System Settings). On Windows, capture works immediately without extra setup.
6. Default hotkey: double-tap Option (⌥⌥) on macOS, PrintScreen (`PrtScn`) on Windows. Change it in Settings.
7. Capture and the overlay use the **display under the cursor**.
8. Session History lives in memory (last 50 captures). Removing an item from the gallery does **not** delete files on disk. The gallery is empty after a relaunch; that is expected, not data loss.

---

## Features

- **Capture overlay** with an adjustable crop, then Copy, Save, Edit, or OCR.
- **Annotation tools:** Select, Text, Arrow, Ellipse, Rectangle, Pen, Pen Arrow, Highlight, Blur, Numbered Step, Eraser, Eyedropper.
- **Overlay OCR** via on-device native OCR (Apple Vision on macOS, Windows Media OCR on Windows — 100% offline, no cloud).
- Undo/Redo, Retina-correct export, and session History from the tray.

Privacy: everything stays on your device. See [PRIVACY.md](PRIVACY.md) for what is stored on disk.

---

## Tech stack

- **Frontend:** Svelte 5 / SvelteKit, TypeScript, Vanilla CSS, Lucide icons, Vitest.
- **Backend:** Rust and Tauri v2 with platform adapters: macOS AppKit bindings and `screencapture`, plus Windows `xcap` and Windows.Media.Ocr.

---

## Develop

Prerequisites: Node.js `v22+` (`npm v10+`) and Rust `1.75+`.

- **macOS development:** install Xcode Command Line Tools (`xcode-select --install`) and grant Screen Recording permission for `tauri dev`.
- **Windows development:** use the Rust MSVC toolchain with the Windows desktop build tools and SDK.

```bash
npm --prefix app install
npm --prefix app run tauri dev
```

### Testing & verification

```bash
# Run all checks (Svelte check, Vitest suite, and Rust Clippy)
npm --prefix app run check:all

# Run Rust core tests
cargo test --manifest-path app/src-tauri/Cargo.toml

# Run Rust linter
cargo clippy --manifest-path app/src-tauri/Cargo.toml -- -D warnings

# Run Svelte & TypeScript typecheck
npm --prefix app run check

# Run Frontend unit test suite
npm --prefix app test
```

### Project structure

```
EiSen/
├── app/
│   ├── src/                  # SvelteKit frontend (routes, editor, overlay)
│   │   ├── lib/              # Geometry math, store, elements, and IPC API
│   │   └── routes/           # Overlay, Editor, Hub, and Settings pages
│   ├── src-tauri/            # Rust backend (Tauri v2 application core)
│   │   ├── src/core/         # Capture orchestrator, output, history
│   │   ├── src/domain/       # Configuration, region geometry, naming
│   │   └── src/platform/     # macOS adapter (Vision / screencapture) & Windows adapter (xcap / WinRT OCR)
│   └── package.json
├── landing/              # Astro site for eisen.a302.link
├── docs/                 # Release runbook
├── scripts/                  # Branding generators and local macOS release
├── LICENSE
└── README.md
```

---

## License

[MIT](LICENSE).
