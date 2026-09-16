import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDirectory, '..');

const [heroSource, enSource, viSource] = await Promise.all([
  readFile(path.join(repoRoot, 'landing/src/components/Hero.astro'), 'utf8'),
  readFile(path.join(repoRoot, 'landing/src/i18n/en.ts'), 'utf8'),
  readFile(path.join(repoRoot, 'landing/src/i18n/vi.ts'), 'utf8'),
]);

test('hero renders an initially hidden Windows warning below the download CTA', () => {
  assert.match(heroSource, /id="hero-windows-warning"/);
  assert.match(heroSource, /id="hero-windows-warning"[\s\S]*?role="note"/);
  assert.match(heroSource, /id="hero-windows-warning"[\s\S]*?aria-hidden="true"/);
  assert.match(heroSource, /id="hero-windows-warning"[\s\S]*?class="hidden[^"]*"/);
});

test('hero shows the warning for Windows and hides it when switching back to macOS', () => {
  assert.match(heroSource, /hero-windows-warning/);
  assert.match(heroSource, /windowsWarning\.classList\.remove\('hidden'\)/);
  assert.match(heroSource, /windowsWarning\.setAttribute\('aria-hidden', 'false'\)/);
  assert.match(heroSource, /windowsWarning\.classList\.add\('hidden'\)/);
  assert.match(heroSource, /windowsWarning\.setAttribute\('aria-hidden', 'true'\)/);
});

test('hero warning copy is localized and tells Windows users what to expect', () => {
  assert.match(enSource, /windowsWarning: "Microsoft Store is the recommended Windows path\. The direct \.exe fallback is unsigned; SmartScreen may show Unknown publisher or block it\. Verify SHA-256 before running\."/);
  assert.match(viSource, /windowsWarning: "Microsoft Store là đường cài đặt Windows được khuyến nghị\. Bản \.exe trực tiếp là fallback chưa ký số; SmartScreen có thể báo Unknown publisher hoặc chặn bộ cài\. Hãy kiểm tra SHA-256 trước khi chạy\."/);
});
