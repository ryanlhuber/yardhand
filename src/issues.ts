import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ISSUE_FILE } from "./names.js";
import { parseFrontMatter } from "./frontmatter.js";
import { splitPrefix } from "./ids.js";
import { rel, type Scan } from "./scan.js";

export interface Issue {
  /** ID from the folder name, or null when the folder has none. */
  id: string | null;
  folder: string;
  status: string;
  /** Absolute path of the issue folder. */
  dir: string;
  /** Path of the folder relative to the repo root, with forward slashes. */
  path: string;
  /** Slug without the `bug-` prefix, and whether the folder carries that prefix. */
  slug: string;
  bug: boolean;
  /** Front matter, or null when ISSUE.md is missing, unreadable, a symlink, or malformed. */
  fields: Record<string, string> | null;
}

/** Read the front matter of every scanned issue. Never throws on filesystem shape. */
export function readIssues(root: string, s: Scan): Issue[] {
  return s.issues.map((i) => {
    const rest = i.id ? i.folder.slice(i.id.length + 1) : i.folder;
    const { bug, slug } = splitPrefix(rest);
    let fields: Record<string, string> | null = null;
    try {
      const file = join(i.dir, ISSUE_FILE);
      if (!lstatSync(file).isSymbolicLink()) fields = parseFrontMatter(readFileSync(file, "utf8"))?.fields ?? null;
    } catch {
      fields = null;
    }
    return { id: i.id, folder: i.folder, status: i.status, dir: i.dir, path: rel(root, i.dir), slug, bug, fields };
  });
}

/** The parent of an issue by its `parent:` field (the source of truth), or null for top level. */
export const parentField = (i: Issue): string | null => (i.fields?.["parent"] ? (i.fields["parent"] as string) : null);

/** All descendants of `id` by following `parent:` fields. */
export function descendantsOf(issues: Issue[], id: string): Issue[] {
  const out: Issue[] = [];
  const queue = [id];
  while (queue.length) {
    const next = queue.shift() as string;
    for (const i of issues) {
      if (i.id && parentField(i) === next) {
        out.push(i);
        queue.push(i.id);
      }
    }
  }
  return out;
}
