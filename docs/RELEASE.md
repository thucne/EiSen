# macOS release runbook

Default path: **build, sign, and notarize on your Mac**, then attach the DMG
to a GitHub Release. That uses Apple's notarization service and your CPU —
not GitHub Actions minutes.

Signing credentials never enter this repository. Local builds read
`~/.eisen-release.env`. GitHub Actions (manual fallback only) reads Actions
secrets.

Do not paste a certificate, password, or Team ID into a chat, a commit,
or this file.

## 1. One-time local setup

You need:

- An **Apple Developer Program** membership.
- A **Developer ID Application** certificate in your **login Keychain**
  (import the `.p12` Apple issued; do not store that file in this repo).
- An **app-specific password** for notarization
  ([appleid.apple.com](https://appleid.apple.com) → Sign-In and Security →
  App-Specific Passwords — not your Apple ID login password).

```bash
cp docs/eisen-release.env.example ~/.eisen-release.env
chmod 600 ~/.eisen-release.env
# Fill APPLE_SIGNING_IDENTITY, APPLE_TEAM_ID, APPLE_ID, APPLE_PASSWORD.
security find-identity -p codesigning -v   # must list Developer ID Application
```

`APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` are **CI-only**. Locally
the cert lives in Keychain.

## 2. Cut a release (local)

Versions must agree in:

- `app/package.json`
- `app/src-tauri/Cargo.toml`
- `app/src-tauri/tauri.conf.json`

`scripts/check-version.sh` (also run from CI and from
`scripts/release-macos.sh`) fails the build if they do not. Pass the
release tag to require the triad to match it:
`bash scripts/check-version.sh v0.1.0`.

Commit, tag the **release commit**, then
`./scripts/release-macos.sh --upload vX.Y.Z`.

Then:

```bash
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z          # does NOT start a macOS Actions build
./scripts/release-macos.sh --upload vX.Y.Z
```

Omit `--upload` to only produce
`app/src-tauri/target/release/bundle/dmg/*.dmg`.

Pushing a `v*` tag no longer runs `.github/workflows/release.yml`.

## 3. Optional: GitHub Actions fallback

If you cannot build on this Mac, run **Actions → Release → Run workflow**
and pass the existing tag (e.g. `v0.1.1`). That job still needs the six
`APPLE_*` repository secrets.

| Secret | What it is |
|---|---|
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password that unlocks the `.p12` |
| `APPLE_ID` | Apple ID email used for notarization |
| `APPLE_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | 10-character Team ID |

If those secrets are missing, the workflow still builds; the DMG is unsigned.

## 4. Verifying the artifact

On a clean Mac that has never seen EiSen, install `EiSen.app` to
`/Applications`, then:

```bash
codesign --verify --deep --strict --verbose=2 /Applications/EiSen.app
spctl --assess --type execute --verbose /Applications/EiSen.app
xcrun stapler validate /Applications/EiSen.app
```

`spctl --assess` must report `accepted`. `stapler validate` must report
that the ticket is present. Record the resulting `.app` size here after
the first signed build.

## 5. First-launch expectations

EiSen is a menu-bar-only app. `ActivationPolicy::Accessory` in
`app/src-tauri/src/lib.rs` means **no Dock icon appears**. Look for the
tray icon in the menu bar.

Screen Recording is **preflight-only** (`CGPreflightScreenCaptureAccess`):
macOS will **not** show a system prompt. Grant access via System Settings →
Privacy & Security → Screen Recording (hub banner deep-links there). A
grant made while EiSen is running may need a relaunch. These first-launch
notes are also in the README.

## 6. Known gap: no auto-updater

There is no auto-updater (`app/src-tauri/Cargo.toml` has no
`tauri-plugin-updater`). Users must download new versions from GitHub
Releases manually.
