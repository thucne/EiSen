# Windows capture verification matrix

This matrix is the repeatable desktop check for EiSen Windows releases. It
covers the installed application, the capture overlay and editor, native
clipboard/save/OCR behavior, hotkeys, the tray, and mixed-DPI placement. Run
the rows on a Windows 10 or Windows 11 desktop or VM and attach the evidence
to the release record.

The current source and CI checks do not complete these interactive rows. Every
row below is **PENDING** until it has been run on a Windows desktop or VM with
the stated package, display layout, and language.

## Run record

Copy this section into the release evidence record and fill it before changing
any row from `PENDING`.

| Field | Value |
| --- | --- |
| Tested commit | `PENDING` |
| EiSen version | `PENDING` |
| Package type | `NSIS` or `Store MSIX` |
| Windows edition/build | `PENDING` |
| Test date and operator | `PENDING` |
| Display layout and scaling | `PENDING` |
| Windows display language and OCR language | `PENDING` |
| Default known-folder Desktop path | `PENDING` |
| Overall result | `PENDING` |

Use one artifact directory per run, for example
`windows-verification/<commit>/<package>/<case-id>/`. Include the tested
commit, package version, package SHA-256, and artifact SHA-256 values in the
release record. A screenshot should show enough of the desktop or package UI
to identify the case; a PNG or text artifact should retain its original
dimensions and path.

## What CI proves

The hosted checks are useful prerequisites and packaging evidence. They do not
replace the rows in this matrix.

| Current check | Evidence it provides | Interactive behavior it does not prove |
| --- | --- | --- |
| `ci-windows`: `npm --prefix app run check:all` and `cargo test --manifest-path app/src-tauri/Cargo.toml` | Windows-targeted source checks, Rust unit tests, and the known-folder resolver test | A visible overlay, crop, clipboard, save, OCR, hotkey, tray, or mixed-DPI placement |
| Store MSIX workflow: diagnostic MSIX install, `Get-StartApps`, process launch, cleanup, package checksum | Package identity, activation, process startup, cleanup, and artifact integrity | Capture interaction, PrintScreen ownership/fallback, redirected Desktop behavior, OCR, or monitor placement |
| Release and MSIX contract scripts | Workflow and package metadata structure | A Windows desktop or VM session |

Do not mark a GUI row `PASS` from a hosted CI launch or from green packaging
contracts alone.

## Package and OS matrix

Run the capture behavior rows for each package and OS combination that the
release supports. Install NSIS using the release installer and install Store
MSIX using the diagnostic package or the Store-delivered package under test.

| Case ID | Package and OS | Action | Observable expected result | Evidence artifact | Result (PASS/FAIL/PENDING) |
| --- | --- | --- | --- | --- | --- |
| `PKG-10-NSIS` | Windows 10, NSIS | Install, launch from the installed shortcut, quit, and launch again | The installer completes, EiSen starts with a tray icon, and relaunch works after quit | Installer version, install/uninstall log, launch screenshot, process log | `PENDING` |
| `PKG-10-MSIX` | Windows 10, Store MSIX | Install the package, launch from Start, quit, and relaunch | The package identity is registered, EiSen starts with a tray icon, and relaunch works | Package SHA-256, Start menu screenshot, launch screenshot, process log | `PENDING` |
| `PKG-11-NSIS` | Windows 11, NSIS | Install, launch from the installed shortcut, quit, and launch again | The installer completes, EiSen starts with a tray icon, and relaunch works after quit | Installer version, install/uninstall log, launch screenshot, process log | `PENDING` |
| `PKG-11-MSIX` | Windows 11, Store MSIX | Install the package, launch from Start, quit, and relaunch | The package identity is registered, EiSen starts with a tray icon, and relaunch works | Package SHA-256, Start menu screenshot, launch screenshot, process log | `PENDING` |

## Display and mixed-DPI matrix

Use two physical monitors or a VM configuration that exposes two monitors.
Record the monitor order, physical resolution, scaling, and origin in every
artifact. In the negative-origin cases, place the secondary monitor to the
left of the primary so its physical X origin is negative.

