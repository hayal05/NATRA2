import { defineConfig } from "vite";

// Tauri expects a fixed dev server port (see src-tauri/tauri.conf.json -> build.devUrl).
// Vite's default port (5173) does NOT match, so without this config `tauri dev`
// cannot connect to the frontend at all.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: {
      // Don't watch the Rust backend, it has its own recompile/reload cycle.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Only Tauri-prefixed env vars are exposed to the frontend.
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri uses Chromium on Windows/Linux and WebKit on macOS.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
