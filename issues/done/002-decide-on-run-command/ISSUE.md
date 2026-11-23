---
# Required
id: 002
kind: feature       # feature | task | bug
status: done        # must match the folder

# Optional (blank = unset)
priority: medium    # urgent | high | medium | low
size:               # small | medium | large
labels: [spec, cli] # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee: "@claude-opus" # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort: high        # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Decide whether to build `run` or drop it

## Description
SPEC.md documents a `run` property on model assignees, kept for a future `run` command that does not exist yet. A documented field that does nothing makes the docs harder to trust.

## Acceptance criteria
- [x] A decision is recorded: build `run` now, or remove it from SPEC.md until it exists
- [x] SPEC.md, docs and code agree with the decision

## Decision (2026-11-22)
Removed. `run` was never built, so keeping it in SPEC.md only documented a field that did nothing. The `yardhand-build` skill already covers picking up and building work inside an AI tool, and launching models would mean running shell commands stored in `yardhand.json`, a file people edit by hand.

- SPEC.md lists `run` under "Not planned". The full design stays in the project's `cli-run-spec.md`, so it can come back if switching between models by hand becomes a pain.
- `config.ts` still accepts a `"run"` key in older configs and keeps it on rewrite, but nothing uses it.
- `effort` stays: it tells whoever launches the model how hard it should think.
