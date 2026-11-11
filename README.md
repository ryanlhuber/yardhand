# yardhand

File-based issue tracking that lives in your repo. Status is a folder, an issue is a folder, and every rule is mechanical, so a script or an AI model can follow it. Built for one developer working with several models. No agile vocabulary.

Working name. The name is defined in one place (`src/names.ts`).

## Use

Run it with whichever package manager your project uses. Node 20 or newer is required (bun runs it through Node).

| Package manager | Run a command |
|---|---|
| npm | `npx yardhand@latest <command>` |
| pnpm | `pnpm dlx yardhand@latest <command>` |
| bun | `bunx yardhand@latest <command>` |

Use your project's own runner. If its `package.json` pins a package manager (`devEngines` or `packageManager`), npm refuses to run in a pnpm project (error `EBADDEVENGINES`), so use `pnpm dlx` there.

The examples below use `npx`. Swap in `pnpm dlx` or `bunx`.

Nothing is installed into your project. `init` writes plain files only: `issues/`, `issues/yardhand.json`, and a generated block in `AGENTS.md` (and `CLAUDE.md` if present) that tells models how to use the tracker.

## How issues are laid out

Status is the folder an issue is in. Each issue is its own folder holding `ISSUE.md` plus any reference files (notes, images).

```
issues/
  yardhand.json            # the list of statuses, in order
  backlog/
    000-maintain-repo/     # catch-all for maintenance and bugs with no clear home
      ISSUE.md
    017-add-auth/
      ISSUE.md
      notes.md             # reference files live beside ISSUE.md
    017.01-add-login/
      ISSUE.md
  in-progress/
    017.01.01-build-login-form/
      ISSUE.md
  done/
```

Moving an issue to a new status means moving its folder. The `move` command does this for you.

## How issues are numbered

Every issue has an ID, and the ID shows what rolls up to what. The number of parts tells you the level:

| ID | Level | Meaning |
|---|---|---|
| `017` | 1 | A big thing: a feature or a goal |
| `017.01` | 2 | A piece of it |
| `017.01.01` | 3 | A buildable unit: one model session |

- **Three levels at most.** Nothing goes below `017.01.01`.
- **Padding.** The first part is three digits (`001` to `999`). The parts after it are two digits (`01` to `99`).
- **No zero children.** `017` is a valid ID. `017.00` and `017.00.00` are not.
- **`000` is the catch-all.** It holds maintenance and bugs that have no clear home. `init` creates `000-maintain-repo` for it, so you can add `000.01`, `000.02` and so on under it.
- **IDs are permanent.** They are never reused, even after an issue is done. The next number is always one more than the highest existing one, counting every status folder, including `done/`.
- **Nobody invents IDs.** People and models run `yardhand new`, which picks the next free number.
- **The folder name is `<id>-<slug>`.** The slug is lowercase kebab-case and starts with a verb, like `add-auth`. A slug can change later, and the ID stays the key.
- **Bugs are not a separate kind of ID.** A bug is a normal issue with `kind: bug`.

Each `ISSUE.md` starts with a small block of settings:

```
---
id: 017.01.01
kind: task
parent: 017.01
status: backlog
assignee:
released-in:
---

## Description

## Acceptance criteria
```

- `id`: must match the ID in the folder name.
- `kind`: `task` or `bug`.
- `parent`: the ID one level up. Leave it out for a level 1 issue. If you move work to a different parent, keep the folder and ID and change `parent:`. That field is the source of truth for rollup.
- `status`: must match the status folder the issue is in. `move` keeps the two in sync.
- `assignee`: optional. Which model or person owns it.
- `released-in`: optional. The release version when it shipped, like `1.4.0`.

## Commands

### Set up: `init`

```sh
npx yardhand init --yes --statuses backlog,in-progress,done
```

- `npx yardhand`: run yardhand.
- `init`: set up issue tracking in this repo. Run it once, from the repo root. Without any options it asks you which statuses you want. `backlog` and `done` are always included.
- `--yes` (or `-y`): skip the questions and use the defaults. Use this for scripts and models, since there is no one to answer.
- `--statuses backlog,in-progress,done`: your statuses, in order, separated by commas. The first is where new issues start, and the last is the final one. `backlog` must be first and `done` must be last. Without this option, `--yes` uses `backlog,in-progress,done`.
- `--force`: not in the example. Add it to run `init` again in a repo that is already set up. Without it, `init` refuses to overwrite an existing `yardhand.json`.

What it creates: the `issues/` folder, `issues/yardhand.json`, one folder per status, the `000-maintain-repo` issue, and a block in `AGENTS.md` (and `CLAUDE.md` if you have one) that tells models the rules. It also prints a suggestion for installing Depot's skills, and never runs it.

### Add an issue: `new`

```sh
npx yardhand new add-login --parent 017 --kind task --assignee codex
```

- `npx yardhand`: run yardhand.
- `new`: create an issue. It picks the next free ID, makes the folder, and writes `ISSUE.md` from the template.
- `add-login`: the slug. This is required. It becomes part of the folder name, and it should be lowercase kebab-case starting with a verb.
- `--parent 017`: make this issue a child of `017`, so it gets the ID `017.01` (or the next free one). Without it, you get a new level 1 issue like `018`. The parent must already exist, and it cannot be a level 3 issue, because three levels is the limit.
- `--kind task`: `task` (the default) or `bug`.
- `--assignee codex`: who owns it. Optional, single line, and it can't contain `#`.

It prints the new ID and the path, for example `017.01 issues/backlog/017.01-add-login/ISSUE.md`. New issues always start in the first status.

### Change an issue's status: `move`

```sh
npx yardhand move 017.01 in-progress
```

- `npx yardhand`: run yardhand.
- `move`: change an issue's status.
- `017.01`: the ID of the issue to move.
- `in-progress`: the status to move it to. It must be one of the statuses in `yardhand.json`.

It moves the issue folder into the new status folder and updates `status:` in `ISSUE.md` so the two always agree. It fails if the ID isn't found, the status doesn't exist, or the destination already holds a folder with that name. It prints the old and new paths.

### Check everything: `validate`

```sh
npx yardhand validate
```

- `npx yardhand`: run yardhand.
- `validate`: check every issue and report every problem with its path. It takes no options.

It checks that:
- `yardhand.json` is valid, and every status has a folder.
- Every issue folder is named `<id>-<slug>` with a valid ID and slug.
- Every issue has an `ISSUE.md` with valid settings, and `id` matches the folder name.
- `status` matches the folder the issue is in.
- `kind` is `task` or `bug`.
- No two issues share an ID.
- Every `parent` exists, and a level 1 issue has none.
- `released-in`, when set, is a valid version.

It exits with `0` when everything is fine and `1` when there is a problem, so you can run it in CI or before finishing work.

### Help and version

```sh
npx yardhand --help
npx yardhand --version
```

- `--help`: prints the list of commands.
- `--version`: prints the installed version.

## Rules

See [SPEC.md](SPEC.md). It is the source of truth for the layout, IDs, `ISSUE.md` format, and commands.

## Develop

```sh
npm install
npm run check   # typecheck, build, tests
```

Node 20+. Zero runtime dependencies: `@clack/prompts` is bundled at build time.
