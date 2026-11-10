# yardhand

File-based issue tracking that lives in your repo. Status is a folder, an issue is a folder, and every rule is mechanical, so a script or an AI model can follow it. Built for one developer working with several models. No agile vocabulary.

Working name. The name is defined in one place (`src/names.ts`).

## Use

```sh
npx yardhand init          # pick statuses; creates issues/ and an AGENTS.md block
npx yardhand new add-auth  # -> 001 issues/backlog/001-add-auth/ISSUE.md
npx yardhand new add-login --parent 001
npx yardhand move 001.01 in-progress
npx yardhand validate
```

`init` runs interactively in a terminal. For scripts and models: `yardhand init --yes --statuses backlog,review-1,done`.

Nothing is installed into your project. `init` writes plain files only: `issues/`, `issues/yardhand.json`, and a generated block in `AGENTS.md` (and `CLAUDE.md` if present) that tells models how to use the tracker.

## Rules

See [SPEC.md](SPEC.md). It is the source of truth for the layout, IDs, `ISSUE.md` format, and commands.

## Develop

```sh
npm install
npm run check   # typecheck, build, tests
```

Node 20+. Zero runtime dependencies: `@clack/prompts` is bundled at build time.
