---
# Required
id: 000
kind: feature       # feature | task | bug
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

# Maintain repo

## Description
Home for maintenance work and bugs that don't belong to a feature: dependency updates, tooling, docs fixes, cleanup.

- Add work as children: `yardhand new <slug> --parent 000`, or by hand following the conventions.
- Group related maintenance under a level-2 issue when it grows, e.g. `000.01-update-dependencies`.
- If a bug turns out to belong to a feature, change its `parent` to that feature. Its ID stays the same.
- This issue stays open. Never move it to `done`.

## Acceptance criteria
<!-- None. This issue is a permanent container and is never finished. -->
