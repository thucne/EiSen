import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  await readFile(resolve(repoRoot, "app/src-tauri/tauri.conf.json"), "utf8"),
);
const macConfig = config.bundle?.macOS;

assert.equal(
  macConfig?.infoPlist,
  "Info.plist",
  "macOS bundles must merge the checked-in Info.plist extension",
);

const infoPlist = await readFile(
  resolve(repoRoot, "app/src-tauri/Info.plist"),
  "utf8",
);
const releaseWorkflow = await readFile(
  resolve(repoRoot, ".github/workflows/release.yml"),
  "utf8",
);
const localReleaseScript = await readFile(
  resolve(repoRoot, "scripts/release-macos.sh"),
  "utf8",
);
const libRs = await readFile(
  resolve(repoRoot, "app/src-tauri/src/lib.rs"),
  "utf8",
);

assert.match(
  infoPlist,
  /<key>LSUIElement<\/key>\s*<true\s*\/>/,
  "macOS menu-bar apps must be packaged as UIElement agents",
);
assert.doesNotMatch(
  infoPlist,
  /<key>LSUIElement<\/key>\s*<false\s*\/>/,
  "LSUIElement must not be disabled in the macOS packaging plist",
);
assert.match(
  releaseWorkflow,
  /plutil -extract LSUIElement raw -o - .*Contents\/Info\.plist/,
  "the macOS release workflow must verify LSUIElement in the built bundle",
);
assert.match(
  localReleaseScript,
  /plutil -extract LSUIElement raw -o - .*Contents\/Info\.plist/,
  "the local macOS release script must verify LSUIElement in the built bundle",
);
assert.match(
  libRs,
  /fn configure_macos_background_app[\s\S]*app\.set_activation_policy\(tauri::ActivationPolicy::Accessory\);[\s\S]*app\.set_dock_visibility\(false\);/,
  "macOS Accessory policy and hidden Dock state must be configured on the built App",
);
assert.match(
  libRs,
  /\.build\(tauri::generate_context!\(\)\)[\s\S]*configure_macos_background_app\(&mut app\)[\s\S]*app\.run\(/,
  "macOS Accessory configuration must run after .build() and before app.run()",
);

console.log("macOS packaging contract: ok");
