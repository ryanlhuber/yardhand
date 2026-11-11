# Yardhand spec (v1)

Yardhand is a file-based issue tracker that lives in a repo. Status is a folder, an issue is a folder, and the rules are mechanical so a script or a model can follow them. This file is the source of truth. Code and tests follow it.

## Layout

```
issues/
  yardhand.json
  backlog/
    017-add-auth/
      ISSUE.md
      notes.md
  in-progress/
  done/
```

- `issues/` is at the repo root. `yardhand.json` lives inside it.
- Each status in `yardhand.json` has a folder of the same name.
- Each issue is a folder named `<id>-<slug>/` that contains `ISSUE.md` and any reference files.
- Reference files inside an issue use relative paths or the issue ID. Never hardcode `issues/<status>/...`.

## yardhand.json

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
- Models never invent IDs. They call `yardhand new`.

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
priority:
depends-on:
related:
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
- `priority`: optional. One of `urgent`, `high`, `medium`, `low`. Empty means no priority.
- `depends-on`: optional. A comma-separated list of issue IDs that must be finished first, for example `017.02, 017.03`. The link is stored on the dependent issue only; there is no reverse field. A `depends-on` loop (A needs B and B needs A) is an error.
- `related`: optional. A comma-separated list of issue IDs that are linked but do not block this issue. Related links may point both ways.
- `assignee`: optional single-line text. `yardhand new` rejects an assignee that contains a control character (C0, DEL, or C1, a newline or tab included), a Unicode line or paragraph separator (U+2028, U+2029), or `#`. The check is on the value as given, before any trimming; surrounding spaces are then trimmed.
- `released-in`: optional semver (the grammar at semver.org: no leading zeros, no empty identifiers), set when shipped.
- Front matter is a simple `key: value` block between `---` lines. A comment starts with `#` at the start of a value or after whitespace; a `#` inside a word is part of the value. No nesting. A key may appear only once. Both LF and CRLF line endings are accepted.

### Moving work to a different parent

The folder name and ID never change. Update `parent:` to the new parent. `parent:` is the source of truth for rollup, so after such a move it may differ from the ID prefix. `validate` accepts a different `parent` only if that parent exists.

## Commands

All commands, `init` included, run from the repo root or any folder below it. Yardhand finds `issues/yardhand.json` by walking upward. `init` in an already-initialized repo fails (even from a subfolder), and with `--force` it works on the existing root.

