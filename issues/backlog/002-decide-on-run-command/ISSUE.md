---
# Required
id: 002
kind: feature       # feature | task | bug
status: backlog     # must match the folder

# Optional (blank = unset)
priority: medium    # urgent | high | medium | low
size:               # small | medium | large
labels: [spec, cli] # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee:           # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Decide whether to build `run` or drop it

## Description
SPEC.md documents a `run` property on model assignees, kept for a future `run` command that does not exist yet. A documented field that does nothing makes the docs harder to trust.

## Acceptance criteria
- [ ] A decision is recorded: build `run` now, or remove it from SPEC.md until it exists
- [ ] SPEC.md, docs and code agree with the decision
