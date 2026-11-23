# yardhand

File-based issue tracking that lives in your repo. An issue is a folder, its status is the folder it sits in, and every rule is simple enough for a person, a script or an AI model to follow.

- **Files are the source of truth.** The CLI is the fast, checked way to change them, but you can do everything by hand in a text editor or GitHub's web editor.
- **AI is optional.** Yardhand works the same with or without it.
- **Mistakes get caught.** `yardhand validate` runs in CI on every push, however a change was made.

📖 **[Full docs](https://github.com/ryanlhuber/yardhand/tree/main/docs)**

## Quickstart

Node 20 or newer. Nothing is installed into your project; yardhand writes plain files only.

```sh
npx yardhand@latest init              # set up issues/ (asks a few questions)
npx yardhand new add-auth             # create issue 001
npx yardhand new add-login --parent 001   # create 001.01 under it
npx yardhand move 001.01 in-progress  # change its status
npx yardhand list                     # see everything
npx yardhand ui                       # or browse it in your browser
```

Using pnpm or bun? Swap `npx` for `pnpm dlx` or `bunx`. [Setup details →](https://github.com/ryanlhuber/yardhand/blob/main/docs/setup.md)

## How it's laid out

```
issues/
  yardhand.json          # your statuses, labels and assignees
  backlog/
    001-add-auth/
      ISSUE.md
    001.01-add-login/
      ISSUE.md
  ready/
  in-progress/
  done/
```

`backlog` is unrefined, `ready` is safe to build, `in-progress` is claimed. You pick your own statuses at `init`. [Layout and yardhand.json →](https://github.com/ryanlhuber/yardhand/blob/main/docs/issues.md#layout)

## IDs

| ID | Means |
|---|---|
| `017` | A feature or goal |
| `017.01` | A piece of it |
| `017.01.01` | A buildable unit: one model session |

IDs are permanent and never reused. `yardhand new` picks the next one for you. [Numbering rules →](https://github.com/ryanlhuber/yardhand/blob/main/docs/issues.md#numbering)

## An issue

```
---
id: 017.01.01
kind: task          # feature | task | bug
parent: 017.01
status: backlog     # must match the folder
priority: high
assignee: "@claude-opus"
---

# Build login form

## Description
What and why.

## Acceptance criteria
- [ ] Login form submits and shows errors
```

Only `id`, `kind`, `parent` and `status` are required. [All fields →](https://github.com/ryanlhuber/yardhand/blob/main/docs/issues.md#issuemd)

## Commands

| Command | Does |
|---|---|
| `init` | Set up `issues/` in this repo |
| `new <slug>` | Create an issue with the next free ID |
| `move <id> <status>` | Change an issue's status |
| `set <id> --priority high` | Change an issue's fields |
| `list` | Show issues, with filters |
| `roadmap` | Write `issues/ROADMAP.md` |
| `release <version>` | Mark done issues as shipped in a release |
| `validate` | Check everything; exits `1` on problems |
| `ui` | Open the issues viewer in your browser |

Every command takes `--help`. [All commands and flags →](https://github.com/ryanlhuber/yardhand/blob/main/docs/commands.md)

## Picking up work

1. Take the highest-priority issue from `ready` whose dependencies are `done`.
2. Move it to `in-progress` and assign it to yourself.
3. Build it on a branch named `<id>-<slug>`.
4. Tick its acceptance criteria and move it to `done` (or `review`).

[More →](https://github.com/ryanlhuber/yardhand/blob/main/docs/workflow.md)

## More

- [Issues viewer](https://github.com/ryanlhuber/yardhand/blob/main/docs/viewer.md): a local board for people who'd rather not use the terminal
- [AI tools](https://github.com/ryanlhuber/yardhand/blob/main/docs/ai-tools.md): optional `AGENTS.md` rules and skills for Claude Code, Codex and others
- [Upgrading](https://github.com/ryanlhuber/yardhand/blob/main/docs/upgrading.md) from older versions, and the [changelog](https://github.com/ryanlhuber/yardhand/blob/main/CHANGELOG.md)
- [Develop](https://github.com/ryanlhuber/yardhand/blob/main/docs/develop.md): working on yardhand itself
- [SPEC.md](https://github.com/ryanlhuber/yardhand/blob/main/SPEC.md): the source of truth for every rule
