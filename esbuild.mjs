import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
  // `vscode` is provided by the VS Code runtime, never bundled.
  external: ["vscode"],
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("[esbuild] watching extension host...");
} else {
  await build(options);
}
