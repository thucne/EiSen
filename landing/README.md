# EiSen Landing Page (eisen.a302.link)

Official bilingual (EN / VI) marketing and documentation landing page for **EiSen** — the native, privacy-first screen capture & annotation tool for macOS and Windows.

Built with **Astro 5** and **Tailwind CSS**. Fully static, lightweight client scripts for Smart OS Detection.

---

## Features

- **Cross-Platform & Multilingual:**
  - Default English at `/` (`x-default`, `en`)
  - Vietnamese at `/vi/` (`vi`)
  - Dedicated Windows landing routes at `/windows` and `/vi/windows`
  - Smart OS Detection with auto-switching between macOS DMG and Windows EXE downloads
  - Bidirectional `hreflang` alternate links & automated multilingual `sitemap.xml`
- **Rich Structured Data (SEO):**
  - Schema.org `SoftwareApplication` (macOS 11.0+ & Windows 10/11, 100% Free, v0.2.3 direct links)
  - Schema.org `FAQPage` for Google Rich Snippets
  - OpenGraph & Twitter Card previews
- **Branding & Tokens:**
  - Dark Glassmorphism matching the EiSen native desktop app
  - Local variable fonts (`Plus Jakarta Sans` & `JetBrains Mono`)
- **Direct Downloads & Fast Redirects:**
  - `/download/windows` and `/exe` 302 to GitHub Release `EiSen_0.2.3_x64-setup.exe` (~2.6 MB)
  - `/download/mac` and `/dmg` 302 to GitHub Release `EiSen_0.2.3_aarch64.dmg` (~4.2 MB)
  - Also: `/download`, `/releases`, `/github`
- **Windows disclosure:** The direct NSIS installer is an unsigned compatibility release. The site and GitHub release notes warn that SmartScreen or managed-device policy may block it; users should verify the published SHA-256 sidecar before running.

---

## Development

```bash
# From within landing/ directory:
npm install
npm run dev

# Or from project root:
npm --prefix landing run dev
```

Local preview URL: `http://localhost:4321`

---

## Production Build

```bash
npm --prefix landing run build
```

The output will be generated into `landing/dist/`.

---

## Deploy to Cloudflare Pages (`eisen.a302.link`)

The existing `eisen` Pages project currently has no Git provider attached, so
the canonical production path is the direct Wrangler upload below. A Git
integration can be configured later, but pushing to GitHub alone does not
deploy this project today.

### Method 1: Direct Wrangler CLI (Current production path)
```bash
npm --prefix landing run build
npx wrangler pages deploy landing/dist --project-name eisen
```

### Method 2: Git Integration (Optional)
1. In the **Cloudflare Dashboard** → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Select repository: `thucne/EiSen`.
3. Configure build settings:
   - **Framework preset:** `Astro`
   - **Root directory:** `landing`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Deploy!
5. Add custom domain:
   - In your Cloudflare Pages project settings, go to **Custom domains**.
   - Enter: `eisen.a302.link`.
   - Cloudflare will automatically configure DNS and provision a free SSL certificate.
