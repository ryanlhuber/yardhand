// The core works with no extras in use (SPEC.md, "Core and extras").
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "../src/commands.js";

function write(root: string, path: string, text: string): void {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, text);
}

const issue = (id: string, kind: string, status: string, parent: string | null, title: string, done: boolean) =>
  [
    "---",
    `id: ${id}`,
    `kind: ${kind}`,
    ...(parent ? [`parent: ${parent}`] : []),
    `status: ${status}`,
    "---",
    "",
    `# ${title}`,
    "",
    "## Description",
    "What and why.",
    "",
    "## Acceptance criteria",
    `- [${done ? "x" : " "}] It works`,
    "",
  ].join("\n");

test("core only: a hand-made repo with no optional fields, labels, assignees or AI is valid with no warnings", () => {
  const root = mkdtempSync(join(tmpdir(), "yardhand-core-"));
  write(root, "issues/yardhand.json", JSON.stringify({ statuses: ["backlog", "in-progress", "done"] }, null, 2) + "\n");
  mkdirSync(join(root, "issues/in-progress"));
  write(root, "issues/backlog/001-add-auth/ISSUE.md", issue("001", "feature", "backlog", null, "Add auth", false));
  write(root, "issues/backlog/001.01-add-login/ISSUE.md", issue("001.01", "task", "backlog", "001", "Add login", false));
  write(root, "issues/done/002-bug-fix-crash/ISSUE.md", issue("002", "bug", "done", null, "Fix crash", true));

  const result = check(root);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});
