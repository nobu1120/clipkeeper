import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

cpSync("public", outdir, { recursive: true });

mkdirSync(`${outdir}/popup`, { recursive: true });
mkdirSync(`${outdir}/options`, { recursive: true });
for (const file of ["popup.html", "popup.css"]) {
  cpSync(`src/popup/${file}`, `${outdir}/popup/${file}`);
}
for (const file of ["options.html", "options.css"]) {
  cpSync(`src/options/${file}`, `${outdir}/options/${file}`);
}

const entryPoints = [
  { in: "src/background/index.ts", out: "background" },
  { in: "src/content/index.ts", out: "content" },
  { in: "src/popup/popup.ts", out: "popup/popup" },
  { in: "src/options/options.ts", out: "options/options" },
];

const ctx = await esbuild.context({
  entryPoints,
  bundle: true,
  format: "esm",
  target: "chrome110",
  outdir,
  sourcemap: true,
  logLevel: "info",
});

if (watch) {
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
