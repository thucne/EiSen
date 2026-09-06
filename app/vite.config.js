import { configDefaults, defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],

  // Vitest projects: pure logic tests stay on node; *.svelte.test.ts mount
  // components against happy-dom. `extends: true` inherits the sveltekit()
  // plugin (needed for $lib aliases and .svelte compilation).
  test: {
    /** @type {import("vitest/config").TestProjectConfiguration[]} */
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "src/**/*.svelte.test.ts"],
        },
      },
      {
        extends: true,
        // Svelte ships separate client/server entries; without the `browser`
        // condition vitest resolves the SSR build whose `mount()` throws.
        resolve: {
          conditions: ["browser"],
        },
        test: {
          name: "component",
          environment: "happy-dom",
          include: ["src/**/*.svelte.test.ts"],
          setupFiles: ["src/tests/component-setup.ts"],
        },
      },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
