export interface NewIssueFields {
  id: string;
  kind: "task" | "bug";
  parent: string | null;
  status: string;
  assignee: string;
}

export function renderIssue(f: NewIssueFields): string {
  const lines = ["---", `id: ${f.id}`, `kind: ${f.kind}`];
  if (f.parent) lines.push(`parent: ${f.parent}`);
  lines.push(
    `status: ${f.status}`,
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
