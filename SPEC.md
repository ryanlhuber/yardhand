# Lolo spec (v1)

Lolo is a file-based issue tracker that lives in a repo. Status is a folder, an issue is a folder, and the rules are mechanical so a script or a model can follow them. This file is the source of truth. Code and tests follow it.

## Layout

```
issues/
  lolo.json
  backlog/
    017-add-auth/
      ISSUE.md
      notes.md
  in-progress/
  done/
```

- `issues/` is at the repo root. `lolo.json` lives inside it.
- Each status in `lolo.json` has a folder of the same name.
- Each issue is a folder named `<id>-<slug>/` that contains `ISSUE.md` and any reference files.
- Reference files inside an issue use relative paths or the issue ID. Never hardcode `issues/<status>/...`.

## lolo.json

```json
{ "statuses": ["backlog", "in-progress", "done"] }
```

- `statuses` is an ordered list. It is the only source of truth for which statuses exist.
- The first status is where new issues start. The last status is the final one.
- `backlog` and `done` are required, the first and last entries respectively.
- Status names are lowercase kebab-case: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`.
- Names are unique.

## IDs

- Three levels at most: `017`, `017.01`, `017.01.01`.
- Level 1 is three digits. Levels 2 and 3 are two digits and start at `01`. Regex: `^\d{3}(\.(0[1-9]|[1-9]\d)){0,2}$`.
- No zero segments below level 1. `017` is valid, `017.00` and `017.00.00` are not.
- `000` is the catch-all for maintenance and bugs with no clear home. It is a normal level-1 ID.
- IDs are permanent and never reused, including after an issue is done.
- Allocation: scan every status folder. The next level-1 ID is the highest existing level-1 number plus one. The next child of a parent is the highest existing child number of that parent plus one. Level-1 numbers go up to 999, children up to 99. Allocation fails when full.
- The scan matches on separators: folder name must start with the ID followed by `-` (`017-`). Never match by prefix alone, so `017` never matches `0170`.
- Models never invent IDs. They call `lolo new`.

## Slugs

- Lowercase kebab-case, verb first, for example `add-auth`.
- Regex: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`.
- Slugs may change. The ID is the key. A rename changes the folder name only.

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

- `id`: required. Must equal the ID in the folder name.
- `kind`: required, `task` or `bug`.
- `parent`: required for levels 2 and 3 and must be the ID with its last segment removed. Omitted for level 1. See "Moving work to a different parent" for the one exception.
- `status`: required. Must equal the name of the status folder the issue is in.
- `assignee`: optional free text.
- `released-in`: optional semver, set when shipped.
- Front matter is a simple `key: value` block between `---` lines. Comments after `#` are allowed. No nesting.

### Moving work to a different parent

The folder name and ID never change. Update `parent:` to the new parent. `parent:` is the source of truth for rollup, so after such a move it may differ from the ID prefix. `validate` accepts a different `parent` only if that parent exists.

## Commands

All commands run from the repo root or any folder below it. Lolo finds `issues/lolo.json` by walking upward.

### `lolo init`

Interactive by default. Asks which statuses to use, with `backlog`, `in-progress`, `done` pre-checked and `review`, `merge-ready`, `blocked` offered, then custom names, then the order.

Non-interactive: `lolo init --yes [--statuses a,b,c]`. Defaults to `backlog,in-progress,done`.

Creates `issues/`, `issues/lolo.json`, and one folder per status (with a `.gitkeep` in each empty one). Creates the catch-all `000-maintain-repo` issue in the first status, so `000.NN` children (maintenance, bugs with no clear home) have a parent. Adds or updates the Lolo block in `AGENTS.md`, and in `CLAUDE.md` if that file exists. Prints the Depot install command as a suggestion. Never runs it. Refuses to overwrite an existing `lolo.json` unless `--force`.

### `lolo new <slug> [--parent <id>] [--kind task|bug] [--assignee <name>]`

Allocates the next ID, creates `issues/<first-status>/<id>-<slug>/ISSUE.md` from the template, and prints the ID and the path. With no `--parent` it creates a level-1 issue. Fails if the parent does not exist or the parent is already level 3.

### `lolo move <id> <status>`

Moves the issue folder to the status folder and rewrites `status:` in `ISSUE.md`. Fails if the status is not in `lolo.json`, the ID is not found, or the destination already holds a folder with that name.

### `lolo validate`

Checks and reports every problem with its path. Exit code 1 if there is any error, 0 otherwise.

1. `lolo.json` is valid (rules above).
2. Every status has a folder. Every folder under `issues/` is a status or reported as unknown.
3. Every issue folder matches `<id>-<slug>`, with a valid ID and slug.
4. Every issue folder contains `ISSUE.md` with valid front matter.
5. `id` equals the ID in the folder name.
6. `status` equals the folder's status.
7. `kind` is `task` or `bug`.
8. IDs are unique across all statuses.
9. `parent` exists. A level 1 issue has no parent. For levels 2 and 3, `parent` exists and has a shallower depth.
10. `released-in`, if set, is valid semver.

### Exit codes

0 success, 1 validation or usage error.

## Generated block in AGENTS.md

Written between markers so `init` can update it:

```
<!-- lolo:start -->
## Work items (Lolo)
...
<!-- lolo:end -->
```

The block is generated from `lolo.json` and the CLI version. It states: where issues live; the status words in order; the ID rules; never invent IDs; use `lolo new` and `lolo move`; run `lolo validate` before finishing; and the vocabulary mapping for Depot (level 1 is what Depot's skills call an epic, level 3 is a work item). Content outside the markers is never touched.

## Name constants

The tool name, config filename, folder name, and block markers are defined in one file (`src/names.ts`) so a rename is a one-place change.

## Out of v1

`roadmap`, `status add|rename|remove`, the frontend, a dev-dependency prompt, a harness picker, `releases/<version>.md` generation.
