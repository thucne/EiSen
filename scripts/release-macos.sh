#!/usr/bin/env bash
# Signed + notarized macOS DMG on this machine. Credentials stay in
# ~/.eisen-release.env (or $EISEN_RELEASE_ENV) — never in the repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${EISEN_RELEASE_ENV:-$HOME/.eisen-release.env}"
UPLOAD_TAG=""

github_repo() {
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    printf '%s\n' "$GITHUB_REPOSITORY"
    return
  fi
  if command -v gh >/dev/null 2>&1; then
    gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null && return
  fi
  local url
  url="$(git -C "$ROOT" remote get-url origin)"
  url="${url%.git}"
  url="${url#git@github.com:}"
  url="${url#https://github.com/}"
  url="${url#ssh://git@github.com/}"
  printf '%s\n' "$url"
}

usage() {
  echo "Usage: $0 [--upload vX.Y.Z]"
  echo "  Builds a signed, notarized DMG via Tauri."
  echo "  --upload  attach the DMG to an existing GitHub Release tag."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --upload)
      UPLOAD_TAG="${2:?tag required, e.g. v0.1.1}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

bash "$ROOT/scripts/check-version.sh" ${UPLOAD_TAG:+"$UPLOAD_TAG"}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  echo "Copy docs/eisen-release.env.example there, fill it, chmod 600." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

missing=()
for var in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Empty in $ENV_FILE: ${missing[*]}" >&2
  exit 1
fi

if ! security find-identity -p codesigning -v 2>/dev/null | grep -Fq "$APPLE_SIGNING_IDENTITY"; then
  echo "Signing identity not in Keychain. Import your Developer ID Application .p12 into the login keychain:" >&2
  echo "  security import /path/to/DeveloperID.p12 -k ~/Library/Keychains/login.keychain-db -T /usr/bin/codesign -T /usr/bin/security" >&2
  exit 1
fi

cd "$ROOT"
if [[ ! -d app/node_modules ]]; then
  npm ci --prefix app
fi

npm --prefix app run tauri -- build

# Honor CARGO_TARGET_DIR (Cursor/CI sandboxes redirect cargo output).
bundle_root="${CARGO_TARGET_DIR:-$ROOT/app/src-tauri/target}"
shopt -s nullglob
dmgs=("$bundle_root"/release/bundle/dmg/*.dmg)
shopt -u nullglob
if [[ ${#dmgs[@]} -eq 0 ]]; then
  echo "No DMG under $bundle_root/release/bundle/dmg/" >&2
  exit 1
fi

echo "Built:"
printf '  %s\n' "${dmgs[@]}"

if [[ -n "$UPLOAD_TAG" ]]; then
  REPO="$(github_repo)"
  if [[ -z "$REPO" ]]; then
    echo "Could not determine GitHub repo. Set GITHUB_REPOSITORY or configure origin." >&2
    exit 1
  fi
  if gh release view "$UPLOAD_TAG" --repo "$REPO" >/dev/null 2>&1; then
    gh release upload "$UPLOAD_TAG" "${dmgs[@]}" --repo "$REPO" --clobber
  else
    gh release create "$UPLOAD_TAG" "${dmgs[@]}" --repo "$REPO" \
      --title "EiSen ${UPLOAD_TAG#v}" --notes "EiSen ${UPLOAD_TAG#v}"
  fi
  echo "Uploaded to GitHub Release $UPLOAD_TAG"
fi
