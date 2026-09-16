import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = await readFile(resolve(root, ".github/workflows/release.yml"), "utf8");

assert.match(workflow, /concurrency:\s+group:\s+release-\$\{\{\s*inputs\.tag\s*\}\}/);
assert.match(workflow, /allow_unsigned_windows:/);
assert.match(workflow, /type:\s+boolean/);
assert.match(workflow, /inputs\.allow_unsigned_windows/);
assert.equal((workflow.match(/bash scripts\/check-version\.sh[^\n]*/g) ?? []).length, 2);
assert.equal((workflow.match(/actions\/upload-artifact@v4/g) ?? []).length, 2);
assert.equal((workflow.match(/softprops\/action-gh-release@v2/g) ?? []).length, 1);
assert.match(workflow, /actions\/download-artifact@v4/);
assert.match(workflow, /needs:\s*\[build-macos, build-windows\]/);
assert.match(workflow, /shasum -a 256/);
assert.match(workflow, /Get-FileHash -Algorithm SHA256/);
assert.match(workflow, /Get-AuthenticodeSignature/);
assert.match(workflow, /WINDOWS_CERTIFICATE_BASE64/);
assert.match(workflow, /Set-Content -LiteralPath .* -Encoding ascii -NoNewline/);
assert.match(workflow, /--no-sign/);
assert.match(workflow, /NotSigned/);
assert.match(workflow, /unsigned Windows/i);
assert.match(workflow, /Windows installer status:/);
assert.match(workflow, /SmartScreen/);
assert.match(workflow, /timestampUrl/);
assert.match(workflow, /codesign --verify --deep --strict/);
assert.match(workflow, /xcrun stapler validate/);

console.log("release workflow contract: ok");
