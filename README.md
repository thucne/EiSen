# EiSen

Fast screen capture and annotation for **macOS** and **Windows**. Built with **Tauri v2**, **Rust**, and **SvelteKit**. Fully local — no telemetry, no network calls for capture or OCR.

> **Mac first.** I built EiSen for my Mac, because I couldn't find a free screenshot app that was good enough. A Mac is also all I have to test on, so the Windows version is built and packaged automatically, and I haven't been able to try it on a real Windows PC. It may have bugs; please [open an issue](https://github.com/thucne/EiSen/issues) if you find one.

---

## Install & use

1. **Platforms:** macOS 11+ and Windows 10/11. Version 1.0.1 is available from GitHub Releases for macOS and as an unsigned Windows NSIS fallback. The Microsoft Store currently offers v1.0.0; its v1.0.1 update must complete certification before appearing there. Windows hasn't been run on a real Windows PC yet. The floating thumbnail and capture previous region are macOS only.
2. **Windows (recommended):** install EiSen from the [Microsoft Store](https://apps.microsoft.com/detail/9NRLQNXFVBF8). Store installations receive updates through Microsoft Store. If Store access is unavailable, use the Windows NSIS setup installer `.exe` from [GitHub Releases](https://github.com/thucne/EiSen/releases) or [eisen.a302.link/download](https://eisen.a302.link/download).
3. **Windows direct-download note:** the GitHub/website NSIS fallback is unsigned. SmartScreen may show **Unknown publisher** or **Windows protected your PC**, and managed devices may block it. Verify the published `.sha256` sidecar and only continue when you trust the download source. Direct downloads do not include an auto-updater.
4. After you open EiSen there is **no Dock / Taskbar icon** by default. Look for the EiSen icon in the **menu bar / system tray**: Capture now, Capture previous region (macOS), Settings, History, Quit.
5. On macOS, the first capture needs **Screen Recording** permission (use the hub banner to open System Settings). On Windows, capture works immediately without extra setup.
6. Default hotkey: double-tap Option (⌥⌥) on macOS, PrintScreen (`PrtScn`) on Windows. If another app already owns PrintScreen, EiSen automatically switches to `Ctrl + Shift + 5` and saves that working shortcut; both options are available in Settings.
7. Capture and the overlay use the **display under the cursor**.
8. In v1.0.1, History keeps up to 50 saved captures across relaunches. On the first launch after upgrading, it imports up to 50 newest `EiSen_*.png` files from the configured save folder. The hub refreshes when opened and after EiSen saves a capture. Removing an item from the gallery keeps it removed but does **not** delete its PNG from disk. The Store still offers v1.0.0 until its update is certified.

---

## Features

- **Capture overlay** with an adjustable crop, then Copy, Save, Edit, or OCR.
- **Floating thumbnail** on macOS: a preview after each capture. Click to edit, drag it into another app, or turn it off in Settings.
- **Capture previous region** on macOS: `Ctrl+Shift+2` or the tray menu selects the last region again, so Enter copies it.
- **Annotation tools:** Select, Text, Arrow, Ellipse, Rectangle, Pen, Pen Arrow, Highlight, Blur, Numbered Step, Eraser, Eyedropper, plus Redact and Crop on macOS. Use Redact for secrets: large text can stay readable under Blur.
- **OCR** in the overlay and the editor via on-device native OCR (Apple Vision on macOS, Windows Media OCR on Windows — 100% offline, no cloud).
- Undo/Redo, Retina-correct export, and persistent History from the tray.

Privacy: everything stays on your device. See [PRIVACY.md](PRIVACY.md) for what is stored on disk.

---

## Tech stack

- **Frontend:** Svelte 5 / SvelteKit, TypeScript, Vanilla CSS, Lucide icons, Vitest.
- **Backend:** Rust and Tauri v2 with platform adapters: macOS AppKit bindings and ScreenCaptureKit with a `screencapture` fallback, plus Windows `xcap` and Windows.Media.Ocr.

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
