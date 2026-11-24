---
# Required
id: 000.04
kind: task          # feature | task | bug
parent: 000         # omit for level 1 only
status: done        # must match the folder

# Optional (blank = unset)
priority:           # urgent | high | medium | low
size: small         # small | medium | large
labels: [docs]      # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee: "@ryan"   # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in: 0.5.1  # set by `release`
---

# Add a CHANGELOG

## Description
There was no record of what changed in each release. Add `CHANGELOG.md` covering past versions, and use `yardhand release` for future release notes.

## Acceptance criteria
- [x] `CHANGELOG.md` covers every tagged version from 0.2.0 to 0.5.0, plus Unreleased
- [x] `docs/develop.md` explains how to cut a release with `yardhand release`
