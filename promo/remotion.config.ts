import { Config } from "@remotion/cli/config";

// Uses the headless shell Playwright already installed, so no browser download is needed.
Config.setBrowserExecutable(
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
);
