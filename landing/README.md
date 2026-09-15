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
  - Schema.org `SoftwareApplication` (macOS 11.0+ & Windows 10/11, 100% Free, v0.2.0 direct links)
  - Schema.org `FAQPage` for Google Rich Snippets
  - OpenGraph & Twitter Card previews
- **Branding & Tokens:**
  - Dark Glassmorphism matching the EiSen native desktop app
  - Local variable fonts (`Plus Jakarta Sans` & `JetBrains Mono`)
- **Direct Downloads & Fast Redirects:**
  - `/download/windows` and `/exe` 302 to GitHub Release `EiSen_0.2.0_x64-setup.exe` (~4.5 MB)
  - `/download/mac` and `/dmg` 302 to GitHub Release `EiSen_0.2.0_aarch64.dmg` (~4.2 MB)
  - Also: `/download`, `/releases`, `/github`

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

### Method 1: Git Integration (Recommended)
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

### Method 2: Direct Wrangler CLI Deployment
```bash
npm --prefix landing run build
npx wrangler pages deploy landing/dist --project-name eisen
```
