import type { Kind } from "./ids.js";

export interface NewIssueFields {
  id: string;
  kind: Kind;
  parent: string | null;
  status: string;
  assignee: string;
  priority?: string;
  dependsOn?: string[];
  related?: string[];
}

export function renderIssue(f: NewIssueFields): string {
  const lines = ["---", `id: ${f.id}`, `kind: ${f.kind}`];
  if (f.parent) lines.push(`parent: ${f.parent}`);
  lines.push(
    `status: ${f.status}`,
    `priority:${f.priority ? " " + f.priority : ""}`,
    `depends-on:${f.dependsOn?.length ? " " + f.dependsOn.join(", ") : ""}`,
    `related:${f.related?.length ? " " + f.related.join(", ") : ""}`,
    `assignee:${f.assignee ? " " + f.assignee : ""}`,
    "released-in:",
    "---",
    "",
    "## Description",
    "<!-- What and why. A buildable unit should fit one model session. -->",
    "",
    "## Acceptance criteria",
    "<!-- Checkable outcomes, one per line. -->",
    "",
  );
  return lines.join("\n");
}
