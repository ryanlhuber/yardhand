# Commands

Every command takes `--help`. `yardhand --version` prints the installed version. The prefix (`npx`, `pnpm dlx`, `bunx`) is left off below; see [Setup](setup.md).

## `yardhand init`

Sets up tracking in this repo: creates `issues/`, `issues/yardhand.json`, one folder per status, and the `000-maintain-repo` issue (in `backlog`). Asks which statuses to use (`ready` and `in-progress` are pre-checked), lets you add custom ones (typed freely, normalized to `kebab-case`), then always lets you reorder them. `backlog` and `done` are always included but can sit anywhere in the order. Then asks which AI tools work in the repo (pick none to leave AI out; see [AI tools](ai-tools.md)). It then offers to add `issues/` to an existing `.npmignore` and `.dockerignore`, and, in a git repo, to add `.github/workflows/yardhand.yml`, a GitHub Action that runs `validate` on every push.

`yardhand init --yes --statuses a,b,c` does the same without questions. `--statuses` sets your statuses in order (default `backlog,ready,in-progress,done`). The ignore entries and the GitHub Action default to yes; skip them with `--no-ignore` and `--no-ci`. Add `--force` to re-run in a repo that is already set up (labels and assignees are kept). `--agents claude-code,codex` or `--agents none` picks AI tools without asking.

## `yardhand new <slug>`

Creates an issue with the next free ID in the first status and prints its ID and path. The slug is normalized to lowercase kebab-case; start it with a verb, like `add-auth`. A level-1 issue is a `feature`, deeper ones are `task`.

| Flag | Does |
|---|---|
| `--parent 017` | Creates a child of `017` (it gets `017.01`, or the next free number) |
| `--kind feature\|task\|bug` | Sets the kind. A slug starting with `bug-` makes a bug |
| `--priority` | `urgent`, `high`, `medium` or `low` |
| `--depends-on 017.02` | Issues that must be finished first. Comma-separated IDs that must already exist |
| `--related 009` | Linked issues that don't block. Comma-separated IDs that must already exist |
| `--size` | `small`, `medium` or `large` |
| `--labels backend,auth` | Must be listed in `issues/yardhand.json` |
| `--assignee claude-opus` | Must be listed in `issues/yardhand.json` (the `@` is added if you leave it off) |
| `--effort high` | One word in the assigned model's own terms |

## `yardhand move <id> <status>`

Moves the issue folder to another status and updates `status:`. Moving to the current status does nothing. Children stay where they are; the output lists them.

## `yardhand set <id>`

Changes fields on an existing issue: `--kind`, `--priority`, `--size`, `--labels`, `--parent`, `--depends-on`, `--related`, `--assignee`, `--effort`, `--released-in`. A value replaces the old one; `none` clears it. Changing `--kind` renames the folder (adds or removes `bug-`). Comments in the front matter are kept.

```sh
yardhand set 017.01 --priority high
```

## `yardhand list`

Shows every issue in every status, sorted by priority then ID. Filters: `--status`, `--parent`, `--kind`, `--priority`, `--size`, `--label`, `--assignee`. Add `--json` for scripts.

## `yardhand roadmap`

Writes `issues/ROADMAP.md`, a tree of every issue built from `parent:` fields, with done counts, sizes, and how many large issues are left. `--stdout` prints it instead.

## `yardhand release <version>`

Stamps `released-in:` on every issue in `done` that has none and writes `issues/releases/<version>.md`. `--dry-run` previews.

## `yardhand validate`

Checks every issue and reports each problem with its path. Exits `1` if anything is wrong, so it works in CI. `--json` for scripts.

It also warns, without failing, about:

- long slugs
- a stale `ROADMAP.md`
- `size` on a parent
- open `large` issues (consider splitting)
- done issues with unchecked acceptance criteria
- `effort` with no model assigned
- `effort` or a model assignee when AI is off
- `issues/` that could be published by npm or copied into a Docker image

## `yardhand ui`

Opens the issues viewer in your browser at `http://localhost:4747/issues/`. `--port`, `--base /path` and `--no-open` change the defaults. See [Issues viewer](viewer.md).
