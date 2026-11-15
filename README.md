# yardhand

File-based issue tracking that lives in your repo. Status is a folder, an issue is a folder, and every rule is mechanical, so a script or an AI model can follow it.

The files are the source of truth. The CLI is the fast, checked way to change them, but every rule can also be followed by hand in a text editor or GitHub's web editor, and AI is optional. `init` can add a GitHub Action that runs `yardhand validate` on every push, so mistakes are caught however a change was made.

## Run it

Node 20 or newer. Use your project's package manager:

| Package manager | Prefix |
|---|---|
| npm | `npx yardhand@latest` |
| pnpm | `pnpm dlx yardhand@latest` |
| bun | `bunx yardhand@latest` |

Below, `yardhand init` means `npx yardhand init`, `pnpm dlx yardhand init`, or `bunx yardhand init`. If your `package.json` pins pnpm (`devEngines` or `packageManager`), npm fails with `EBADDEVENGINES`, so use `pnpm dlx` there.

In a terminal, in a repo that isn't set up yet, you can skip the word `init`: `npx yardhand@latest` (or `pnpm dlx yardhand@latest`, `bunx yardhand@latest`) walks you through setup. In a repo that already has `issues/`, or when there is no terminal, a bare `yardhand` prints the help.

Nothing is installed into your project. `init` writes plain files only.

## Commands