| Case ID | Display setup | Action | Observable expected result | Evidence artifact | Result (PASS/FAIL/PENDING) |
| --- | --- | --- | --- | --- | --- |
| `DPI-100-125-R` | Primary 100%, secondary 125% to the right (positive origin) | Move the pointer to the secondary monitor; invoke capture, select a region, and open the editor | Overlay and editor cover the selected physical monitor; selection and controls stay aligned at destination scale | Monitor layout screenshot, overlay/editor screenshots, captured PNG dimensions, package log | `PENDING` |
| `DPI-125-150-R` | Primary 125%, secondary 150% to the right (positive origin) | Repeat capture, crop, and editor placement on the secondary monitor | Physical position and size remain on the destination monitor and the 680x480 logical minimum remains usable | Monitor layout screenshot, overlay/editor screenshots, PNG dimensions, package log | `PENDING` |
| `DPI-150-100-L` | Primary 150%, secondary 100% to the left (negative origin) | Move the pointer to the negative-origin monitor; invoke capture, crop, and open the editor | Overlay and editor use the negative physical origin without jumping to the primary monitor or clipping the selection | Monitor layout screenshot with negative origin, overlay/editor screenshots, PNG dimensions, package log | `PENDING` |

## Capture behavior matrix

Run these cases for each applicable package/OS row above. Keep unrelated
screen-capture utilities disabled except for `CAP-03`, which intentionally
creates a PrintScreen conflict.

| Case ID | Run on | Action | Observable expected result | Evidence artifact | Result (PASS/FAIL/PENDING) |
| --- | --- | --- | --- | --- | --- |
| `CAP-01` | Every package/OS row | Launch EiSen, wait for the tray icon, then perform the first capture immediately with the configured Windows capture hotkey | The first capture opens the overlay, displays the captured screen, and accepts a selection without requiring a second attempt | First-capture screenshot, captured PNG, timestamped application log | `PENDING` |
| `CAP-02` | Every package/OS row | With PrintScreen available, press PrintScreen once, select a region, and finish the capture | PrintScreen starts exactly one capture session; the overlay is usable and the result is returned | Hotkey/overlay screenshot, PNG path and dimensions, log showing one session | `PENDING` |
| `CAP-03` | Every package/OS row | Enable a known PrintScreen consumer, such as the Windows Snipping Tool Print Screen setting, relaunch EiSen, confirm the PrintScreen conflict/warning, and press `Ctrl+Shift+5` while the other app retains PrintScreen | EiSen records the occupied shortcut, registers the configured `Ctrl+Shift+5` fallback, and the fallback starts one usable capture | Conflict setup screenshot, EiSen settings/log, fallback overlay screenshot, PNG path | `PENDING` |
| `CAP-04` | Every package/OS row | Use the tray `Capture now` item, complete a selection, then use the tray again after the first session ends | The tray remains responsive; each invocation creates one session and no stale busy state blocks the next capture | Tray menu screenshots, two PNG paths/dimensions, application log | `PENDING` |
| `CAP-05` | Every package/OS row | Capture a known rectangle, for example 320x200 physical pixels at 100%, and save or copy the result | The output PNG dimensions match the selected physical crop after scale conversion; no extra border is present | Selection screenshot, output PNG, `PNG width x height` measurement, path log | `PENDING` |
| `CAP-06` | Every package/OS row | Copy a captured image, open Paint or another local image editor, and paste | The clipboard contains the captured image at the expected dimensions and it can be pasted without corruption | Clipboard/paste screenshot and output PNG dimensions | `PENDING` |
| `CAP-07` | A profile with a redirected Desktop | Ensure the Windows known-folder Desktop points to its redirected path, leave the save directory at default, save a capture, and relaunch EiSen | The file is saved under the visible redirected Desktop path, survives relaunch, and is not written to `%TEMP%` or a stale `%USERPROFILE%\Desktop` path | Settings/default path screenshot, saved file path, PNG hash/dimensions, known-folder evidence | `PENDING` |
| `CAP-08` | Every package/OS row with the target language installed | Capture a clear text sample, run OCR, and copy or inspect the recognized text | Windows OCR returns readable text for the installed language and the result is available to the editor/output action | Source screenshot, OCR result screenshot or text, language settings screenshot, log | `PENDING` |
| `CAP-09` | Every package/OS row | Finish a capture, quit from the tray, relaunch, and perform another hotkey and tray capture | Relaunch clears stale UI state; both trigger paths remain usable and produce one session each | Quit/relaunch screenshots, resulting PNG paths/dimensions, log | `PENDING` |
| `CAP-10` | Every package/OS row | Start a capture, cancel it, and immediately trigger another capture from the other path | Cancel releases the session; the next trigger opens normally without a stuck busy state or leftover temporary image | Cancel and next-capture screenshots, temp directory inspection, log | `PENDING` |

## Completion and evidence rules

For every `PASS` or `FAIL`, retain the action log and the artifacts named in
the row. Record the exact tested commit, package version, package SHA-256,
Windows build, display scaling/origins, OCR language, and artifact SHA-256
values. A failed row needs the same evidence plus the failure description.

Until all required rows have been run and attached to the release record, the
Windows GUI verification status remains `PENDING`, even when the Windows CI,
Store diagnostic launch, package checksum, and contract checks are green.
