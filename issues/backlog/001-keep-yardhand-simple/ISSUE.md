---
# Required
id: 001
kind: feature       # feature | task | bug
status: backlog     # must match the folder

# Optional (blank = unset)
priority: high      # urgent | high | medium | low
size:               # small | medium | large
labels: [spec, docs] # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee:           # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Keep yardhand simple as it grows

## Description
Reviews flagged that each new field and command is easy to defend on its own, but together they erode yardhand's main advantage: rules simple enough to follow by hand. Draw a line between core and extras, and set a bar for anything new.

## Acceptance criteria
- [ ] SPEC.md defines the core (status folders, IDs, required fields, acceptance criteria, `new`, `move`, `validate`) and says the core works with no extras in use
- [ ] SPEC.md has a Non-goals section and a test every new field or command must pass
- [ ] The docs teach the core first and the extras as optional
- [ ] Unused fields are reviewed after a month or two of dogfooding