| Command | What it does |
|---|---|
| `yardhand init` | Sets up tracking in this repo: creates `issues/`, `issues/yardhand.json`, one folder per status, and the `000-maintain-repo` issue (in `backlog`). Asks which statuses to use (`ready` and `in-progress` are pre-checked), lets you add custom ones (typed freely, normalized to `kebab-case`), then always lets you reorder them. `backlog` and `done` are always included but can sit anywhere in the order. Then asks which AI tools work in the repo (pick none to leave AI out; see [AI tools](#ai-tools-optional)). It then offers to add `issues/` to an existing `.npmignore` and `.dockerignore`, and, in a git repo, to add `.github/workflows/yardhand.yml`, a GitHub Action that runs `validate` on every push. |
| `yardhand init --yes --statuses a,b,c` | Same, without questions. `--statuses` sets your statuses in order (default `backlog,ready,in-progress,done`). The ignore entries and the GitHub Action default to yes; skip them with `--no-ignore` and `--no-ci`. Add `--force` to re-run in a repo that is already set up (labels and assignees are kept). |
| `yardhand new <slug>` | Creates an issue with the next free ID in the first status and prints its ID and path. The slug is normalized to lowercase kebab-case; start it with a verb, like `add-auth`. A level-1 issue is a `feature`, deeper ones are `task`. |
| `yardhand new <slug> --parent 017` | Creates a child of `017` (it gets `017.01`, or the next free number). Also accepts `--kind feature\|task\|bug`. A slug starting with `bug-` makes a bug. |
| `yardhand new <slug> --priority high --depends-on 017.02 --related 009` | Sets links when you create the issue: `--priority` is `urgent`, `high`, `medium` or `low`; `--depends-on` lists issues that must be finished first; `--related` lists linked issues that don't block. Both take comma-separated IDs that must already exist. |
| `yardhand new <slug> --size small --labels backend,auth --assignee claude-opus --effort high` | Sets the rest when you create the issue: `--size` is `small`, `medium` or `large`; `--labels` and `--assignee` must be listed in `issues/yardhand.json` (the `@` is added if you leave it off); `--effort` is one word in the assigned model's own terms. |
| `yardhand move <id> <status>` | Moves the issue folder to another status and updates `status:`. Moving to the current status does nothing. Children stay where they are; the output lists them. |
| `yardhand set <id> --priority high` | Changes fields on an existing issue: `--kind`, `--priority`, `--size`, `--labels`, `--parent`, `--depends-on`, `--related`, `--assignee`, `--effort`, `--released-in`. A value replaces the old one; `none` clears it. Changing `--kind` renames the folder (adds or removes `bug-`). Comments in the front matter are kept. |
| `yardhand list` | Shows every issue in every status, sorted by priority then ID. Filters: `--status`, `--parent`, `--kind`, `--priority`, `--size`, `--label`, `--assignee`. Add `--json` for scripts. |
| `yardhand roadmap` | Writes `issues/ROADMAP.md`, a tree of every issue built from `parent:` fields, with done counts, sizes, and how many large issues are left. `--stdout` prints it instead. |
| `yardhand release <version>` | Stamps `released-in:` on every issue in `done` that has none and writes `issues/releases/<version>.md`. `--dry-run` previews. |
| `yardhand validate` | Checks every issue and reports each problem with its path. Exits `1` if anything is wrong, so it works in CI. `--json` for scripts. Warns (without failing) about long slugs, a stale `ROADMAP.md`, `size` on a parent, open `large` issues (consider splitting), done issues with unchecked acceptance criteria, `effort` with no model assigned, `effort` or a model assignee when AI is off, and `issues/` that could be published by npm or copied into a Docker image. |
| `yardhand <command> --help`, `--version` | Prints usage for a command, or the installed version. |

## Layout

```
issues/
  yardhand.json            # statuses in order, allowed labels, assignees
  ROADMAP.md               # generated by `yardhand roadmap`
  releases/
    1.4.0.md               # generated by `yardhand release`
  backlog/
    000-maintain-repo/     # catch-all for maintenance and bugs with no clear home
      ISSUE.md
    017-add-auth/
      ISSUE.md
      notes.md             # reference files sit beside ISSUE.md
    017.01-add-login/
      ISSUE.md
    017.02-bug-login-redirect-loop/   # `bug-` marks kind: bug
      ISSUE.md
  ready/
  in-progress/
    017.01.01-build-login-form/
      ISSUE.md
  done/
```

An issue's status is the folder it is in. `backlog` means not refined yet; `ready` means refined, sized, validated and safe to build; `in-progress` means someone (a person or a model) has claimed it. Reference files inside an issue use relative paths, never `issues/<status>/...`.

### yardhand.json

```json
{
  "statuses": ["backlog", "ready", "in-progress", "done"],
  "labels": ["backend", "frontend"],
  "assignees": {
    "@ryan": "person",
    "@claude-opus": "model"
  },
  "agents": ["claude-code", "codex"]
}
```

Edit `labels`, `assignees` and `agents` by hand. Labels are lowercase kebab-case. Handles are `@` plus lowercase kebab-case, with no dots: GPT-6.1 Sol is `@gpt-6-1-sol`. Never put emails here or in an issue; repos can be public.

### Keep issues out of packages and live sites

A normal build (Vite, Next, `tsc`) only outputs its build folder, so `issues/` stays out. It can leak through `npm publish` without a `files` list, a Docker `COPY . .` without a `.dockerignore` entry, or a host that serves the repo root. `init` offers the ignore entries and `validate` warns about the first two. Deploy from your build output folder, never the repo root.

## AI tools (optional)

Yardhand works the same with or without AI. `init` asks "Which AI tools will work in this repo?" and pre-checks the ones whose files it finds (`CLAUDE.md` or `.claude/`, `.codex/`, `.opencode/`). Pick none and nothing about AI is written: no rules block, no skills, and no `effort:` line in new issues. Scripts use `--agents claude-code,codex` or `--agents none`.

Pick one or more and `init` writes:

- A rules block in `AGENTS.md`, between `<!-- yardhand:start -->` and `<!-- yardhand:end -->`. Nothing outside the markers changes.
- Four skills: `yardhand-plan` (turn a goal into issues), `yardhand-refine` (get an issue to `ready`), `yardhand-build` (pick up and build an issue), and `yardhand-review` (check the work against the acceptance criteria; never reviews its own work). They go in `.agents/skills/` for Codex, OpenCode and other tools, and in `.claude/skills/` for Claude Code.
- For Claude Code, the block in `CLAUDE.md`. If your `CLAUDE.md` already has an `@AGENTS.md` line, it is left alone; if there is no `CLAUDE.md`, one is created with just that line.

The choice is saved as `agents` in `issues/yardhand.json` (`[]` means AI is off). To change it, edit the list and run `yardhand init --force`. Skills for a tool you dropped are removed; only files yardhand generated are ever replaced or removed.

Already have an `AGENTS.md`? The yardhand block only covers issue tracking, and says the rest of your file wins for anything else. Your branch naming rule wins over yardhand's (keep the issue ID in the branch name). `init` prints a warning for any line that mentions another tracker (Linear, Jira, GitHub Issues) or a branch naming rule, and leaves those lines for you to decide.

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
- Nobody invents IDs. `yardhand new` picks the next free one. Without the CLI, use the same rule: the highest existing ID plus one, across every status folder including `done`.
- The folder is `<id>-<slug>`. Slugs can change; the ID is the key.
- A bug is a normal issue with `kind: bug`. Its folder is `<id>-bug-<slug>` (`bug-` is the only reserved prefix, and the tool adds it). Priority, size, labels, assignee and effort are never part of the folder name.

## ISSUE.md

```
---
# Required
id: 017.01.01
kind: task          # feature | task | bug
parent: 017.01      # omit for level 1 only
status: backlog     # must match the folder

# Optional (blank = unset)
priority:           # urgent | high | medium | low
size:               # small | medium | large
labels:             # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee:           # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Build login form

## Description
<!-- What and why. A buildable unit should fit one model session. -->

## Acceptance criteria
<!-- Checkable outcomes, one per line, as checkboxes: - [ ] ... -->
- [ ]
```

`id` matches the folder name. `kind` is `feature`, `task` or `bug`. `parent` is the ID one level up (omit it for level 1) and is the source of truth for rollup, so moving work to a new parent means changing `parent:`, not the folder or ID. `status` matches the folder (`move` keeps them in sync). The rest are optional (blank means unset):

- `priority`: `urgent`, `high`, `medium` or `low`.
- `size`: how much of one model session a buildable unit takes. `small` (a few files, under half a session), `medium` (a normal session), `large` (barely fits; consider splitting). Leave it blank on issues with children.
- `labels`: which part of the codebase it touches, like `[backend, auth]`. Each must be listed in `issues/yardhand.json`.
- `depends-on`: IDs that must be finished first, like `[017.02, 017.03]`. Stored on the dependent issue only. `validate` rejects loops.
- `related`: IDs that are linked but don't block this issue.
- `assignee`: who builds it, a person or a model, as a quoted handle like `"@claude-opus"`. Quotes are needed because YAML cannot start a value with `@`.
- `effort`: how hard the assigned model should think, in that model's own words (`high`, `xhigh`). One word only.
- `released-in`: a version like `1.4.0`, set by `yardhand release`.

The `# Required` and `# Optional` lines and the comments after each field are for people editing by hand; every command keeps them. Lists are written `[a, b]`; the 0.2 form (`a, b`) still reads. The H1 title starts as the slug in sentence case and can be edited freely; it is never checked against the folder name.

## Picking up work

The same steps for a person, a model, or a script:

1. Take an issue from `ready` whose `depends-on` issues are all `done`. Highest priority first, then lowest ID (`yardhand list --status ready`).
2. Claim it: move it to `in-progress` and set `assignee` to yourself.
3. Build it on a branch named `<id>-<slug>` (or your repo's own branch rule, with the issue ID in the name).
4. Tick the acceptance criteria, then move it to `review` if that status exists, else `done`.

## Upgrading from 0.3

- Nothing breaks: a `yardhand.json` without `agents` works as before (the `AGENTS.md` block only).
- To pick your AI tools and get the skills, run `yardhand init --force --statuses <your current statuses, in order> --agents claude-code,codex` (or `--agents none`). Without `--agents`, it sets up the tools it finds in the repo. It keeps your labels and assignees.

## Upgrading from 0.2

- `init` offers `ready` instead of `todo`. Existing repos keep their statuses; statuses are just names.
- `assignee` must now be a quoted `@handle` listed under `assignees` in `issues/yardhand.json`. Add your people and models there, then fix each issue with `yardhand set <id> --assignee <handle>`. `validate` lists every issue that needs it.
- New issues use the grouped template with an H1 title. Existing issues stay valid; `set` adds `size`, `labels` and `effort` lines to them when you first use those flags.
- Re-run `yardhand init --force --statuses <your current statuses, in order>` to refresh the rules block in `AGENTS.md`. It keeps your labels and assignees.

## Rules

[SPEC.md](SPEC.md) is the source of truth for the layout, IDs, `ISSUE.md` format, and commands.

## Develop

```sh
npm install
npm run check   # typecheck, build, tests
```

Node 20+. Zero runtime dependencies: `@clack/prompts` is bundled at build time.
