import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reversedSvgPath = path.join(root, "assets/branding/eisen-mark-reversed.svg");
const trayPngPath = path.join(root, "app/src-tauri/icons/tray-icon.png");

// Read original mark SVG paths
let markSvg = await readFile(reversedSvgPath, "utf-8");

// Extract defs and body from eisen-mark-reversed.svg
const defsMatch = markSvg.match(/<defs>([\s\S]*?)<\/defs>/);
const defsContent = defsMatch ? defsMatch[1] : "";

const bodyMatch = markSvg.match(/<\/defs>([\s\S]*?)<\/svg>/);
const bodyContent = bodyMatch ? bodyMatch[1] : "";

// Scale and translate artwork to fill the 64x64 canvas (scale 0.068 gives ~52px tall mark)
const scaledSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <defs>
    ${defsContent}
  </defs>
  <g transform="translate(32 32) scale(0.068) translate(-515 -516)">
    ${bodyContent}
  </g>
</svg>`;

const sharpImport = process.env.EISEN_SHARP_PATH ?? "sharp";
let sharpModule;
try {
  sharpModule = await import(sharpImport.startsWith("/") ? pathToFileURL(sharpImport).href : sharpImport);
} catch (e) {
  console.error("Sharp module import error:", e);
  process.exit(1);
}

const sharp = sharpModule.default ?? sharpModule;

await sharp(Buffer.from(scaledSvg))
  .resize({ width: 64, height: 64 })
  .png()
  .toFile(trayPngPath);

console.log("Successfully generated enlarged transparent tray menu bar icon at", trayPngPath);
