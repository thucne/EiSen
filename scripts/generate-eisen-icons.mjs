import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "assets/branding/eisen-mark.svg");
const output = path.dirname(input);
const sizes = [16, 32, 64, 128, 256, 512, 1024];
const symmetryAxis = 515;
const sharpImport = process.env.EISEN_SHARP_PATH ?? "sharp";

function mirrorRaster(data, info, size) {
  const mirrorIndex = Math.round((2 * symmetryAxis * size) / 1024 - 1);
  const channels = info.channels;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mirrorX = mirrorIndex - x;
      if (mirrorX < 0 || mirrorX >= size || x >= mirrorX) {
        continue;
      }

      const left = (y * size + x) * channels;
      const right = (y * size + mirrorX) * channels;
      for (let channel = 0; channel < channels; channel += 1) {
        data[right + channel] = data[left + channel];
      }
    }
  }

  return data;
}

let sharpModule;
try {
  sharpModule = await import(sharpImport.startsWith("/")
    ? pathToFileURL(sharpImport).href
    : sharpImport);
} catch (error) {
  console.error(
    `Unable to load Sharp. Install sharp or run: EISEN_SHARP_PATH=/path/to/sharp/lib/index.js node scripts/generate-eisen-icons.mjs`,
  );
  console.error(error);
  process.exitCode = 1;
}

if (sharpModule) {
  const sharp = sharpModule.default ?? sharpModule;
  const svg = await readFile(input);

  await mkdir(output, { recursive: true });
  for (const size of sizes) {
    const rendered = await sharp(svg)
      .resize({ width: size, height: size, fit: "fill" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const raw = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });
    const mirrored = mirrorRaster(raw.data, raw.info, size);

    await sharp(mirrored, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: raw.info.channels,
      },
    })
      .png({ compressionLevel: 9 })
      .toFile(path.join(output, `eisen-mark-${size}.png`));
  }
}
