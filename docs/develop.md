# Develop

```sh
npm install
npm run check   # typecheck, build, tests
```

Node 20+. Zero runtime dependencies: `@clack/prompts` is bundled at build time, and the viewer's page (`src/ui/client/`) is bundled into `dist/cli.js` as text. Tailwind is a build-time tool only: `npm run build` compiles `src/ui/styles.css` to `src/ui/client/ui.css` (not committed) before bundling.

[SPEC.md](../SPEC.md) is the source of truth. Code and tests follow it.

## Cutting a release

1. Make sure every issue that ships is in `done`, then run `npx yardhand release <version>`. It stamps `released-in:` on those issues and writes `issues/releases/<version>.md`.
2. Move the **Unreleased** notes in [CHANGELOG.md](../CHANGELOG.md) under a heading for the new version, using the release file as the list of what shipped.
3. Run `npm version <version>` and `git push --follow-tags`. The tag starts the Publish workflow, which publishes to npm with provenance.