`new` and `move` take an exclusive lock (`issues/.yardhand-lock`, a folder created atomically that holds the owner's process ID and a random token), so concurrent runs cannot allocate the same ID. A lock is abandoned only when the process that took it is no longer running, or, if it never wrote an owner, after 2 seconds. A slow but live holder is never evicted, however long it holds. Removing an abandoned lock is serialized by a second short-lived mutex (`issues/.yardhand-lock.reclaim`). Under it, the lock is re-read and removed only if it is still the same lock (same token) and its owner is still gone; while a lock folder exists nobody else can create one, so this cannot race with a new holder. A reclaim mutex older than 5 seconds belongs to a reclaimer that died and is cleared. A lock is released only by its owner, and a failure to remove it never hides the result of the work. A command waits up to 10 seconds for the lock (override with `YARDHAND_LOCK_TIMEOUT_MS`), then fails with a message. Folders under `issues/` that start with `.` are tool internals and are ignored.

`new`, `move`, and `init` first need a complete view of every existing ID, so they refuse to run when: a status path is a file or cannot be listed; any entry cannot be inspected (permissions or I/O errors are never read as "absent"); a folder under `issues/` that is not a status holds, or may hold, issue folders; or there are symlinks. Yardhand never follows symlinks: `issues/` itself, status folders, issue folders, and `ISSUE.md` are checked. Reference files inside an issue folder are the user's and are not inspected.

`move` writes the new `status:` to a temp file in the issue folder first (a random name, `.ISSUE.md.<random>.tmp`, created exclusively, so nothing at a guessable path is ever written through), so a failed or partial write can only damage the temp file. It then renames the folder and renames the temp file over `ISSUE.md` (an atomic replace). If that last step fails, it renames the folder back, so the folder and the field never disagree. The cases it cannot repair are a failure of the move-back itself, which it reports with exactly what state the issue is in, and a crash between the two renames, which leaves a status mismatch plus a temp file. `validate` reports both, and the temp file's message says how to finish or undo the move. If the status folder is missing, `move` creates it.

### `yardhand init`

Interactive by default. Asks which statuses to use, with `backlog`, `in-progress`, `done` pre-checked and `review`, `merge-ready`, `blocked` offered, then custom names, then the order.

Non-interactive: `yardhand init --yes [--statuses a,b,c]`. Defaults to `backlog,in-progress,done`.

Creates `issues/`, `issues/yardhand.json`, and one folder per status (with a `.gitkeep` in each empty one). Creates the catch-all `000-maintain-repo` issue in the first status, so `000.NN` children (maintenance, bugs with no clear home) have a parent. Adds or updates the Yardhand block in `AGENTS.md`, and in `CLAUDE.md` if that file exists. Prints the Depot install command as a suggestion. Never runs it. Refuses to overwrite an existing `yardhand.json` unless `--force`. It takes the same lock as `new` and `move`, and runs the same completeness check, so a status list that omits a folder holding issues, or a tree it cannot fully read, is refused before anything is written. The catch-all is created with exclusive operations and is never overwritten. If `issues/` exists but cannot be read, `init` fails; it only starts fresh when nothing is set up. It validates `--statuses` even when it is empty.

### `yardhand new <slug> [--parent <id>] [--kind task|bug] [--assignee <name>] [--priority <level>] [--depends-on <ids>] [--related <ids>]`

Allocates the next ID, creates `issues/<first-status>/<id>-<slug>/ISSUE.md` from the template, and prints the ID and the path. With no `--parent` it creates a level-1 issue. Fails if the parent does not exist or the parent is already level 3. `--priority` must be one of the four levels. `--depends-on` and `--related` take comma-separated IDs, and every ID must already exist. A failed `new` creates nothing.

### `yardhand move <id> <status>`

Moves the issue folder to the status folder and rewrites `status:` in `ISSUE.md`. Fails if the status is not in `yardhand.json`, the ID is not found, or the destination already holds a folder with that name.

### `yardhand validate`

Checks and reports every problem with its path, and keeps going after a problem; filesystem surprises (a file where a folder should be, an `ISSUE.md` that is a folder) are reported as problems, never thrown. A folder with a bad slug still takes part in every check. A folder with no recognizable ID still gets every check that does not need one: front matter, duplicate keys, `kind`, `status`, `released-in`, a required valid `id`, and that its `parent` exists. Symlinks, entries that cannot be inspected, and leftover temp files are reported. Problems finding the root (for example an unreadable `issues/`) are reported as findings, not thrown. Exit code 1 if there is any error, 0 otherwise.

1. `yardhand.json` is valid (rules above). An invalid config is reported as a problem.
2. Every status has a folder. Every folder under `issues/` is a status or reported as unknown.
3. Every issue folder matches `<id>-<slug>`, with a valid ID and slug.
4. Every issue folder contains `ISSUE.md` with valid front matter.
5. `id` equals the ID in the folder name.
6. `status` equals the folder's status.
7. `kind` is `task` or `bug`.
8. IDs are unique across all statuses.
9. `parent` exists. A level 1 issue omits the field entirely (an empty `parent:` is an error). For levels 2 and 3, `parent` is non-empty, exists, and has a shallower depth.
10. `released-in`, if set, is valid semver.
11. No key appears twice in the front matter.
12. `priority`, if set, is `urgent`, `high`, `medium`, or `low`.
13. Every ID in `depends-on` and `related` is valid, exists, and is not the issue itself.
14. `depends-on` has no loops.

### Exit codes

0 success, 1 validation or usage error.

## Generated block in AGENTS.md

Written between markers so `init` can update it:

```
<!-- yardhand:start -->
## Work items (Yardhand)
...
<!-- yardhand:end -->
```

Content outside the markers is kept byte for byte, including when the block is appended and including bytes that are not valid UTF-8. Markers are found by plain text search anywhere in the file, so do not put the literal marker lines in your own text (for example in a fenced example); a pair there would be treated as the block. If the markers are damaged (one missing, reversed, or repeated), `init` fails and changes nothing, and it checks this before writing anything else. The block is generated from `yardhand.json` and the CLI version. It states: where issues live; the status words in order; the ID rules; never invent IDs; use `yardhand new` and `yardhand move`; run `yardhand validate` before finishing; and the vocabulary mapping for Depot (level 1 is what Depot's skills call an epic, level 3 is a work item). Content outside the markers is never touched.

## Name constants

The tool name, config filename, issues folder name, issue filename, and block markers are defined in one file (`src/names.ts`). Every message and the generated block use those constants, so a rename is a one-place change.

## Out of v1

`roadmap`, `status add|rename|remove`, the frontend, a dev-dependency prompt, a harness picker, `releases/<version>.md` generation.

## CLI behavior

- Unknown options and extra arguments are errors for every command, including `validate`, `--help`, and `--version`.
- Errors go to stderr, results to stdout, exit code 1 on failure. Output is written before the process ends, so a slow reader still receives every line.
- Paths in output always use forward slashes.
