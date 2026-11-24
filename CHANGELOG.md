# Changelog

What changed in each release. From 0.5.1 on, the issues behind each version are listed in `issues/releases/<version>.md`, written by `yardhand release`.

## Unreleased

Nothing yet.

## 0.5.1 (2026-11-23)

Issues: [issues/releases/0.5.1.md](issues/releases/0.5.1.md). No changes to how the CLI behaves.

- **Docs:** the README is now a short overview, and the full guide lives in `docs/`.
- **CI:** tests now run on Windows and macOS as well as Ubuntu.
- **Repo:** yardhand now tracks its own issues in `issues/`.
- **Spec:** SPEC.md now draws a line between the core (status folders, IDs, required fields, `init`, `new`, `move`, `validate`) and optional extras, lists non-goals, and sets a bar for adding anything new. The docs teach the core first.
- **Spec:** the planned `run` command is dropped. A `"run"` key in older configs is still accepted and ignored.

## 0.5.0 (2026-11-19)

- **New: `yardhand ui`**, a local issues viewer at `http://localhost:4747/issues/`. Issues are grouped by status, you drag an issue onto a status to move it, and fields are editable with the same checks as `set`. Search works as you type, with the same filters as `list`. It runs offline on your computer only, and never overwrites a change someone else made while the page was open.

## 0.4.0 (2026-11-15)

- **New: optional AI setup in `init`.** It asks which AI tools work in the repo (Claude Code, Codex, OpenCode, other), or none to leave AI out. Scripts use `--agents a,b` or `--agents none`.
- With AI on, `init` writes four skills (`yardhand-plan`, `-refine`, `-build`, `-review`) to `.agents/skills/`, plus a copy in `.claude/skills/` for Claude Code.
- The choice is saved as `agents` in `issues/yardhand.json`. `[]` means AI is off.
- The `AGENTS.md` block says it covers issue tracking only, and that the repo's own branch naming rule wins. `init` warns about lines that name another tracker.
- `init` asks what happens in each custom status, and shows each built-in status's meaning as a hint.

## 0.3.0 (2026-11-14)

- **New fields:** `size`, `labels` (defined in `issues/yardhand.json`) and `effort`.
- **Assignees** are now quoted `@handles` listed in `issues/yardhand.json` as a person or a model.
- **New ISSUE.md template**, with Required and Optional groups, a comment after every field, an H1 title and an acceptance-criteria checkbox.
- **`init`:** `ready` replaces `todo`, and you can always reorder statuses. It offers to add `issues/` to `.npmignore` and `.dockerignore`, and to add a GitHub Action that runs `validate` on every push.
- **`list`** gains `--size`, `--label` and `--assignee` filters.
- **`validate`** checks the new fields, and warns about `size` on a parent, open `large` issues, unchecked criteria on done issues, and `issues/` that could ship in an npm package or Docker image.
- Lists are written `[a, b]`. The 0.2 form (`a, b`) still reads.
- See [Upgrading from 0.2](docs/upgrading.md#from-02).

## 0.2.2 (2026-11-12)

- A bare `yardhand` in a repo that isn't set up yet starts `init`.

## 0.2.1 (2026-11-12)

- `set --kind` repairs a folder whose `bug-` prefix disagrees with `kind`.
- `validate` reports stray files in `issues/` and checks assignee values.
- `release` rebuilds a missing release file from issues already stamped with that version.
- `new` builds the issue folder in a staging folder, then moves it into place.

## 0.2.0 (2026-11-12)

- **New commands:** `set`, `list`, `roadmap` and `release`.
- `kind` is `feature`, `task` or `bug`. The `bug-` folder prefix is managed by the tool.
- `backlog` and `done` are required but can sit anywhere in the order.
- Interactive `init`, with a checklist, custom statuses and reordering.
- `validate` gains `--json` and warnings.
