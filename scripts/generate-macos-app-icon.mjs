import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markSvgPath = path.join(root, "assets/branding/eisen-mark.svg");
const outputDir = path.join(root, "app/src-tauri/icons");

let markSvg = await readFile(markSvgPath, "utf-8");

const defsMatch = markSvg.match(/<defs>([\s\S]*?)<\/defs>/);
const defsContent = defsMatch ? defsMatch[1] : "";

const bodyMatch = markSvg.match(/<\/defs>([\s\S]*?)<\/svg>/);
const bodyContent = bodyMatch ? bodyMatch[1] : "";

const scale = 0.80;
const tx = (1024 * (1 - scale)) / 2;
const ty = (1024 * (1 - scale)) / 2;

const macosIconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    ${defsContent}
    <linearGradient id="macos-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F1F4F9"/>
    </linearGradient>
    <linearGradient id="macos-border" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(255, 255, 255, 0.90)"/>
      <stop offset="100%" stop-color="rgba(0, 0, 0, 0.12)"/>
    </linearGradient>
    <filter id="macos-drop-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="16" stdDeviation="16" flood-color="#000000" flood-opacity="0.30"/>
    </filter>
  </defs>

  <rect x="92" y="92" width="840" height="840" rx="186" fill="url(#macos-bg)" filter="url(#macos-drop-shadow)"/>
  <rect x="92" y="92" width="840" height="840" rx="186" fill="none" stroke="url(#macos-border)" stroke-width="3"/>

  <g transform="translate(${tx} ${ty}) scale(${scale})">
    ${bodyContent}
  </g>
</svg>`;

const masterSvgPath = path.join(outputDir, "macos-icon-master.svg");
await writeFile(masterSvgPath, macosIconSvg, "utf-8");

const sharpImport = process.env.EISEN_SHARP_PATH ?? "sharp";
let sharpModule;
try {
  sharpModule = await import(sharpImport.startsWith("/") ? pathToFileURL(sharpImport).href : sharpImport);
} catch (e) {
  console.error("Sharp module import error:", e);
  process.exit(1);
}

const sharp = sharpModule.default ?? sharpModule;
const target1024 = path.join(outputDir, "icon.png");

await sharp(Buffer.from(macosIconSvg))
  .resize({ width: 1024, height: 1024 })
  .png()
  .toFile(target1024);

const iconsetDir = path.join(outputDir, "icon.iconset");
await rm(iconsetDir, { recursive: true, force: true });
await mkdir(iconsetDir, { recursive: true });

const sizes = [
  { name: "icon_16x16.png", sz: 16 },
  { name: "icon_16x16@2x.png", sz: 32 },
  { name: "icon_32x32.png", sz: 32 },
  { name: "icon_32x32@2x.png", sz: 64 },
  { name: "icon_128x128.png", sz: 128 },
  { name: "icon_128x128@2x.png", sz: 256 },
  { name: "icon_256x256.png", sz: 256 },
  { name: "icon_256x256@2x.png", sz: 512 },
  { name: "icon_512x512.png", sz: 512 },
  { name: "icon_512x512@2x.png", sz: 1024 },
];

const icoBuffers = [];

for (const item of sizes) {
  const outPath = path.join(iconsetDir, item.name);
  const buf = await sharp(target1024)
    .resize({ width: item.sz, height: item.sz })
    .png()
    .toBuffer();
  await writeFile(outPath, buf);

  if ([16, 32, 48, 64, 128, 256].includes(item.sz)) {
    icoBuffers.push({ width: item.sz, height: item.sz, buffer: buf });
  }
}

execSync(`cp "${path.join(iconsetDir, "icon_128x128.png")}" "${path.join(outputDir, "128x128.png")}"`);
execSync(`cp "${path.join(iconsetDir, "icon_128x128@2x.png")}" "${path.join(outputDir, "128x128@2x.png")}"`);
execSync(`cp "${path.join(iconsetDir, "icon_32x32.png")}" "${path.join(outputDir, "32x32.png")}"`);

const icnsPath = path.join(outputDir, "icon.icns");
execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);

// Create Windows icon.ico
function createIco(items) {
  const count = items.length;
  const headerSize = 6 + count * 16;
  let dataOffset = headerSize;
  const entries = [];

  for (const item of items) {
    const w = item.width >= 256 ? 0 : item.width;
    const h = item.height >= 256 ? 0 : item.height;
    const size = item.buffer.length;

    const entry = Buffer.alloc(16);
    entry.writeUInt8(w, 0);
    entry.writeUInt8(h, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(size, 8);
    entry.writeUInt32LE(dataOffset, 12);

    entries.push(entry);
    dataOffset += size;
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  return Buffer.concat([header, ...entries, ...items.map((b) => b.buffer)]);
}

const icoPath = path.join(outputDir, "icon.ico");
await writeFile(icoPath, createIco(icoBuffers));

await rm(iconsetDir, { recursive: true, force: true });

console.log("Successfully generated native icon.icns (macOS) and icon.ico (Windows)!");
