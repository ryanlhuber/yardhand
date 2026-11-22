# Issues viewer

```sh
npx yardhand ui
```

With pnpm: `pnpm dlx yardhand ui`. With bun: `bunx yardhand ui`.

A local page for people who'd rather not use the terminal, or anyone who wants to see the board. It looks like an email client: issues grouped by status on the left (each status folds open and closed), the issue in the middle, and its fields on the right.

- **Move an issue:** drag it onto a status, or change the Status field.
- **Change fields:** priority, size, labels, assignee, parent, dependencies and more, with the same checks as `yardhand set`.
- **Search:** type words, or filters like `label:auth priority:high`. `017` finds 017 and everything under it. Done issues are included. Press `/` to search, `Esc` to clear.

It opens at `http://localhost:4747/issues/`. `--port`, `--base /path` and `--no-open` change the defaults.

It runs on your computer only and works offline: nothing is sent anywhere, and nothing about it ships with your project. Changes are saved to the files in your checkout. Commit them as usual. If a person or model edits an issue while you have it open, the viewer won't overwrite their change; it shows you the latest version instead. The issue text itself is read-only in the viewer; edit `ISSUE.md` for that.
