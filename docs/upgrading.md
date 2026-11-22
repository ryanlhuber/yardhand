# Upgrading

## From 0.3

- Nothing breaks: a `yardhand.json` without `agents` works as before (the `AGENTS.md` block only).
- To pick your AI tools and get the skills, run `yardhand init --force --statuses <your current statuses, in order> --agents claude-code,codex` (or `--agents none`). Without `--agents`, it sets up the tools it finds in the repo. It keeps your labels and assignees.

## From 0.2

- `init` offers `ready` instead of `todo`. Existing repos keep their statuses; statuses are just names.
- `assignee` must now be a quoted `@handle` listed under `assignees` in `issues/yardhand.json`. Add your people and models there, then fix each issue with `yardhand set <id> --assignee <handle>`. `validate` lists every issue that needs it.
- New issues use the grouped template with an H1 title. Existing issues stay valid; `set` adds `size`, `labels` and `effort` lines to them when you first use those flags.
- Re-run `yardhand init --force --statuses <your current statuses, in order>` to refresh the rules block in `AGENTS.md`. It keeps your labels and assignees.
