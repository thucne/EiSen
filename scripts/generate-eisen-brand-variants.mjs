import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "assets/branding");
const iconInput = path.join(outputDirectory, "eisen-mark.svg");
const sharpImport = process.env.EISEN_SHARP_PATH ?? "sharp";

const colors = {
  dark: "#2B323A",
  light: "#F8FAFB",
  accent: "#029EF0",
  surface: "#202A32",
  surfaceDeep: "#17212B",
  border: "#10161C",
};

const wordmarkShapes = (fill, accent = colors.accent) => `
  <path fill="${fill}" d="M8 16H126V48H42V88H114V120H42V172H126V204H8Z"/>
  <rect x="154" y="72" width="30" height="132" fill="${fill}"/>
  <rect x="154" y="16" width="30" height="30" rx="2" fill="${accent}"/>
  <path fill="${fill}" d="M226 16H344V48H252L238 62V88L250 100H322L348 126V174L318 204H214V172H302L316 158V138L306 128H236L204 96V50Z"/>
  <path fill="${fill}" fill-rule="evenodd" d="M374 92L398 68H466L492 94V148H406V166L414 174H486V204H398L374 180ZM406 98V120H460V106L452 98Z"/>
  <path fill="${fill}" d="M518 68H548V84L566 68H620L646 94V204H614V108L604 98H570L550 118V204H518Z"/>
`;

function extractIconSource(source) {
  const defsStart = source.indexOf("<defs>");
  const defsEnd = source.indexOf("</defs>", defsStart);
  const svgEnd = source.lastIndexOf("</svg>");

  if (defsStart < 0 || defsEnd < 0 || svgEnd < 0) {
    throw new Error("Unable to extract the canonical icon SVG sections");
  }

  return {
    defs: source.slice(defsStart, defsEnd + "</defs>".length),
    body: source.slice(defsEnd + "</defs>".length, svgEnd).trim(),
  };
}

function replaceScanGradient(defs, stops) {
  const gradient = `<linearGradient id="scan-gradient" x1="0" y1="0" x2="0" y2="1">
      ${stops}
    </linearGradient>`;
  return defs.replace(
    /<linearGradient id="scan-gradient"[\s\S]*?<\/linearGradient>/,
    gradient,
  );
}

function iconArtwork(source, mode) {
  if (mode === "normal") return source;

  if (mode === "reversed") {
    const defs = replaceScanGradient(
      source.defs,
      `<stop offset="0" stop-color="${colors.light}"/>
      <stop offset=".60" stop-color="${colors.light}"/>
      <stop offset=".70" stop-color="#BCECF8"/>
      <stop offset=".81" stop-color="#4BC6ED"/>
      <stop offset=".90" stop-color="#0498E3"/>
      <stop offset="1" stop-color="#0097DD"/>`,
    );
    const body = source.body
      .replaceAll("#2B323A", colors.light)
      .replaceAll("#2C343C", colors.light);
    return { defs, body };
  }

  if (mode === "mono") {
    const body = source.body
      .replaceAll("url(#silver-gradient)", colors.dark)
      .replaceAll("url(#axe-silver-gradient)", colors.dark)
      .replaceAll("url(#axe-silver-gradient-right)", colors.dark)
      .replaceAll("url(#cyan-bracket-gradient)", colors.dark)
      .replaceAll("url(#cyan-control-gradient)", colors.dark)
      .replaceAll("url(#amber-gradient)", colors.dark)
      .replaceAll("url(#control-amber-gradient)", colors.dark)
      .replaceAll("url(#scan-gradient)", colors.dark)
      .replaceAll("url(#bar-gradient)", colors.dark)
      .replaceAll("#2C343C", colors.dark);
    return { defs: "", body };
  }

  throw new Error(`Unknown icon mode: ${mode}`);
}

function backgroundMarkup(background, rounded = false) {
  if (background === "white") {
    return `<rect width="100%" height="100%" fill="#FFFFFF"/>`;
  }

  if (background === "dark") {
    return `<rect width="100%" height="100%" fill="${colors.surface}"/>`;
  }

  if (background === "square-dark") {
    return `<rect width="100%" height="100%" fill="${colors.surfaceDeep}"/>
  <rect x="44" y="44" width="936" height="936" rx="178" fill="${colors.surface}" stroke="${colors.border}" stroke-width="3"/>`;
  }

  if (rounded) {
    return `<rect width="100%" height="100%" fill="${colors.surfaceDeep}"/>
  <rect x="44" y="44" width="936" height="936" rx="178" fill="${colors.surface}" stroke="${colors.border}" stroke-width="3"/>`;
  }

  return "";
}

