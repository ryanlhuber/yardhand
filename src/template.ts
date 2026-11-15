import type { Kind } from "./ids.js";
import { formatList } from "./ids.js";
import { fieldLine } from "./frontmatter.js";
import { CONFIG_FILE, ISSUES_DIR } from "./names.js";

export interface NewIssueFields {
  id: string;
  kind: Kind;
  parent: string | null;
  status: string;
  /** A handle like `@claude-opus`, or empty. */
  assignee: string;
  /** The H1 title. */
  title: string;
  priority?: string;
  size?: string;
  labels?: string[];
  dependsOn?: string[];
  related?: string[];
  effort?: string;
  /** Write the effort line even when empty. False when AI is off; a set effort is always written. */
  withEffort?: boolean;
}

/** Comments written after each field, so people (and models) editing by hand know the allowed values. */
export const FIELD_COMMENTS: Record<string, string> = {
  kind: "# feature | task | bug",
  parent: "# omit for level 1 only",
  status: "# must match the folder",
  priority: "# urgent | high | medium | low",
  size: "# small | medium | large",
  labels: `# names from ${ISSUES_DIR}/${CONFIG_FILE}, e.g. [backend, auth]`,
  "depends-on": "# issue IDs, e.g. [017.01.01, 017.02]",
  related: "# issue IDs",
  assignee: `# "@handle" from ${ISSUES_DIR}/${CONFIG_FILE}, e.g. "@claude-opus"`,
  effort: "# free text, one word, e.g. low | medium | high | xhigh",
  "released-in": "# set by `release`",
};

export const REQUIRED_HEADER = "# Required";
export const OPTIONAL_HEADER = "# Optional (blank = unset)";

/** The H1 title seeded from a slug: dashes become spaces, first letter capitalized. `add-login-form` becomes `Add login form`. */
export const titleFromSlug = (slug: string): string => {
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Quote an assignee handle: `@` cannot start an unquoted YAML value. */
export const quoteHandle = (handle: string): string => (handle ? `"${handle}"` : "");

/** The front matter lines, grouped into required and optional. */
export function renderFrontMatter(f: NewIssueFields): string[] {
  const line = (key: string, value: string) => fieldLine(key, value, FIELD_COMMENTS[key] ?? "");
  const lines = ["---", REQUIRED_HEADER, `id: ${f.id}`, line("kind", f.kind)];
  if (f.parent) lines.push(line("parent", f.parent));
  lines.push(
    line("status", f.status),
    "",
    OPTIONAL_HEADER,
    line("priority", f.priority ?? ""),
    line("size", f.size ?? ""),
    line("labels", formatList(f.labels ?? [])),
    line("depends-on", formatList(f.dependsOn ?? [])),
    line("related", formatList(f.related ?? [])),
    line("assignee", quoteHandle(f.assignee)),
  );
  if ((f.withEffort ?? true) || f.effort) lines.push(line("effort", f.effort ?? ""));
  lines.push(line("released-in", ""), "---");
  return lines;
}

/** The ISSUE.md that `new` writes. */
export function renderIssue(f: NewIssueFields): string {
  return [
    ...renderFrontMatter(f),
    "",
    `# ${f.title}`,
    "",
    "## Description",
    "<!-- What and why. A buildable unit should fit one model session. -->",
    "",
    "## Acceptance criteria",
    "<!-- Checkable outcomes, one per line, as checkboxes: - [ ] ... -->",
    "- [ ]",
    "",
  ].join("\n");
}

/** The catch-all `000-maintain-repo` issue that `init` creates. It is never finished, so it has no checkboxes. */
export function renderMaintainRepo(status: string, tool: string, withEffort = true): string {
  return [
    ...renderFrontMatter({ id: "000", kind: "feature", parent: null, status, assignee: "", title: "", withEffort }),
    "",
    "# Maintain repo",
    "",
    "## Description",
    "Home for maintenance work and bugs that don't belong to a feature: dependency updates, tooling, docs fixes, cleanup.",
    "",
    `- Add work as children: \`${tool} new <slug> --parent 000\`, or by hand following the conventions.`,
    "- Group related maintenance under a level-2 issue when it grows, e.g. `000.01-update-dependencies`.",
    "- If a bug turns out to belong to a feature, change its `parent` to that feature. Its ID stays the same.",
    "- This issue stays open. Never move it to `done`.",
    "",
    "## Acceptance criteria",
    "<!-- None. This issue is a permanent container and is never finished. -->",
    "",
  ].join("\n");
}
