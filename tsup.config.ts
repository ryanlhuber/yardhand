import { defineConfig } from "tsup";

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
  },
]);
