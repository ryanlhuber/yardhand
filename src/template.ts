export interface NewIssueFields {
  id: string;
  kind: "task" | "bug";
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
    "",
    "## Acceptance criteria",
    "",
  );
  return lines.join("\n");
}
