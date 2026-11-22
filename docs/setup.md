# Setup

## Run it

Node 20 or newer. Use your project's package manager:

| Package manager | Prefix |
|---|---|
| npm | `npx yardhand@latest` |
| pnpm | `pnpm dlx yardhand@latest` |
| bun | `bunx yardhand@latest` |

In these docs, `yardhand init` means `npx yardhand init`, `pnpm dlx yardhand init`, or `bunx yardhand init`. If your `package.json` pins pnpm (`devEngines` or `packageManager`), npm fails with `EBADDEVENGINES`, so use `pnpm dlx` there.

In a terminal, in a repo that isn't set up yet, you can skip the word `init`: `npx yardhand@latest` (or `pnpm dlx yardhand@latest`, `bunx yardhand@latest`) walks you through setup. In a repo that already has `issues/`, or when there is no terminal, a bare `yardhand` prints the help.

Nothing is installed into your project. `init` writes plain files only.

## What `init` does

`yardhand init` creates `issues/`, `issues/yardhand.json`, one folder per status, and the `000-maintain-repo` issue (in `backlog`).

It asks:

1. **Which statuses to use.** `ready` and `in-progress` are pre-checked. You can add custom ones (typed freely, normalized to `kebab-case`), then always reorder them. `backlog` and `done` are always included but can sit anywhere in the order.
2. **Which AI tools work in the repo.** Pick none to leave AI out. See [AI tools](ai-tools.md).
3. **Whether to add `issues/` to an existing `.npmignore` and `.dockerignore`.**
4. **In a git repo, whether to add `.github/workflows/yardhand.yml`**, a GitHub Action that runs `validate` on every push.

For scripts: `yardhand init --yes --statuses a,b,c` does the same without questions. `--statuses` sets your statuses in order (default `backlog,ready,in-progress,done`). The ignore entries and the GitHub Action default to yes; skip them with `--no-ignore` and `--no-ci`. Add `--force` to re-run in a repo that is already set up (labels and assignees are kept).

## CI

The files are the source of truth, and people can edit them by hand or in GitHub's web editor. The GitHub Action that `init` offers runs `yardhand validate` on every push, so mistakes are caught however a change was made. `validate` exits `1` if anything is wrong.

## Keep issues out of packages and live sites

A normal build (Vite, Next, `tsc`) only outputs its build folder, so `issues/` stays out. It can leak through `npm publish` without a `files` list, a Docker `COPY . .` without a `.dockerignore` entry, or a host that serves the repo root. `init` offers the ignore entries and `validate` warns about the first two. Deploy from your build output folder, never the repo root.
