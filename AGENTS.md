<!-- yardhand:start -->
## Work items (yardhand v0.5.0)

This section covers issue tracking in `issues/`. For anything else, the rest of this file wins.

Issues are files in this repo. `yardhand` manages them. Do not edit this block by hand; `yardhand init` regenerates it.

- **Where:** `issues/<status>/<id>-<slug>/ISSUE.md`. An issue's status is the folder it is in.
- **Statuses, in order:** backlog → ready → in-progress → done (defined in `issues/yardhand.json`, with the allowed `labels` and `assignees`, and status descriptions under `about`). What each one means:
  - `backlog`: Not refined yet.
  - `ready`: Refined, sized, validated and safe to build.
  - `in-progress`: Claimed and being worked on.
  - `done`: Finished.
- **IDs:** `017` (a feature or goal), `017.01` (a piece of it), `017.01.01` (a buildable unit, one model session). Three levels at most. `000` is the catch-all for maintenance and bugs with no clear home. Bugs are issues with `kind: bug`. New issues start in the first status.
- **Use the commands** for new IDs, status changes and front matter. Without them, follow these rules exactly: the next ID is the highest existing one plus one (check every status folder, including done), IDs are never reused, `status:` matches the folder, and the front matter comments stay. The H1 title and the body are fine to edit by hand.
  - Create: `npx yardhand new <slug> [--parent <id>] [--kind feature|task|bug] [--priority urgent|high|medium|low] [--size small|medium|large] [--labels <names>] [--depends-on <ids>] [--related <ids>] [--assignee @handle] [--effort <word>]`
  - Change status: `npx yardhand move <id> <status>`
  - Change anything else: `npx yardhand set <id> [--priority ...|none] [--size ...|none] [--labels ...|none] [--assignee @handle|none] [--effort <word>|none] ...`
  - See issues: `npx yardhand list [--status <name>] [--parent <id>] [--kind <kind>] [--priority <level>] [--size <size>] [--label <name>] [--assignee @handle] [--json]`
  - Roadmap and releases: `npx yardhand roadmap`, `npx yardhand release <semver>`
  - Before finishing any work that touches issues: `npx yardhand validate`
- **Folder names:** `<id>-<slug>`, or `<id>-bug-<slug>` for bugs. The `bug-` prefix is added for you; priority, size, labels, assignee and effort are only in front matter.
- **Fields:** `priority:` urgent, high, medium, low. `size:` small, medium, large (only on issues with no children). `labels:`, `depends-on:` and `related:` are lists, written `[a, b]`. `assignee:` is a quoted handle like `"@claude-opus"`. `effort:` is one word in the assigned model's own terms. Blank means unset.
- **Picking up work:** take an issue from `ready` whose `depends-on` issues are all `done`, highest priority first, then lowest ID. Claim it by moving it to `in-progress` and setting `assignee` to yourself. Build it on a branch named `<id>-<slug>` (if this repo has its own branch naming rule, follow it and put the issue ID in the branch name). Tick its acceptance criteria, then move it to `review` if that status exists, else `done`.
- **Rollup:** the `parent:` field in ISSUE.md decides what rolls up to what, not the folder name.
- **Reference files** inside an issue folder use relative paths, never `issues/<status>/...` paths.
- **Skills:** `yardhand-plan`, `yardhand-refine`, `yardhand-build`, `yardhand-review` in `.agents/skills/` and `.claude/skills/` cover planning, refining, building and reviewing issues.
- **Depot vocabulary:** level 1 is what Depot's skills call an epic; level 3 is a work item.
<!-- yardhand:end -->
