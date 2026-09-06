import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.join(root, "assets/branding/eisen-mark.svg");
const output = path.dirname(input);
const preview = "/private/tmp/eisen-mark-preview.png";
const comparison = "/private/tmp/eisen-mark-reference-comparison.png";
const reference = process.env.EISEN_REFERENCE_PATH;
const sizes = [16, 32, 64, 128, 256, 512, 1024];
const symmetryAxis = 515;
const sharpImport = process.env.EISEN_SHARP_PATH ?? "sharp";
const isSelfTest = process.argv.includes("--self-test");

function rejectExternalSvgContent(svg) {
  const disallowedPatterns = [
    [/<\s*(?:image|script|foreignObject)\b/i, "disallowed SVG element"],
    [
      /\b(?:href|xlink\s*:\s*href|src)\s*=/i,
      "linked-content attribute",
    ],
    [/<!\s*(?:DOCTYPE|ENTITY)\b/i, "external XML declaration"],
    [/<\?\s*xml-stylesheet\b/i, "stylesheet processing instruction"],
    [/@import\b/i, "stylesheet import"],
    [/\b(?:data\s*:|base64\b)/i, "embedded content"],
  ];

  for (const [pattern, reason] of disallowedPatterns) {
    if (pattern.test(svg)) {
      throw new Error(`SVG must not contain external or linked content: ${reason}`);
    }
  }

  for (const match of svg.matchAll(/url\s*\(\s*([\s\S]*?)\s*\)/gi)) {
    const value = match[1].trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    if (!value.startsWith("#")) {
      throw new Error("SVG must not contain external or linked content: non-fragment url()");
    }
  }
}

function runSelfTest() {
  const allowedSvg =
    '<svg><defs><linearGradient id="cyanGradient" /></defs><path fill="url(#cyanGradient)" stroke="url( \'#cyanGradient\' )" /></svg>';
  const bypasses = [
    '<svg><image /></svg>',
    '<svg><script /></svg>',
    '<svg><foreignObject><div>linked content</div></foreignObject></svg>',
    '<svg><use href = "https://example.test/mark.svg" /></svg>',
    '<svg><use xlink:href = "#another-mark" /></svg>',
    '<svg><use src = "https://example.test/mark.svg" /></svg>',
    '<!DOCTYPE svg [<!ENTITY payload SYSTEM "https://example.test/payload">]><svg />',
    '<?xml-stylesheet href = "https://example.test/icon.css"?><svg />',
    '<svg><style>@import "https://example.test/icon.css";</style></svg>',
    '<svg><style>.mark { fill: url(https://example.test/paint.svg); }</style></svg>',
    '<svg><path fill="url( \'https://example.test/paint.svg\' )" /></svg>',
    '<svg><image href="data:image/png;base64,AAAA" /></svg>',
  ];

  rejectExternalSvgContent(allowedSvg);
  for (const svg of bypasses) {
    assert.throws(() => rejectExternalSvgContent(svg));
  }

  console.log("PASS SVG external-reference regression cases");
}

if (isSelfTest) {
  runSelfTest();
} else {
  let sharpModule;
  try {
    sharpModule = await import(sharpImport.startsWith("/")
      ? pathToFileURL(sharpImport).href
      : sharpImport);
  } catch (error) {
    console.error(
      "Unable to load Sharp. Install sharp or run: EISEN_SHARP_PATH=/path/to/sharp/lib/index.js node scripts/verify-eisen-icons.mjs",
    );
    console.error(error);
    process.exitCode = 1;
  }

  if (sharpModule) {
    const sharp = sharpModule.default ?? sharpModule;
    const svg = await readFile(input, "utf8");

    rejectExternalSvgContent(svg);

    for (const size of sizes) {
      const file = path.join(output, `eisen-mark-${size}.png`);
      const metadata = await sharp(file).metadata();

      if (metadata.format !== "png") {
        throw new Error(`${file} must be a PNG`);
      }
      if (metadata.width !== size || metadata.height !== size) {
        throw new Error(`${file} must be ${size}x${size}`);
      }
      if (metadata.hasAlpha !== true) {
        throw new Error(`${file} must have an alpha channel`);
      }

      console.log(`PASS ${size}px PNG format, dimensions, and alpha`);

      const { data, info } = await sharp(file)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const mirrorIndex = Math.round((2 * symmetryAxis * size) / 1024 - 1);
      let mismatches = 0;
      let unpairedPixels = 0;

      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const mirrorX = mirrorIndex - x;
          const pixel = (y * size + x) * info.channels;

          if (mirrorX < 0 || mirrorX >= size) {
            if (data[pixel + 3] !== 0) {
              unpairedPixels += 1;
            }
            continue;
          }
          if (x >= mirrorX) {
            continue;
          }

          const mirrorPixel = (y * size + mirrorX) * info.channels;
          for (let channel = 0; channel < info.channels; channel += 1) {
            if (data[pixel + channel] !== data[mirrorPixel + channel]) {
              mismatches += 1;
              break;
            }
          }
        }
      }

      if (mismatches !== 0 || unpairedPixels !== 0) {
        throw new Error(
          `${file} must be an exact horizontal reflection around x=${symmetryAxis}; ` +
            `${mismatches} mismatched pairs, ${unpairedPixels} unpaired pixels`,
        );
      }

      console.log(`PASS ${size}px exact horizontal reflection`);
    }

    await sharp(Buffer.from(svg))
      .resize({ width: 1024, height: 1024, fit: "fill" })
      .png()
      .toFile(preview);

    if (!reference) {
      console.log(
        "SKIP reference comparison (set EISEN_REFERENCE_PATH to a 1024×1024 PNG)",
      );
    } else {
      const referenceImage = await readFile(reference);
      const referenceMetadata = await sharp(referenceImage).metadata();
      if (referenceMetadata.width !== 1024 || referenceMetadata.height !== 1024) {
        throw new Error(`${reference} must be 1024x1024`);
      }

      const labelHeight = 96;
      const panelWidth = 1024;
      const label = (text, background) =>
        Buffer.from(`<svg width="${panelWidth}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="${background}"/>
        <text x="${panelWidth / 2}" y="60" text-anchor="middle"
          font-family="Arial, sans-serif" font-size="32" font-weight="700"
          fill="#17212b">${text}</text>
      </svg>`);

      await sharp({
        create: {
          width: panelWidth * 2,
          height: 1024 + labelHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite([
          { input: label("SUPPLIED REFERENCE", "#f3f4f6"), left: 0, top: 0 },
          { input: label("SVG PREVIEW", "#dff5ff"), left: panelWidth, top: 0 },
          { input: referenceImage, left: 0, top: labelHeight },
          { input: await readFile(preview), left: panelWidth, top: labelHeight },
        ])
        .png()
        .toFile(comparison);

      console.log(`COMPARISON ${comparison}`);
    }
  }
}
