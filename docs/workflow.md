# Picking up work

The same steps for a person, a model, or a script:

1. Take an issue from `ready` whose `depends-on` issues are all `done`. Highest priority first, then lowest ID (`yardhand list --status ready`).
2. Claim it: move it to `in-progress` and set `assignee` to yourself.
3. Build it on a branch named `<id>-<slug>` (or your repo's own branch rule, with the issue ID in the name).
4. Tick the acceptance criteria, then move it to `review` if that status exists, else `done`.

With the CLI, steps 2 and 4 look like this:

```sh
yardhand move 017.01.01 in-progress
yardhand set 017.01.01 --assignee ryan
# ...build, tick the checkboxes in ISSUE.md...
yardhand move 017.01.01 done
```

The handle (`@ryan` here) must be listed under `assignees` in `issues/yardhand.json`. See [Issues](issues.md#yardhandjson).

Without the CLI, move the issue folder into the status folder and change `status:` in `ISSUE.md` to match. `yardhand validate` (or CI) catches any mismatch.
