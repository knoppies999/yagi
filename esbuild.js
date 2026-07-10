// Bundles the React webview (webview/main.tsx) into media/webview.js.
// Run directly (`node esbuild.js`) or in watch mode (`node esbuild.js --watch`).
const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["webview/main.tsx"],
  bundle: true,
  outfile: "media/webview.js",
  format: "iife",
  platform: "browser",
  // The webview runs in Electron's Chromium; target a modern engine.
  target: "chrome110",
  jsx: "automatic", // no `import React` needed in each file
  sourcemap: true,
  // Pin NODE_ENV so React bundles its production build (smaller, and avoids
  // any bare `process.env` reference that would throw in the webview).
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  // esbuild never emits eval, so the bundle is CSP-nonce friendly.
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("esbuild: watching webview…");
  } else {
    await esbuild.build(options);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
