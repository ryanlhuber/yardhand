---
# Required
id: 000.03
kind: task          # feature | task | bug
parent: 000         # omit for level 1 only
status: done        # must match the folder

# Optional (blank = unset)
priority:           # urgent | high | medium | low
size: small         # small | medium | large
labels: [ci, docs]  # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee: "@ryan"   # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Track yardhand's own issues with yardhand

## Description
The repo that defines the rules should follow them, and using it daily is the cheapest way to find rough edges before outside users do.

## Acceptance criteria
- [x] `issues/` is set up with `yardhand init`, with labels and assignees filled in
- [x] AI tools are set up for Claude Code, Codex and OpenCode
- [x] The remaining review findings are filed as issues
- [x] `issues/` is not in the published npm package
- [x] `yardhand validate` passes
