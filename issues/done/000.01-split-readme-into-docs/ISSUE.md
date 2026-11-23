---
# Required
id: 000.01
kind: task          # feature | task | bug
parent: 000         # omit for level 1 only
status: done        # must match the folder

# Optional (blank = unset)
priority:           # urgent | high | medium | low
size: medium        # small | medium | large
labels: [docs]      # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee: "@ryan"   # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Split README into a short overview and docs/

## Description
The README was too dense to follow. Make it a short tour of yardhand and move the full detail into `docs/`.

## Acceptance criteria
- [x] README covers what it is, quickstart, layout, IDs, a sample issue, commands and picking up work
- [x] Each README section links to its full page in `docs/`
- [x] README links are full GitHub URLs so they work on npmjs.com
- [x] The quickstart runs as written in a fresh repo
