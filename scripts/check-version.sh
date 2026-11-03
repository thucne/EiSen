#!/usr/bin/env bash
# Exit 0 iff app/package.json, app/src-tauri/Cargo.toml, and
# app/src-tauri/tauri.conf.json share the same version. An optional first
# argument (e.g. v0.1.1) must match that semver after stripping a leading v.
# The MSIX manifest and packaging defaults must carry the same version plus .0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export EISEN_CHECK_VERSION_ROOT="$ROOT"
if [[ $# -ge 1 ]]; then
  export EISEN_CHECK_VERSION_TAG="$1"
else
  unset EISEN_CHECK_VERSION_TAG
fi

if command -v python3 >/dev/null 2>&1; then
  python_cmd=python3
elif command -v python >/dev/null 2>&1; then
  python_cmd=python
else
  echo "check-version.sh requires Python 3 (python3 or python)" >&2
  exit 1
fi

"$python_cmd" <<'PY'
import json, os, re, sys
from pathlib import Path

root = Path(os.environ["EISEN_CHECK_VERSION_ROOT"])
pkg = json.loads((root / "app/package.json").read_text())["version"]
cargo_txt = (root / "app/src-tauri/Cargo.toml").read_text()
m = re.search(r'(?m)^version\s*=\s*"([^"]+)"', cargo_txt)
if not m:
    print("could not read version from Cargo.toml", file=sys.stderr)
    sys.exit(1)
cargo = m.group(1)
tauri = json.loads((root / "app/src-tauri/tauri.conf.json").read_text())["version"]

if pkg != cargo or pkg != tauri:
    print("version triad mismatch:", file=sys.stderr)
    print(f"  app/package.json              {pkg}", file=sys.stderr)
    print(f"  app/src-tauri/Cargo.toml      {cargo}", file=sys.stderr)
    print(f"  app/src-tauri/tauri.conf.json {tauri}", file=sys.stderr)
    sys.exit(1)

msix_sources = {
    "app/msix/Package.appxmanifest": r'<Identity\b[^>]*\bVersion="([^"]+)"',
    ".github/workflows/store-msix.yml": r"(?m)^\s*default:\s*(\d+\.\d+\.\d+\.\d+)\s*$",
    "scripts/build-msix.ps1": r"\[string\]\$Version\s*=\s*'([^']+)'",
}
for rel, pattern in msix_sources.items():
    found = re.search(pattern, (root / rel).read_text())
    if not found or found.group(1) != f"{pkg}.0":
        have = found.group(1) if found else "no version found"
        print(f"{rel}: expected {pkg}.0, have {have}", file=sys.stderr)
        sys.exit(1)

tag = os.environ.get("EISEN_CHECK_VERSION_TAG")
if tag:
    want = tag[1:] if tag.startswith("v") else tag
    if pkg != want:
        print(f"version {pkg} does not match tag argument {tag}", file=sys.stderr)
        sys.exit(1)
PY
