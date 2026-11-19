import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "tsup";
import type { Plugin } from "esbuild";

// The viewer's page (src/ui/client) is served by the CLI itself, so its files are bundled as
// text into dist/cli.js. The published package stays one file with no runtime dependencies.
// ui.css is compiled by Tailwind first (npm run build:css).
const clientAsText: Plugin = {
  name: "client-as-text",
  setup(build) {
    // A private namespace, so tsup's own CSS handling never sees ui.css.
    build.onResolve({ filter: /^\.\/client\/[^/]+\.(html|css|js)$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path),
      namespace: "client-text",
    }));
    build.onLoad({ filter: /.*/, namespace: "client-text" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    target: "node20",
    outDir: "dist",
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
    // Bundle every dependency so the published package has none at runtime.
    noExternal: [/.*/],
    esbuildPlugins: [clientAsText],
    // tsup handles .css itself before any plugin; this makes it hand over the text too.
    loader: { ".css": "text" },
  },
  {
    entry: ["test/*.test.ts"],
    format: ["esm"],
    target: "node20",
    outDir: "dist-test",
    clean: true,
    bundle: true,
    splitting: false,
    // Keep the `node:` prefix: node:test has no unprefixed form.
    removeNodeProtocol: false,
    esbuildPlugins: [clientAsText],
    // tsup handles .css itself before any plugin; this makes it hand over the text too.
    loader: { ".css": "text" },
  },
]);
