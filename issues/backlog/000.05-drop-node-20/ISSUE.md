---
# Required
id: 000.05
kind: task          # feature | task | bug
parent: 000         # omit for level 1 only
status: backlog     # must match the folder

# Optional (blank = unset)
priority: medium    # urgent | high | medium | low
size: small         # small | medium | large
labels: [ci]        # names from issues/yardhand.json, e.g. [backend, auth]
depends-on:         # issue IDs, e.g. [017.01.01, 017.02]
related:            # issue IDs
assignee:           # "@handle" from issues/yardhand.json, e.g. "@claude-opus"
effort:             # free text, one word, e.g. low | medium | high | xhigh
released-in:        # set by `release`
---

# Drop Node 20 support

## Description
Node 20 reached end of life in April 2026. It is also the reason Windows CI skips Node 20: Node 20 can't expand the test glob `dist-test/*.test.js` itself, and Windows' `cmd.exe` doesn't either. Node 22 expands it.

## Acceptance criteria
- [ ] `engines.node` is `>=22` in `package.json`
- [ ] The CI matrix tests Node 22 and 24, with no Windows exclusion
- [ ] The test script quotes the glob so Node expands it on every platform
- [ ] README and docs say Node 22 or newer
