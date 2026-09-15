# Cross-platform release runbook

EiSen releases are cut from one tagged commit. The GitHub Actions `Release`
workflow is the cross-platform publish path: it builds signed macOS and
Windows artifacts, verifies their checksums, and publishes them through one
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

The Windows job requires a code-signing certificate stored as a PFX. Add
these repository Actions secrets without printing or committing their values:

| Secret | Value |
|---|---|
| `WINDOWS_CERTIFICATE_BASE64` | Base64-encoded Windows code-signing `.pfx` |
| `WINDOWS_CERTIFICATE_PASSWORD` | Password that unlocks the PFX |
| `WINDOWS_CERTIFICATE_THUMBPRINT` | Thumbprint of the certificate in the PFX |

The job imports the PFX into the ephemeral Windows runner, builds the NSIS
installer with SHA-256 signing and a timestamp, then fails unless every
produced executable has a valid Authenticode signature. Missing or mismatched
secrets fail the job before an artifact can be published.

## 3. Prepare a release commit

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

## 4. Publish both platforms with GitHub Actions

Use one workflow run per tag. Confirm the GitHub CLI is authenticated, then
dispatch the workflow against the existing tag:

```bash
gh workflow run Release --repo thucne/EiSen --ref v0.2.1 -f tag=v0.2.1
gh run list --repo thucne/EiSen --workflow Release --limit 1
gh run watch RUN_ID --repo thucne/EiSen --exit-status
gh release view v0.2.1 --repo thucne/EiSen
```

The workflow checks the version triad in both platform jobs. It publishes only
after the macOS and Windows jobs complete, the DMG/EXE checksums verify, and
the signing checks pass. Do not run the local upload script concurrently for
the same tag.

## 5. Optional local macOS build

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

## 6. Verify downloaded artifacts

Download the complete release payload and verify every sidecar on a Unix-like
machine:

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

For a clean macOS install, copy `EiSen.app` to `/Applications` and verify:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/EiSen.app
spctl --assess --type execute --verbose /Applications/EiSen.app
xcrun stapler validate /Applications/EiSen.app
```

`spctl --assess` must report `accepted`, and `stapler validate` must report a
present ticket. Record the resulting `.app` size after the first signed build.

## 7. First-launch expectations

EiSen is a menu-bar/system-tray app. `ActivationPolicy::Accessory` in
`app/src-tauri/src/lib.rs` means no Dock or Taskbar icon appears by default.
Look for the EiSen icon in the menu bar or system tray.

Screen Recording is preflight-only (`CGPreflightScreenCaptureAccess`): macOS
will not show a system prompt. Grant access via System Settings → Privacy &
Security → Screen Recording. A grant made while EiSen is running may need a
relaunch. These notes are also in the README.

## 8. Known product gap: no auto-updater

There is no auto-updater (`app/src-tauri/Cargo.toml` has no
`tauri-plugin-updater`). Users must download each new version manually from
GitHub Releases.
