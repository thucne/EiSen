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

test('hero warning copy is localized and describes the unsigned direct fallback', () => {
  assert.match(enSource, /windowsWarning: "The Microsoft Store version is the recommended Windows install and receives Store-managed updates\. The direct \.exe fallback is unsigned, so SmartScreen may show Unknown publisher or Windows protected your PC, and managed devices may block it\. Verify the SHA-256 sidecar on GitHub Releases before running\."/);
  assert.match(viSource, /windowsWarning: "Bản Microsoft Store là lựa chọn cài đặt chính cho Windows và được Store tự quản lý cập nhật\. Bản \.exe trực tiếp chỉ là fallback chưa ký số; SmartScreen có thể báo Unknown publisher hoặc Windows protected your PC, và máy công ty có thể chặn\. Hãy kiểm tra sidecar SHA-256 trên GitHub Releases trước khi chạy\."/);
});
