# Cross-platform release runbook

EiSen releases are cut from one tagged commit. The GitHub Actions `Release`
workflow is the cross-platform publish path: it builds a signed macOS artifact
and either a signed Windows artifact or an explicitly approved unsigned
compatibility artifact, verifies checksums, and publishes them through one
final job. The local macOS script remains available for a Mac-only build or
for validating a notarized bundle before publishing.

Signing credentials never enter this repository. Local macOS builds read
`~/.eisen-release.env`; GitHub Actions reads repository secrets. Do not paste a
certificate, password, Apple app-specific password, or Team ID into a chat,
commit, or this file.

## 1. One-time macOS setup

You need:

- An **Apple Developer Program** membership.
- A **Developer ID Application** certificate in your **login Keychain**.
- An **app-specific password** for notarization ([Apple account
  settings](https://appleid.apple.com) → Sign-In and Security → App-Specific
  Passwords — not your Apple ID login password).

```bash
cp docs/eisen-release.env.example ~/.eisen-release.env
chmod 600 ~/.eisen-release.env
# Fill APPLE_SIGNING_IDENTITY, APPLE_TEAM_ID, APPLE_ID, APPLE_PASSWORD.
security find-identity -p codesigning -v   # must list Developer ID Application
```

`APPLE_CERTIFICATE` and `APPLE_CERTIFICATE_PASSWORD` are CI-only. Locally the
certificate must remain in the login Keychain.

## 2. One-time Windows Actions setup

The default Windows path is Authenticode signing with a code-signing
certificate stored as a PFX. Add these repository Actions secrets without
printing or committing their values:

| Secret | Value |
|---|---|
| `WINDOWS_CERTIFICATE_BASE64` | Base64-encoded Windows code-signing `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password that unlocks the PFX |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | Thumbprint of the certificate in the PFX |

The job imports the PFX into the ephemeral Windows runner, builds the NSIS
installer with SHA-256 signing and a timestamp, then fails unless every
produced executable has a valid Authenticode signature. Missing or mismatched
secrets fail the job before an artifact can be published.

For an explicitly approved compatibility release only, dispatch the workflow
with `allow_unsigned_windows=true`. The Windows job then uses Tauri's
`--no-sign` path, verifies that the produced executables are actually
unsigned, and publishes a release-note warning. This path is not a substitute
for signing: Windows SmartScreen or managed-device policy may warn or block
the installer.

## 3. Microsoft Store MSIX path (Windows)

EiSen has two Windows distribution paths:

- **Microsoft Store (recommended):** a Store-hosted MSIX. Microsoft signs the
  package for Store distribution and delivers Store-managed updates.
- **GitHub direct download (fallback):** the existing NSIS compatibility
  installer. The current Windows installer is unsigned, so SmartScreen or a
  managed-device policy may warn or block it.

The Store path is a separate MSIX/PWA product in Partner Center; it does not
replace the existing GitHub Release workflow or its NSIS artifact.

### One-time Partner Center setup

1. In Partner Center, select **New product → MSIX or PWA app** and reserve
   `EiSen`.
2. Copy the exact case-sensitive **Name**, **Publisher**, and **Publisher
   display name** from the product identity details into
   `app/msix/Package.appxmanifest`. Never substitute the public display name
   for the package identity.
3. Keep the product configured for Windows desktop x64 for the first package.

The reserved EiSen product is currently `9NRLQNXFVBF8`. After publication,
the public Store page will be
[`apps.microsoft.com/detail/9NRLQNXFVBF8`](https://apps.microsoft.com/detail/9NRLQNXFVBF8).
The exact identity values currently reserved for this product are:

| Field | Value |
|---|---|
| Package identity name | `ThucTran.EiSen` |
| Package publisher | `CN=D9E44B91-4179-4FB5-8A66-00544DF11C86` |
| Publisher display name | `Thuc Tran` |
| Package family name | `ThucTran.EiSen_swfap1hqma1f8` |

The manifest identity is tied to the reserved Store product. A package with a
different identity cannot be uploaded to that product.

### Build and validate the package on Windows

Install Microsoft's Windows App Developer CLI once:

```powershell
winget install Microsoft.WinApp --source winget
```

From the repository root, run the signed diagnostic package first, then the
unsigned package intended for Store upload:

```powershell
pwsh .\scripts\build-msix.ps1 -Mode test -Version 0.2.1.0
pwsh .\scripts\build-msix.ps1 -Mode store -Version 0.2.1.0
```

`test` creates a locally signed package with a development certificate for
install/activation smoke testing. It must never be uploaded to Partner
Center. `store` creates `EiSen_0.2.1.0_x64.msix`, its SHA-256 sidecar, and
metadata under `artifacts/msix/`; this is the package to upload to the
MSIX/PWA product. The script stages the executable and assets in a temporary
directory and does not edit the repository manifest.

The reproducible CI path is the manual **Store MSIX** workflow:

```bash
gh workflow run "Store MSIX" --repo thucne/EiSen --ref main \
  -f ref=main -f version=0.2.1.0
gh run list --repo thucne/EiSen --workflow "Store MSIX" --limit 1
gh run watch RUN_ID --repo thucne/EiSen --exit-status
```

The workflow installs and launches the diagnostic package on an ephemeral
Windows runner, then uploads only the unsigned Store package, checksum,
resolved manifest, and metadata. A CI launch proves packaging and activation;
it does not replace physical Windows testing of capture, PrintScreen, tray,
OCR, permissions, autostart, or multi-monitor behavior.

### Partner Center submission

Upload only the successful `EiSen_0.2.1.0_x64.msix` artifact. Keep pricing
free, target Windows desktop x64, use the EiSen website and privacy/support
links in the Store listing, and describe the local-only capture/OCR behavior.
The GitHub NSIS download should be documented as a secondary unsigned fallback,
not as the Store package. Once the Store listing is published, make the Store
link the primary Windows CTA on the README and landing site; retain the direct
download warning for users who need the fallback. Microsoft Store certification
and publication are separate from the GitHub Release workflow.

## 4. Prepare a release commit

Versions must agree in:

- `app/package.json`
- `app/src-tauri/Cargo.toml`
- `app/src-tauri/tauri.conf.json`

Run the check before committing and pass the tag again in CI:

```bash
bash scripts/check-version.sh v0.2.1
```

Commit and tag the release commit, then push both refs:

```bash
git commit -am "chore: prepare v0.2.1 release"
git tag -a v0.2.1 -m "EiSen v0.2.1"
git push origin main
git push origin v0.2.1
```

Pushing a `v*` tag does not start the release workflow automatically.

## 5. Publish both platforms with GitHub Actions

Use one workflow run per tag. Confirm the GitHub CLI is authenticated, then
dispatch the workflow against the existing tag. Keep
`allow_unsigned_windows=false` for the normal signed path:

```bash
gh workflow run Release --repo thucne/EiSen --ref main \
  -f tag=v0.2.1 -f allow_unsigned_windows=false
gh run list --repo thucne/EiSen --workflow Release --limit 1
gh run watch RUN_ID --repo thucne/EiSen --exit-status
gh release view v0.2.1 --repo thucne/EiSen
```

The tag keeps the `vX.Y.Z` convention, while the release display name must be
`EiSen X.Y.Z` (without the leading `v`). Release notes follow the established
structure: `What's Changed in EiSen X.Y.Z`, an introductory paragraph,
`✨ Highlights & Improvements`, and `🔐 Checksums`. The workflow applies this
display-name and structure automatically; edit the highlights for each release
when publishing a manually curated release note.

For the v0.2.1 compatibility release, the approved unsigned invocation is:

```bash
gh workflow run Release --repo thucne/EiSen --ref main \
  -f tag=v0.2.1 -f allow_unsigned_windows=true
```

The workflow checks the version triad in both platform jobs. It publishes only
after the macOS and Windows jobs complete, the DMG/EXE checksums verify, and
the signed or explicitly approved unsigned Windows check passes. Do not run
the local upload script concurrently for the same tag.

## 6. Optional local macOS build

The local path builds, signs, notarizes, and verifies the `.app`, creates a
SHA-256 sidecar for every DMG, and can upload those macOS artifacts to an
existing GitHub Release:

```bash
./scripts/release-macos.sh              # build and verify only
./scripts/release-macos.sh --upload v0.2.1
```

The script requires a matching version tag when `--upload` is used. Omit
`--upload` to keep the artifacts under
`app/src-tauri/target/release/bundle/` without changing GitHub state.

## 7. Verify downloaded artifacts

Download the complete release payload and verify every sidecar on a Unix-like
machine. The workflow writes checksum sidecars without a platform-specific
line ending, so the same command works on macOS and Linux:

```bash
mkdir -p /tmp/eisen-release-v0.2.1
gh release download v0.2.1 --repo thucne/EiSen --dir /tmp/eisen-release-v0.2.1
(cd /tmp/eisen-release-v0.2.1 && sha256sum -c -- *.dmg.sha256 *.exe.sha256)
```

On macOS, use `shasum -a 256 --check` if `sha256sum` is unavailable. On
Windows, verify the installer with PowerShell:

```powershell
Get-FileHash .\EiSen_0.2.1_x64-setup.exe -Algorithm SHA256
Get-AuthenticodeSignature .\EiSen_0.2.1_x64-setup.exe
```

For the v0.2.1 compatibility release, `Get-AuthenticodeSignature` is
expected to report `NotSigned` for the Windows installer. That is a known
release limitation and is called out in the GitHub release notes; do not treat
the installer as signed because it was downloaded from the official page.

For a clean macOS install, copy `EiSen.app` to `/Applications` and verify:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/EiSen.app
spctl --assess --type execute --verbose /Applications/EiSen.app
xcrun stapler validate /Applications/EiSen.app
```

`spctl --assess` must report `accepted`, and `stapler validate` must report a
present ticket. Record the resulting `.app` size after the first signed build.

## 8. First-launch expectations

EiSen is a menu-bar/system-tray app. The macOS bundle merges
`app/src-tauri/Info.plist`, which sets `LSUIElement=true`, and the runtime also
sets `ActivationPolicy::Accessory` in `app/src-tauri/src/lib.rs`. Both layers
keep the app out of the Dock when launched from Finder or Spotlight. Look for
the EiSen icon in the menu bar or system tray. The macOS release verification
step checks the generated bundle's `Info.plist` before validating its
signature and notarization.

Screen Recording is preflight-only (`CGPreflightScreenCaptureAccess`): macOS
will not show a system prompt. Grant access via System Settings → Privacy &
Security → Screen Recording. A grant made while EiSen is running may need a
relaunch. These notes are also in the README.

## 9. Known product gap: no auto-updater

There is no auto-updater (`app/src-tauri/Cargo.toml` has no
`tauri-plugin-updater`). Users must download each new version manually from
GitHub Releases.
