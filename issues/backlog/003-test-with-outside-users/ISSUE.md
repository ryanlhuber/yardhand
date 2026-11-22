---
# Required
id: 003
kind: feature       # feature | task | bug
status: backlog     # must match the folder

# Optional (blank = unset)
priority: low       # urgent | high | medium | low
size:               # small | medium | large
labels: [docs]      # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee:           # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Test yardhand with outside users

## Description
Every review agreed yardhand is unproven with people who didn't design it. Once dogfooding has smoothed out the obvious rough edges, watch a few people adopt it without help.

## Acceptance criteria
- [ ] At least one person sets up yardhand from the README alone and finishes an issue
- [ ] Each point of confusion is filed as an issue
