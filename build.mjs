// Baut src/ zu einem einzigen ES-Modul dist/ebike-cards.js (das lädt HACS bzw. das Dashboard)
//   node build.mjs           einmalig bauen
//   node build.mjs --watch   bei Änderungen neu bauen
//   node build.mjs --serve   neu bauen und die Demo unter http://localhost:8000/demo/ ausliefern

import * as esbuild from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url)));
const watch = process.argv.includes("--watch");
const serve = process.argv.includes("--serve");

const options = {
  entryPoints: ["src/index.js"],
  outfile: "dist/ebike-cards.js",
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: false,
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `/* ${pkg.name} v${pkg.version} – ${pkg.homepage} */` },
  logLevel: "info",
};

if (watch || serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  if (serve) {
    const { port } = await ctx.serve({ servedir: ".", port: 8000 });
    console.log(`Demo: http://localhost:${port}/demo/`);
  }
} else {
  await esbuild.build(options);
}
