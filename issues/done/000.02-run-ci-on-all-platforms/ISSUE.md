---
# Required
id: 000.02
kind: task          # feature | task | bug
parent: 000         # omit for level 1 only
status: done        # must match the folder

# Optional (blank = unset)
priority:           # urgent | high | medium | low
size: small         # small | medium | large
labels: [ci]        # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee: "@ryan"   # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Run CI on Windows and macOS

## Description
CI only ran on Ubuntu. The CLI renames folders, rejects symlinks and handles paths, which is where platforms differ, so outside users on Windows or macOS could hit bugs we never see.

## Acceptance criteria
- [x] `ci.yml` runs on ubuntu-latest, macos-latest and windows-latest, on Node 20 and 22 (Windows on Node 22 only)
- [x] The tarball smoke test runs under bash on every platform
- [x] All jobs pass (Windows skips Node 20; see 000.05)
