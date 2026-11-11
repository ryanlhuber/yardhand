# yardhand

File-based issue tracking that lives in your repo. Status is a folder, an issue is a folder, and every rule is mechanical, so a script or an AI model can follow it. Built for one developer working with several models.

## Run it

Node 20 or newer. Use your project's package manager:

| Package manager | Prefix |
|---|---|
| npm | `npx yardhand@latest` |
| pnpm | `pnpm dlx yardhand@latest` |
| bun | `bunx yardhand@latest` |

Below, `yardhand init` means `npx yardhand init`, `pnpm dlx yardhand init`, or `bunx yardhand init`. If your `package.json` pins pnpm (`devEngines` or `packageManager`), npm fails with `EBADDEVENGINES`, so use `pnpm dlx` there.

Nothing is installed into your project. `init` writes plain files only.

## Commands

| Command | What it does |
|---|---|
| `yardhand init` | Sets up tracking in this repo: creates `issues/`, `issues/yardhand.json`, one folder per status, the `000-maintain-repo` issue, and a rules block in `AGENTS.md` (and `CLAUDE.md` if present). Asks which statuses to use; `backlog` and `done` are always included. |
| `yardhand init --yes --statuses a,b,c` | Same, without questions. `--statuses` sets your statuses in order (default `backlog,in-progress,done`). Add `--force` to re-run in a repo that is already set up. |
| `yardhand new <slug>` | Creates an issue with the next free ID in the first status and prints its ID and path. The slug is lowercase kebab-case, verb first, like `add-auth`. |
| `yardhand new <slug> --parent 017` | Creates a child of `017` (it gets `017.01`, or the next free number). Also accepts `--kind task\|bug` (default `task`) and `--assignee <name>`. |
| `yardhand move <id> <status>` | Moves the issue folder to another status and updates `status:` in its `ISSUE.md`. |
| `yardhand validate` | Checks every issue and reports each problem with its path. Exits `1` if anything is wrong, so it works in CI. |
| `yardhand --help`, `--version` | Prints the commands, or the installed version. |

## Layout

```
issues/
  yardhand.json            # statuses, in order
  backlog/
    000-maintain-repo/     # catch-all for maintenance and bugs with no clear home
      ISSUE.md
    017-add-auth/
      ISSUE.md
      notes.md             # reference files sit beside ISSUE.md
    017.01-add-login/
      ISSUE.md
  in-progress/
    017.01.01-build-login-form/
      ISSUE.md
  done/
```

An issue's status is the folder it is in. Reference files inside an issue use relative paths, never `issues/<status>/...`.

## Numbering

The ID shows what rolls up to what.

| ID | Level | Meaning |
|---|---|---|
| `017` | 1 | A big thing: a feature or goal |
| `017.01` | 2 | A piece of it |
| `017.01.01` | 3 | A buildable unit: one model session |

- Three levels at most. The first part is three digits, later parts are two (`01` to `99`). There are no zero children: `017.00` is invalid.
- `000` is the catch-all for maintenance and bugs with no clear home. `init` creates `000-maintain-repo`.
- IDs are permanent and never reused, even after an issue is done. The next ID is the highest existing one plus one, counting every status folder.
- Nobody invents IDs. `yardhand new` picks the next free one.
- The folder is `<id>-<slug>`. Slugs can change; the ID is the key.
- A bug is a normal issue with `kind: bug`.

## ISSUE.md

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

`id` matches the folder name. `kind` is `task` or `bug`. `parent` is the ID one level up (omit it for level 1) and is the source of truth for rollup, so moving work to a new parent means changing `parent:`, not the folder or ID. `status` matches the folder (`move` keeps them in sync). `assignee` and `released-in` (a version like `1.4.0`) are optional.

## Rules

[SPEC.md](SPEC.md) is the source of truth for the layout, IDs, `ISSUE.md` format, and commands.

## Develop

```sh
npm install
npm run check   # typecheck, build, tests
```

Node 20+. Zero runtime dependencies: `@clack/prompts` is bundled at build time.