function documentSvg({
  title,
  width,
  height,
  defs = "",
  background = "transparent",
  content,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title">
  <title id="title">${title}</title>
  ${defs}
  ${backgroundMarkup(background)}
  ${content}
</svg>
`;
}

function iconGroup(icon, transform) {
  return `<g transform="${transform}">${icon.body}</g>`;
}

function wordmarkGroup(fill, accent, transform) {
  return `<g transform="${transform}">${wordmarkShapes(fill, accent)}</g>`;
}

function buildWordmark(iconSource, { name, title, fill, accent, background }) {
  const mono = fill === accent;
  return {
    name,
    svg: documentSvg({
      title,
      width: 654,
      height: 220,
      background,
      content: wordmarkGroup(fill, mono ? fill : accent, "translate(0 0) scale(1)"),
    }),
  };
}

function buildLockup(
  iconSource,
  { name, title, width, height, iconMode, fill, accent, background, iconTransform, textTransform },
) {
  const icon = iconArtwork(iconSource, iconMode);
  return {
    name,
    svg: documentSvg({
      title,
      width,
      height,
      defs: icon.defs,
      background,
      content: `${iconGroup(icon, iconTransform)}${wordmarkGroup(fill, accent, textTransform)}`,
    }),
  };
}

function buildMark(iconSource, { name, title, iconMode, background }) {
  const icon = iconArtwork(iconSource, iconMode);
  return {
    name,
    svg: documentSvg({
      title,
      width: 1024,
      height: 1024,
      defs: icon.defs,
      background,
      content: iconGroup(icon, "translate(0 0) scale(1)"),
    }),
  };
}

const rasterPlans = [
  { names: ["eisen-wordmark", "eisen-wordmark-on-white", "eisen-wordmark-reversed", "eisen-wordmark-on-dark", "eisen-wordmark-mono"], widths: [600, 1200, 2400] },
  { names: ["eisen-horizontal", "eisen-horizontal-on-white", "eisen-horizontal-reversed", "eisen-horizontal-on-dark", "eisen-horizontal-mono"], widths: [800, 1600, 3200] },
  { names: ["eisen-vertical", "eisen-vertical-on-white", "eisen-vertical-on-dark"], widths: [1024, 2048] },
  { names: ["eisen-square-lockup", "eisen-square-lockup-on-white", "eisen-square-lockup-on-dark"], widths: [1024, 2048] },
  { names: ["eisen-mark-reversed", "eisen-mark-on-dark"], widths: [1024] },
];

const source = extractIconSource(await readFile(iconInput, "utf8"));

const variants = [
  buildWordmark(source, {
    name: "eisen-wordmark.svg",
    title: "EiSen wordmark",
    fill: colors.dark,
    accent: colors.accent,
    background: "transparent",
  }),
  buildWordmark(source, {
    name: "eisen-wordmark-on-white.svg",
    title: "EiSen wordmark on white",
    fill: colors.dark,
    accent: colors.accent,
    background: "white",
  }),
  buildWordmark(source, {
    name: "eisen-wordmark-reversed.svg",
    title: "EiSen reversed wordmark",
    fill: colors.light,
    accent: colors.accent,
    background: "transparent",
  }),
  buildWordmark(source, {
    name: "eisen-wordmark-on-dark.svg",
    title: "EiSen wordmark on dark",
    fill: colors.light,
    accent: colors.accent,
    background: "dark",
  }),
  buildWordmark(source, {
    name: "eisen-wordmark-mono.svg",
    title: "EiSen monochrome wordmark",
    fill: colors.dark,
    accent: colors.dark,
    background: "transparent",
  }),
  buildLockup(source, {
    name: "eisen-horizontal.svg",
    title: "EiSen horizontal logo",
    width: 1600,
    height: 600,
    iconMode: "normal",
    fill: colors.dark,
    accent: colors.accent,
    background: "transparent",
    iconTransform: "translate(18 -5) scale(.59)",
    textTransform: "translate(690 174) scale(1.25)",
  }),
  buildLockup(source, {
    name: "eisen-horizontal-on-white.svg",
    title: "EiSen horizontal logo on white",
    width: 1600,
    height: 600,
    iconMode: "normal",
    fill: colors.dark,
    accent: colors.accent,
    background: "white",
    iconTransform: "translate(18 -5) scale(.59)",
    textTransform: "translate(690 174) scale(1.25)",
  }),
  buildLockup(source, {
    name: "eisen-horizontal-reversed.svg",
    title: "EiSen reversed horizontal logo",
    width: 1600,
    height: 600,
    iconMode: "reversed",
    fill: colors.light,
    accent: colors.accent,
    background: "transparent",
    iconTransform: "translate(18 -5) scale(.59)",
    textTransform: "translate(690 174) scale(1.25)",
  }),
  buildLockup(source, {
    name: "eisen-horizontal-on-dark.svg",
    title: "EiSen horizontal logo on dark",
    width: 1600,
    height: 600,
    iconMode: "reversed",
    fill: colors.light,
    accent: colors.accent,
    background: "dark",
    iconTransform: "translate(18 -5) scale(.59)",
    textTransform: "translate(690 174) scale(1.25)",
  }),
  buildLockup(source, {
    name: "eisen-horizontal-mono.svg",
    title: "EiSen monochrome horizontal logo",
    width: 1600,
    height: 600,
    iconMode: "mono",
    fill: colors.dark,
    accent: colors.dark,
    background: "transparent",
    iconTransform: "translate(18 -5) scale(.59)",
    textTransform: "translate(690 174) scale(1.25)",
  }),
  buildLockup(source, {
    name: "eisen-vertical.svg",
    title: "EiSen vertical logo",
    width: 1024,
    height: 1200,
    iconMode: "normal",
    fill: colors.dark,
    accent: colors.accent,
    background: "transparent",
    iconTransform: "translate(0 -18) scale(1)",
    textTransform: "translate(185 930) scale(1)",
  }),
  buildLockup(source, {
    name: "eisen-vertical-on-white.svg",
    title: "EiSen vertical logo on white",
    width: 1024,
    height: 1200,
    iconMode: "normal",
    fill: colors.dark,
    accent: colors.accent,
    background: "white",
    iconTransform: "translate(0 -18) scale(1)",
    textTransform: "translate(185 930) scale(1)",
  }),
  buildLockup(source, {
    name: "eisen-vertical-on-dark.svg",
    title: "EiSen vertical logo on dark",
    width: 1024,
    height: 1200,
    iconMode: "reversed",
    fill: colors.light,
    accent: colors.accent,
    background: "dark",
    iconTransform: "translate(0 -18) scale(1)",
    textTransform: "translate(185 930) scale(1)",
  }),
  buildLockup(source, {
    name: "eisen-square-lockup.svg",
    title: "EiSen square logo lockup",
    width: 1024,
    height: 1024,
    iconMode: "normal",
    fill: colors.dark,
    accent: colors.accent,
    background: "transparent",
    iconTransform: "translate(61 -58) scale(.88)",
    textTransform: "translate(201 780) scale(.95)",
  }),
  buildLockup(source, {
    name: "eisen-square-lockup-on-white.svg",
    title: "EiSen square logo lockup on white",
    width: 1024,
    height: 1024,
    iconMode: "normal",
    fill: colors.dark,
    accent: colors.accent,
    background: "white",
    iconTransform: "translate(61 -58) scale(.88)",
    textTransform: "translate(201 780) scale(.95)",
  }),
  buildLockup(source, {
    name: "eisen-square-lockup-on-dark.svg",
    title: "EiSen square logo lockup on dark",
    width: 1024,
    height: 1024,
    iconMode: "reversed",
    fill: colors.light,
    accent: colors.accent,
    background: "square-dark",
    iconTransform: "translate(61 -58) scale(.88)",
    textTransform: "translate(201 780) scale(.95)",
  }),
  buildMark(source, {
    name: "eisen-mark-reversed.svg",
    title: "EiSen reversed mark",
    iconMode: "reversed",
    background: "transparent",
  }),
  buildMark(source, {
    name: "eisen-mark-on-dark.svg",
    title: "EiSen mark on dark",
    iconMode: "reversed",
    background: "dark",
  }),
];

await mkdir(outputDirectory, { recursive: true });
for (const variant of variants) {
  const normalizedSvg = variant.svg.replace(/[ \t]+$/gm, "");
  await writeFile(path.join(outputDirectory, variant.name), normalizedSvg);
}

let sharpModule;
try {
  sharpModule = await import(sharpImport.startsWith("/")
    ? pathToFileURL(sharpImport).href
    : sharpImport);
} catch (error) {
  console.warn("SVG variants generated, but Sharp was unavailable; PNG variants were skipped.");
  console.warn(error);
}

if (sharpModule) {
  const sharp = sharpModule.default ?? sharpModule;
  const variantByName = new Map(variants.map((variant) => [variant.name, variant.svg]));

  for (const plan of rasterPlans) {
    for (const name of plan.names) {
      const svg = variantByName.get(`${name}.svg`);
      if (!svg) throw new Error(`Missing generated SVG variant: ${name}.svg`);

      for (const width of plan.widths) {
        await sharp(Buffer.from(svg))
          .resize({ width })
          .png({ compressionLevel: 9 })
          .toFile(path.join(outputDirectory, `${name}-${width}.png`));
      }
    }
  }
}

console.log(`Generated ${variants.length} SVG brand variants in ${outputDirectory}`);
