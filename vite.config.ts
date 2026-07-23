import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Pick the right nitro preset for the deploy target.
// - On Vercel, VERCEL=1 is set during the build; use the "vercel" preset.
// - Allow override via NITRO_PRESET env var.
// - Default to Cloudflare Workers (Lovable's hosting).
const nitroPreset =
  process.env.NITRO_PRESET ||
  (process.env.VERCEL ? "vercel" : "cloudflare-module");

// Lovable's vite-tanstack-config forces nitro output into ./dist, but Vercel's
// Build Output API requires the exact layout below at the repo root. Without
// these overrides, .vercel/output only contains config.json (no server bundle
// or static assets) and every deployed URL returns 404 NOT_FOUND.
const nitroOutput =
  nitroPreset === "vercel"
    ? {
        dir: ".vercel/output",
        serverDir: ".vercel/output/functions/__server.func",
        publicDir: ".vercel/output/static",
      }
    : undefined;

export default defineConfig({
  tanstackStart: {
    server: {
      entry: "server",
    },
  },

  nitro: {
    preset: nitroPreset,
    ...(nitroOutput ? { output: nitroOutput } : {}),
  },
});
