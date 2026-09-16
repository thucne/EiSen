import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function source(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8');
}

test('privacy policy describes local macOS and Windows behavior', async () => {
  const privacy = await source('PRIVACY.md');

  assert.match(privacy, /local macOS and Windows app/);
  assert.match(privacy, /%TEMP%\\eisen%?/);
  assert.match(privacy, /Windows\.Media\.Ocr/);
  assert.match(privacy, /Screen Recording.*macOS/s);
  assert.match(privacy, /Windows.*without a special capture-permission prompt/s);
  assert.doesNotMatch(privacy, /local macOS app/);
  assert.doesNotMatch(privacy, /What EiSen stores on this Mac/);
  assert.doesNotMatch(privacy, /Recognized text stays on this Mac/);
});

test('README backend and development prerequisites are platform-scoped', async () => {
  const readme = await source('README.md');

  assert.match(readme, /platform adapters/);
  assert.match(readme, /macOS development/);
  assert.match(readme, /Windows development/);
  assert.doesNotMatch(readme, /Backend:\*\* Rust, Tauri v2, `objc2` macOS AppKit bindings, system `screencapture` CLI/);
  assert.doesNotMatch(readme, /^Prerequisites:.*Xcode Command Line Tools.*Screen Recording permission for `tauri dev`\.$/m);
});

test('landing metadata is cross-platform', async () => {
  const seoHead = await source('landing/src/components/SeoHead.astro');

  assert.match(seoHead, /og:image:alt" content="EiSen — Screen Capture & Annotation for macOS & Windows"/);
});

test('CleanShot alternative page exposes both installers and OCR engines', async () => {
  const page = await source('landing/src/pages/cleanshot-alternative.astro');

  assert.match(page, /Mac & Windows/);
  assert.match(page, /Windows\.Media\.Ocr/);
  assert.match(page, /microsoftStoreUrl/);
  assert.match(page, /exeDownloadPath/);
  assert.match(page, /Direct \.exe fallback/);
  assert.match(page, /downloadCopy\.windowsWarning/);
  assert.match(page, /Windows 10\/11/);
  assert.doesNotMatch(page, /CleanShot X Alternative for Mac \(2026\)/);
  assert.doesNotMatch(page, /Why do Mac users look/);
});

test('Story Demo identifies the macOS scene and advertises Windows support', async () => {
  const page = await source('landing/src/pages/story.astro');

  assert.match(page, /Native Screen Capture Story Demo for macOS & Windows/);
  assert.match(page, /WindowsIcon/);
  assert.match(page, /exeDownloadPath/);
  assert.match(page, /Mạnh Mẽ &amp; Thuần Native Cho Mac &amp; Windows/);
  assert.match(page, /Windows 10\/11/);
  assert.match(page, /Windows\.Media\.Ocr/);
  assert.doesNotMatch(page, /The Native macOS Screenshot Tool \(Story Demo\)/);
  assert.doesNotMatch(page, /Mạnh Mẽ &amp; Thuần Native Cho Mac<\/h2>/);
});

test('static setup mockup labels are explicitly macOS-specific', async () => {
  const setupGuide = await source('landing/src/components/SetupGuide.astro');

  assert.match(setupGuide, /macOS: Privacy &amp; Security → Screen Recording/);
  assert.match(setupGuide, /macOS: Default: ⌥⌥ \(Double Option\)/);
});

test('Windows public CTAs prefer Microsoft Store and expose the direct fallback', async () => {
  const utils = await source('landing/src/i18n/utils.ts');
  const hero = await source('landing/src/components/Hero.astro');
  const navbar = await source('landing/src/components/Navbar.astro');
  const downloadCta = await source('landing/src/components/DownloadCta.astro');
  const windowsPage = await source('landing/src/pages/windows.astro');
  const vietnameseWindowsPage = await source('landing/src/pages/vi/windows.astro');
  const alternativePage = await source('landing/src/pages/cleanshot-alternative.astro');
  const storyPage = await source('landing/src/pages/story.astro');
  const english = await source('landing/src/i18n/en.ts');
  const vietnamese = await source('landing/src/i18n/vi.ts');

  assert.match(utils, /microsoftStoreUrl = 'https:\/\/apps\.microsoft\.com\/detail\/9NRLQNXFVBF8'/);
  assert.match(hero, /microsoftStoreUrl/);
  assert.match(hero, /data-win-direct-url=\{exeUrl\}/);
  assert.match(hero, /id="hero-windows-fallback"/);
  assert.match(navbar, /data-win-url=\{microsoftStoreUrl\}/);
  assert.match(downloadCta, /id="cta-win-store-btn"/);
  assert.match(downloadCta, /id="cta-win-direct-btn"/);
  assert.match(downloadCta, /href=\{microsoftStoreUrl\}/);
  assert.match(windowsPage, /id="windows-store-hero-btn"/);
  assert.match(windowsPage, /id="windows-direct-hero-btn"/);
  assert.match(windowsPage, /href=\{microsoftStoreUrl\}/);
  assert.match(vietnameseWindowsPage, /id="windows-store-hero-btn"/);
  assert.match(vietnameseWindowsPage, /id="windows-direct-hero-btn"/);
  assert.match(vietnameseWindowsPage, /href=\{microsoftStoreUrl\}/);
  assert.match(alternativePage, /href=\{microsoftStoreUrl\}/);
  assert.match(storyPage, /href=\{microsoftStoreUrl\}/);
  assert.match(english, /buttonWin: "Get EiSen from Microsoft Store"/);
  assert.match(english, /buttonWinDirect: "Direct \.exe fallback"/);
  assert.match(vietnamese, /buttonWin: "Tải EiSen từ Microsoft Store"/);
  assert.match(vietnamese, /buttonWinDirect: "Bản \.exe trực tiếp \(dự phòng\)"/);
});
