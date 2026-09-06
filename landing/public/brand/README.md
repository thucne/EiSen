# EiSen mark assets

The SVG is the canonical EiSen mark source. The PNGs are generated outputs, and are a reconstruction of the raster brand sheet because the original vector source is unavailable.

The mark uses `x=515` as its reflection axis. The PNG generator mirrors the rendered left half after SVG rasterization, and the verifier checks exact RGBA symmetry at every exported size.

The lettering and lockups are also path-based SVGs; they do not depend on an installed font, embed base64 data, or reference external images. The lettering is reused consistently across the wordmark-only, horizontal, vertical, and square lockups.

Useful variants include:

- `eisen-wordmark.svg`, `eisen-wordmark-mono.svg`, and the `on-white`, `on-dark`, and `reversed` versions;
- `eisen-horizontal.svg` and the light, dark, reversed, and monochrome versions;
- `eisen-vertical.svg` and `eisen-square-lockup.svg`, each with light/dark background variants;
- `eisen-mark-reversed.svg` and `eisen-mark-on-dark.svg` for dark surfaces.

Generate the complete text/lockup family, including PNG exports, with:

```bash
# When sharp is installed in this Node project:
node scripts/generate-eisen-brand-variants.mjs

# Otherwise point at a local sharp install:
EISEN_SHARP_PATH=/path/to/node_modules/sharp/lib/index.js \
  node scripts/generate-eisen-brand-variants.mjs
```

Generate the icons with the following repeatable commands.

```bash
node scripts/generate-eisen-icons.mjs

EISEN_SHARP_PATH=/path/to/node_modules/sharp/lib/index.js \
  node scripts/generate-eisen-icons.mjs
```

`scripts/verify-eisen-icons.mjs` checks PNG size, alpha, and left/right symmetry. To also compare against an external 1024×1024 reference PNG, set `EISEN_REFERENCE_PATH`.
