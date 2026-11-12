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
| `yardhand new <slug> --parent 017` | Creates a child of `017` (it gets `017.01`, or the next free number). Also accepts `--kind task\|bug` (default `task`) and `--assignee <name>`. `--kind bug` adds `bug-` to the folder name, so don't type it in the slug. |
| `yardhand new <slug> --priority 1 --depends-on 017.02 --related 009` | Sets priority and links when you create the issue: `--priority` is `1`, `2` or `3` (1 is highest) and adds `p1-`, `p2-` or `p3-` to the folder name; `--depends-on` lists issues that must be finished first; `--related` lists linked issues that don't block. Both take comma-separated IDs that must already exist. |
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
    017.01.02-p1-bug-login-redirect-loop/   # priority 1 bug
      ISSUE.md
  in-progress/
    017.01.01-p2-build-login-form/          # priority 2
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
- The folder is `<id>-[p1|p2|p3-][bug-]<slug>`. Slugs can change; the ID is the key.
- A bug is a normal issue with `kind: bug`.

### Folder name prefixes

Priority and bug status show in the folder name, so you can read them in a file tree without opening files.

| Prefix | Meaning |
|---|---|
| `p1-` | Priority 1, the highest |
| `p2-` | Priority 2 |
| `p3-` | Priority 3 |
| `bug-` | The issue is a bug |

```
017.01.02-p1-bug-login-redirect-loop
017.01.01-p1-add-login-form
017.01.04-add-avatar-upload
```

- Prefixes come right after the ID, priority first, then `bug-`. No priority prefix means no priority.
- The ID stays at the start of the name, so `017-*` style searches keep working.
- Front matter is the source of truth. `validate` reports a prefix that doesn't match `priority:` or `kind:`.
- Slugs can't start with a reserved prefix. `bug-` is the one exception to verb first: after it, name the symptom (`login-redirect-loop`), not the fix. `fix-` is not reserved and is fine for cleanups.
- Changing priority or kind renames the folder. The ID never changes, and reference files keep working because they use relative paths.
- Keep the name after the ID to 40 characters or less so sidebars don't cut it off. `validate` warns above that.

## ISSUE.md

```
---
id: 017.01.01
kind: task
parent: 017.01
status: backlog
priority:
depends-on:
related:
assignee:
released-in:
---

## Description

## Acceptance criteria
```

`id` matches the folder name. `kind` is `task` or `bug` (`bug` goes with the `bug-` folder prefix). `parent` is the ID one level up (omit it for level 1) and is the source of truth for rollup, so moving work to a new parent means changing `parent:`, not the folder or ID. `status` matches the folder (`move` keeps them in sync). The rest are optional:

- `priority`: `1`, `2` or `3`, where 1 is the highest. Blank means none. Goes with the `p1-`, `p2-` or `p3-` folder prefix.
- `depends-on`: IDs that must be finished first, like `017.02, 017.03`. Stored on the dependent issue only. `validate` rejects loops.
- `related`: IDs that are linked but don't block this issue.
- `assignee`: which model or person owns it.
- `released-in`: a version like `1.4.0`.

## Rules

[SPEC.md](SPEC.md) is the source of truth for the layout, IDs, `ISSUE.md` format, and commands.

## Develop

```sh
npm install
npm run check   # typecheck, build, tests
```

Node 20+. Zero runtime dependencies: `@clack/prompts` is bundled at build time.
