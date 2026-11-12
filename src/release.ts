import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { YardhandError } from "./errors.js";
import { ISSUES_DIR, ISSUE_FILE, RELEASES_DIR } from "./names.js";
import { findRoot, loadConfig } from "./config.js";
import { assertComplete, rel, scan } from "./scan.js";
import { upsertField } from "./frontmatter.js";
import { commitIssue } from "./commit.js";
import { readIssues, parentField, type Issue } from "./issues.js";
import { withLock } from "./lock.js";
import { SEMVER_RE, compareSemver } from "./ids.js";

export interface ReleaseResult {
  version: string;
  /** IDs stamped by this run. */
  stamped: string[];
  /** Release file, relative to the repo root; null for a dry run or when there was nothing to release. */
  file: string | null;
  dryRun: boolean;
  notes: string[];
}

const DONE = "done";

/** Stamp released-in on every done issue without a version, and write issues/releases/<version>.md. */
export function release(cwd: string, version: string, dryRun = false): ReleaseResult {
  if (!SEMVER_RE.test(version)) {
    throw new YardhandError(`"${version}" is not valid semver. Use a version like 1.4.0 (no leading v).`);
  }
  const root = findRoot(cwd);
  const config = loadConfig(root);
  return withLock(root, () => {
    const s = scan(root, config);
    assertComplete(s);
    const issues = readIssues(root, s);
    const dir = join(root, ISSUES_DIR, RELEASES_DIR);
    const file = join(dir, `${version}.md`);
    const notes: string[] = [];
    if (existsSync(file)) {
      throw new YardhandError(`Version ${version} was already released (${rel(root, file)}). Releases are permanent; use the next version.`);
    }
    try {
      const higher = readdirSync(dir)
        .filter((n) => n.endsWith(".md") && SEMVER_RE.test(n.slice(0, -3)))
        .map((n) => n.slice(0, -3))
        .filter((v) => compareSemver(v, version) > 0)
        .sort(compareSemver)
        .pop();
      if (higher) notes.push(`Warning: ${version} is lower than the existing release ${higher}.`);
    } catch {
      // No releases folder yet.
    }

    const byId = (a: Issue, b: Issue) => ((a.id as string) < (b.id as string) ? -1 : 1);
    const targets = issues
      .filter((i) => i.id && i.status === DONE && i.fields && !i.fields["released-in"])
      .sort(byId);
    if (targets.length === 0) return { version, stamped: [], file: null, dryRun, notes: [...notes, "Nothing to release."] };
    if (dryRun) return { version, stamped: targets.map((i) => i.id as string), file: null, dryRun, notes };

    // Read and prepare everything before changing anything.
    const prepared = targets.map((i) => {
      const path = join(i.dir, ISSUE_FILE);
      if (lstatSync(path).isSymbolicLink()) throw new YardhandError(`${rel(root, path)} is a symlink. Yardhand does not follow symlinks.`);
      return { issue: i, text: upsertField(readFileSync(path, "utf8"), "released-in", version) };
    });
    const done: string[] = [];
    try {
      for (const p of prepared) {
        commitIssue(root, p.issue, p.text, { what: "released-in" });
        done.push(p.issue.id as string);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new YardhandError(`${msg} Stamped ${done.length} of ${prepared.length} issues before stopping (${done.join(", ") || "none"}). Fix the problem and run release ${version} again; stamped issues are kept.`);
    }

    // The release file lists every done issue stamped with this version (this run, or an earlier partial run).
    const all = readIssues(root, scan(root, config));
    const members = all.filter((i) => i.id && i.status === DONE && i.fields?.["released-in"] === version).sort(byId);
    const byIdMap = new Map(all.filter((i) => i.id).map((i) => [i.id as string, i]));
    const top = (i: Issue): Issue => {
      let cur = i;
      for (let n = 0; n < 3; n++) {
        const p = parentField(cur);
        const up = p ? byIdMap.get(p) : undefined;
        if (!up) break;
        cur = up;
      }
      return cur;
    };
    const groups = new Map<string, { head: Issue; items: Issue[] }>();
    for (const m of members) {
      const head = top(m);
      const g = groups.get(head.id as string) ?? { head, items: [] };
      g.items.push(m);
      groups.set(head.id as string, g);
    }
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const lines = [`# Release ${version}`, "", `Date: ${date}`, ""];
    for (const g of [...groups.values()].sort((a, b) => ((a.head.id as string) < (b.head.id as string) ? -1 : 1))) {
      lines.push(`## ${g.head.id}  ${g.head.slug}`);
      for (const m of g.items) lines.push(`- ${m.id}  ${m.slug}`);
      lines.push("");
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, lines.join("\n"), { flag: "wx" });
    return { version, stamped: done, file: rel(root, file), dryRun, notes };
  });
}
