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
  assert.match(enSource, /windowsWarning: "The Microsoft Store listing is currently undergoing certification\. Until it is live, use the direct \.exe fallback; it is unsigned, so SmartScreen may show Unknown publisher or block it\. Verify SHA-256 before running\."/);
  assert.match(viSource, /windowsWarning: "Danh sách Microsoft Store hiện đang chờ certification\. Cho đến khi live, hãy dùng bản \.exe trực tiếp; bản này chưa ký số nên SmartScreen có thể báo Unknown publisher hoặc chặn bộ cài\. Hãy kiểm tra SHA-256 trước khi chạy\."/);
});
