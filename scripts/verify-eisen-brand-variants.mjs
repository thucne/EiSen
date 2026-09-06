import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const branding = path.join(root, "assets/branding");
const sharpImport = process.env.EISEN_SHARP_PATH ?? "sharp";

const expectedSvgNames = [
  "eisen-mark.svg",
  "eisen-mark-reversed.svg",
  "eisen-mark-on-dark.svg",
  "eisen-wordmark.svg",
  "eisen-wordmark-on-white.svg",
  "eisen-wordmark-reversed.svg",
  "eisen-wordmark-on-dark.svg",
  "eisen-wordmark-mono.svg",
  "eisen-horizontal.svg",
  "eisen-horizontal-on-white.svg",
  "eisen-horizontal-reversed.svg",
  "eisen-horizontal-on-dark.svg",
  "eisen-horizontal-mono.svg",
  "eisen-vertical.svg",
  "eisen-vertical-on-white.svg",
  "eisen-vertical-on-dark.svg",
  "eisen-square-lockup.svg",
  "eisen-square-lockup-on-white.svg",
  "eisen-square-lockup-on-dark.svg",
];

const forbiddenSvgContent = /<image\b|base64|data:|\bhref\s*=/i;

for (const name of expectedSvgNames) {
  const file = path.join(branding, name);
  const svg = await readFile(file, "utf8");
  if (forbiddenSvgContent.test(svg)) {
    throw new Error(`${name}: embedded image/base64/external href is not allowed`);
  }
  if (!/<svg\b[^>]*viewBox="0 0 [^\"]+"/.test(svg)) {
    throw new Error(`${name}: missing SVG viewBox`);
  }
}

let sharpModule;
try {
  sharpModule = await import(sharpImport.startsWith("/")
    ? pathToFileURL(sharpImport).href
    : sharpImport);
} catch (error) {
  console.error(
    "Unable to load Sharp. Install sharp or run: EISEN_SHARP_PATH=/path/to/sharp/lib/index.js node scripts/verify-eisen-brand-variants.mjs",
  );
  console.error(error);
  process.exitCode = 1;
}

if (sharpModule) {
  const sharp = sharpModule.default ?? sharpModule;
  const pngNames = (await readdir(branding))
    .filter((name) => /^eisen-.*-\d+\.png$/.test(name))
    .sort();

  for (const name of pngNames) {
    const expectedWidth = Number(name.match(/-(\d+)\.png$/)[1]);
    const metadata = await sharp(path.join(branding, name)).metadata();
    if (metadata.width !== expectedWidth || !metadata.height) {
      throw new Error(
        `${name}: expected width ${expectedWidth}, got ${metadata.width}x${metadata.height}`,
      );
    }
  }

  console.log(`PASS ${expectedSvgNames.length} SVG brand variants`);
  console.log(`PASS ${pngNames.length} PNG brand variants with valid dimensions`);
}
