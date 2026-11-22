# AI tools (optional)

Yardhand works the same with or without AI. `init` asks "Which AI tools will work in this repo?" and pre-checks the ones whose files it finds (`CLAUDE.md` or `.claude/`, `.codex/`, `.opencode/`). Pick none and nothing about AI is written: no rules block, no skills, and no `effort:` line in new issues. Scripts use `--agents claude-code,codex` or `--agents none`.

## What gets written

Pick one or more and `init` writes:

- A rules block in `AGENTS.md`, between `<!-- yardhand:start -->` and `<!-- yardhand:end -->`. Nothing outside the markers changes.
- Four skills: `yardhand-plan` (turn a goal into issues), `yardhand-refine` (get an issue to `ready`), `yardhand-build` (pick up and build an issue), and `yardhand-review` (check the work against the acceptance criteria; never reviews its own work). They go in `.agents/skills/`, which most AI tools read. Claude Code only reads `.claude/skills/`, so it gets an identical copy there.
- For Claude Code, the block in `CLAUDE.md`. If your `CLAUDE.md` already has an `@AGENTS.md` line, it is left alone; if there is no `CLAUDE.md`, one is created with just that line.

## Changing your choice

The choice is saved as `agents` in `issues/yardhand.json` (`[]` means AI is off). To change it, edit the list and run `yardhand init --force`. Skills for a tool you dropped are removed; only files yardhand generated are ever replaced or removed.

## If you already have an AGENTS.md

The yardhand block only covers issue tracking, and says the rest of your file wins for anything else. Your branch naming rule wins over yardhand's (keep the issue ID in the branch name). `init` prints a warning for any line that mentions another tracker (Linear, Jira, GitHub Issues) or a branch naming rule, and leaves those lines for you to decide.
