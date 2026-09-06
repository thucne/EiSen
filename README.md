# EiSen

macOS screen capture and annotation. Built with **Tauri v2**, **Rust**, and **SvelteKit**. Fully local — no telemetry, no network calls for capture or OCR.

---

## Install & use

1. **macOS 11+ only.** The Windows adapter is not implemented and is not shipped.
2. Install the signed DMG from [GitHub Releases](https://github.com/thucne/EiSen/releases) or [eisen.a302.link/download](https://eisen.a302.link/download). There is **no auto-updater**; each version is a new download (see `docs/RELEASE.md` §6).
3. After you open EiSen there is **no Dock icon**. Look for the EiSen tray in the **menu bar**: Capture now, Settings, History, Quit.
4. The first capture needs **Screen Recording**. EiSen does **not** show a macOS permission prompt. Use the hub banner to open System Settings → Privacy & Security → Screen Recording, grant access, then **quit and reopen EiSen**.
5. Default hotkey: double-tap Option (⌥⌥). Change it in Settings (Command-Shift-4, Control-Shift-4, and others).
6. Capture and the overlay use the **display under the cursor**.
7. Session History lives in memory (last 50 captures). Removing an item from the gallery does **not** delete files on disk. The gallery is empty after a relaunch; that is expected, not data loss.

---

## Features

- **Capture overlay** with an adjustable crop, then Copy, Save, Edit, or OCR.
- **Annotation tools:** Select, Text, Arrow, Ellipse, Rectangle, Pen, Pen Arrow, Highlight, Blur, Numbered Step, Eraser, Eyedropper.
- **Overlay OCR** via on-device macOS Vision (no cloud).
- Undo/Redo, Retina-correct export, and session History from the tray.

Privacy: everything stays on this Mac. See [PRIVACY.md](PRIVACY.md) for what is stored on disk.

---

## Tech stack

- **Frontend:** Svelte 5 / SvelteKit, TypeScript, Vanilla CSS, Lucide icons, Vitest.
- **Backend:** Rust, Tauri v2, `objc2` macOS AppKit bindings, system `screencapture` CLI.

---

## Develop

Prerequisites: Node.js `v22+` (`npm v10+`), Rust `1.75+`, Xcode Command Line Tools (`xcode-select --install`), and Screen Recording permission for `tauri dev`.

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
│   │   └── src/platform/     # macOS adapter (Windows scaffolded, not implemented)
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
