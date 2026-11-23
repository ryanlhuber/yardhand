---
# Required
id: 004
kind: feature       # feature | task | bug
status: backlog     # must match the folder

# Optional (blank = unset)
priority: low       # urgent | high | medium | low
size:               # small | medium | large
labels: [spec]      # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related: [001]      # issue IDs
assignee:           # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Review which optional fields actually get used

## Description
After a month or two of tracking yardhand's own work in yardhand (from 2026-11-22), check which optional fields were filled in. A field that stayed blank is a candidate to cut, following the bar for extras in SPEC.md ("Core and extras").

## Acceptance criteria
- [ ] Each optional field is listed with how many issues use it
- [ ] Each unused field is either cut or kept with a written reason
