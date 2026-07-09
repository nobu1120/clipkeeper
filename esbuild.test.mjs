import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist-test", { recursive: true });

// Browser-side bundle: pure content-extraction logic exposed as a global,
// for testing in a normal (non-extension) page via puppeteer.
await esbuild.build({
  entryPoints: ["src/content/extract.ts"],
  bundle: true,
  format: "iife",
  globalName: "ClipKeepExtract",
  target: "chrome110",
  outfile: "dist-test/extract.browser.js",
});

// Node-side bundle: background message handler + libs, for testing business
// logic (freemium quota, Notion API request shaping) directly in Node with a
// stubbed `chrome` global and stubbed `fetch` — no real browser needed.
await esbuild.build({
  entryPoints: ["src/background/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  outfile: "dist-test/background.node.mjs",
});

console.log("Test bundles built.");
