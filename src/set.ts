import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { YardhandError } from "./errors.js";
import { ISSUES_DIR, ISSUE_FILE } from "./names.js";
import { findRoot, loadConfig } from "./config.js";
import { allIds, assertComplete, rel, scan } from "./scan.js";
import { parseFrontMatter, upsertField } from "./frontmatter.js";
import { commitIssue } from "./commit.js";
import { readIssues } from "./issues.js";
import { withLock } from "./lock.js";
import {
  KINDS,
  PRIORITIES,
  SEMVER_RE,
  depth,
  folderName,
  isValidId,
  parseFolderName,
  splitIdList,
  UNSAFE_ASSIGNEE,
} from "./ids.js";

export interface SetOptions {
  kind?: string;
  priority?: string;
  parent?: string;
  dependsOn?: string;
  related?: string;
  assignee?: string;
  releasedIn?: string;
}

export interface Change {
  field: string;
  from: string;
  to: string;
}

export interface SetResult {
  id: string;
  /** The issue folder after the change, relative to the repo root. */
  path: string;
  changes: Change[];
  unchanged: boolean;
}

const isNone = (v: string) => v.trim().toLowerCase() === "none";
const show = (v: string) => (v === "" ? "none" : v);

/** Change front matter on an existing issue. Renames the folder when kind changes (the bug- prefix). */
export function setIssue(cwd: string, id: string, opts: SetOptions): SetResult {
  if (!isValidId(id)) throw new YardhandError(`"${id}" is not a valid ID.`);
  if (Object.values(opts).every((v) => v === undefined)) {
    throw new YardhandError("Nothing to set. Pass at least one of --kind, --priority, --parent, --depends-on, --related, --assignee, --released-in.");
  }
  const root = findRoot(cwd);
  const config = loadConfig(root);

  return withLock(root, () => {
    const s = scan(root, config);
    assertComplete(s);
    const issues = readIssues(root, s);
    const matches = issues.filter((i) => i.id === id);
    if (matches.length === 0) throw new YardhandError(`Issue ${id} not found.`);
    if (matches.length > 1) {
      throw new YardhandError(`Issue ${id} exists in more than one place; run validate and fix the duplicate first.`);
    }
    const issue = matches[0]!;
    const ids = allIds(s);

    const file = join(issue.dir, ISSUE_FILE);
    let text: string;
    try {
      if (lstatSync(file).isSymbolicLink()) throw new YardhandError(`${rel(root, file)} is a symlink. Yardhand does not follow symlinks.`);
      text = readFileSync(file, "utf8");
    } catch (err) {
      if (err instanceof YardhandError) throw err;
      throw new YardhandError(`Cannot read ${rel(root, file)}.`);
    }
    const fm = parseFrontMatter(text);
    if (!fm) throw new YardhandError(`${rel(root, file)} has no valid front matter. Run validate first.`);
    const current = fm.fields;

    // New values, validated. An empty string means "cleared".
    const next: Record<string, string> = {};
    if (opts.kind !== undefined) {
      const kind = opts.kind.trim().toLowerCase();
      if (!(KINDS as readonly string[]).includes(kind)) throw new YardhandError(`--kind must be one of: ${KINDS.join(", ")}.`);
      next["kind"] = kind;
    }
    if (opts.priority !== undefined) {
      const p = opts.priority.trim().toLowerCase();
      if (isNone(p)) next["priority"] = "";
      else if (!(PRIORITIES as readonly string[]).includes(p)) {
        throw new YardhandError(`--priority must be one of: ${PRIORITIES.join(", ")}, or none.`);
      } else next["priority"] = p;
    }
    if (opts.parent !== undefined) {
      const parent = opts.parent.trim();
      if (depth(id) === 1) throw new YardhandError(`${id} is a level-1 issue and cannot have a parent.`);
      if (isNone(parent)) throw new YardhandError(`${id} must have a parent (level ${depth(id)}). Pass the new parent's ID instead of none.`);
      if (!isValidId(parent)) throw new YardhandError(`--parent: "${parent}" is not a valid ID.`);
      if (!ids.includes(parent)) throw new YardhandError(`--parent: issue ${parent} does not exist.`);
      if (depth(parent) >= depth(id)) throw new YardhandError(`--parent ${parent} must be at a shallower level than ${id}.`);
      next["parent"] = parent;
    }
    for (const [flag, key, raw] of [
      ["--depends-on", "depends-on", opts.dependsOn],
      ["--related", "related", opts.related],
    ] as const) {
      if (raw === undefined) continue;
      const list = isNone(raw) ? [] : splitIdList(raw);
      for (const x of list) {
        if (!isValidId(x)) throw new YardhandError(`${flag}: "${x}" is not a valid ID.`);
        if (!ids.includes(x)) throw new YardhandError(`${flag}: issue ${x} does not exist.`);
        if (x === id) throw new YardhandError(`${flag} must not list the issue itself (${id}).`);
      }
      next[key] = list.join(", ");
    }
    if (opts.assignee !== undefined) {
      if (UNSAFE_ASSIGNEE.test(opts.assignee)) {
        throw new YardhandError("--assignee must be a single line of text and must not contain # or control characters.");
      }
      next["assignee"] = isNone(opts.assignee) ? "" : opts.assignee.trim();
    }
    if (opts.releasedIn !== undefined) {
      const v = opts.releasedIn.trim();
      if (isNone(v)) next["released-in"] = "";
      else if (!SEMVER_RE.test(v)) throw new YardhandError(`--released-in "${v}" is not valid semver.`);
      else next["released-in"] = v;
    }

    // A depends-on change must not create a loop.
    if (next["depends-on"] !== undefined) {
      const graph = new Map<string, string[]>();
      for (const i of issues) if (i.id) graph.set(i.id, splitIdList(i.fields?.["depends-on"] ?? ""));
      graph.set(id, splitIdList(next["depends-on"]));
      const seen = new Set<string>();
      const stack = [...(graph.get(id) ?? [])];
      while (stack.length) {
        const n = stack.pop() as string;
        if (n === id) throw new YardhandError(`--depends-on would create a loop through ${id}.`);
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(...(graph.get(n) ?? []));
      }
    }

    const changes: Change[] = [];
    for (const [field, to] of Object.entries(next)) {
      const from = current[field] ?? "";
      // Lists compare as sets of IDs written the same way, so "a,b" and "a, b" are the same.
      const same = field === "depends-on" || field === "related" ? splitIdList(from).join(", ") === to : from === to;
      if (!same) changes.push({ field, from: show(from), to: show(to) });
    }
    const here = rel(root, issue.dir);

    // Passing --kind also reconciles the folder name (the bug- prefix) with the kind,
    // even when the front-matter value is already right. This is the repair path validate points to.
    let destDir: string | undefined;
    if (next["kind"] !== undefined) {
      const parsed = parseFolderName(issue.folder);
      if (!parsed) throw new YardhandError(`${here} has an invalid folder name. Run validate and fix it first.`);
      const name = folderName(id, parsed.slug, next["kind"] === "bug");
      if (name !== issue.folder) {
        destDir = join(root, ISSUES_DIR, issue.status, name);
        if (existsSync(destDir)) throw new YardhandError(`${rel(root, destDir)} already exists.`);
      }
    }
    if (changes.length === 0 && destDir === undefined) return { id, path: here, changes, unchanged: true };

    let updated = text;
    for (const c of changes) updated = upsertField(updated, c.field, next[c.field] as string);

    const finalDir = commitIssue(root, issue, updated, {
      destDir,
      what: "the changes",
      stateHint: "Rename it back by hand, or fix the fields.",
    });
    return { id, path: rel(root, finalDir), changes, unchanged: false };
  });
}
