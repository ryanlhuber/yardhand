# Develop

```sh
npm install
npm run check   # typecheck, build, tests
```

Node 20+. Zero runtime dependencies: `@clack/prompts` is bundled at build time, and the viewer's page (`src/ui/client/`) is bundled into `dist/cli.js` as text. Tailwind is a build-time tool only: `npm run build` compiles `src/ui/styles.css` to `src/ui/client/ui.css` (not committed) before bundling.

[SPEC.md](../SPEC.md) is the source of truth. Code and tests follow it.
