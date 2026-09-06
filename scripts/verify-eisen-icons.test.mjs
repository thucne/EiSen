import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("./verify-eisen-icons.mjs", import.meta.url));

test("self-test rejects external SVG reference bypasses", async () => {
  const { stdout } = await execFileAsync(process.execPath, [script, "--self-test"]);

  assert.match(stdout, /PASS SVG external-reference regression cases/);
});
