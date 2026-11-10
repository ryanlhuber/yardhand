import { lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ISSUES_DIR, ISSUE_FILE } from "./names.js";
import { YardhandError } from "./errors.js";
import { leadingId } from "./ids.js";
import type { Config } from "./config.js";

export interface IssueDir {
  /** ID from the folder name (loose match: valid ID then a hyphen). */
  id: string | null;
  folder: string;
  status: string;
  /** Absolute path of the issue folder. */
  dir: string;
}

export interface Scan {
  issues: IssueDir[];
  /** Folders directly under issues/ that are not a configured status. */
  unknownDirs: string[];
  /** Unknown folders that hold, or may hold, issue folders, so IDs in them would be invisible. */
  strayIssues: string[];
  /** Configured statuses with no folder. */
  missingStatuses: string[];
  /** Configured statuses whose path is a plain file, or cannot be listed. */
  badStatusPaths: string[];
  /** Entries that could not be inspected (permissions, I/O errors), relative to issues/. */
  unreadable: string[];
  /** Symlinks under issues/ (relative to issues/). Yardhand does not follow them. */
  symlinks: string[];
}

/** A path relative to `root`, always with forward slashes, so output and tests match on every OS. */
export const rel = (root: string, p: string): string =>
  relative(root, p).split(sep).join("/");

// "error" means the entry exists but could not be inspected. It is never treated as "absent":
// an entry we cannot see might hold IDs that are already taken.
type Kind = "dir" | "file" | "link" | "none" | "error";
const kindOf = (p: string): Kind => {
  try {
    const st = lstatSync(p);
    return st.isSymbolicLink() ? "link" : st.isDirectory() ? "dir" : "file";
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "none" : "error";
  }
};

/** Does this unknown folder hold issue folders? "unknown" when it cannot be fully inspected. */
function holdsIssues(dir: string): "yes" | "no" | "unknown" {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return "unknown";
  }
  let result: "yes" | "no" | "unknown" = "no";
  for (const e of entries) {
    if (leadingId(e) === null) continue;
    const k = kindOf(join(dir, e));
    if (k === "dir") return "yes";
    if (k === "error") result = "unknown";
  }
  return result;
}

/** List every issue folder across all status folders, done included. Never throws on filesystem shape. */
export function scan(root: string, config: Config): Scan {
  const base = join(root, ISSUES_DIR);
  const out: Scan = {
    issues: [],
    unknownDirs: [],
    strayIssues: [],
    missingStatuses: [],
    badStatusPaths: [],
    unreadable: [],
    symlinks: [],
  };

  let top: string[];
  try {
    top = readdirSync(base).sort();
  } catch (err) {
    throw new YardhandError(`Cannot read ${ISSUES_DIR}/ (${(err as NodeJS.ErrnoException).code ?? "error"}).`);
  }
  for (const entry of top) {
    // Dot entries (such as the lock) are tool internals, not statuses.
    if (entry.startsWith(".") || config.statuses.includes(entry)) continue;
    const kind = kindOf(join(base, entry));
    if (kind === "link") out.symlinks.push(entry);
    if (kind === "error") out.unreadable.push(entry);
    if (kind === "dir") {
      out.unknownDirs.push(entry);
      const holds = holdsIssues(join(base, entry));
      if (holds !== "no") out.strayIssues.push(entry);
    }
  }
  for (const status of config.statuses) {
    const statusDir = join(base, status);
    const kind = kindOf(statusDir);
    if (kind === "none") {
      out.missingStatuses.push(status);
      continue;
    }
    if (kind === "link") {
      out.symlinks.push(status);
      continue;
    }
    if (kind === "file" || kind === "error") {
      out.badStatusPaths.push(status);
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(statusDir).sort();
    } catch {
      out.badStatusPaths.push(status);
      continue;
    }
    for (const folder of entries) {
      const dir = join(statusDir, folder);
      const k = kindOf(dir);
      if (k === "link") out.symlinks.push(`${status}/${folder}`);
      if (k === "error") out.unreadable.push(`${status}/${folder}`);
      if (k !== "dir") continue;
      out.issues.push({ id: leadingId(folder), folder, status, dir });
      const f = kindOf(join(dir, ISSUE_FILE));
      if (f === "link") out.symlinks.push(`${status}/${folder}/${ISSUE_FILE}`);
      if (f === "error") out.unreadable.push(`${status}/${folder}/${ISSUE_FILE}`);
    }
  }
  return out;
}

export function allIds(s: Scan): string[] {
  return s.issues.flatMap((i) => (i.id ? [i.id] : []));
}

const list = (items: string[]) => items.join(", ");

/**
 * Creating or moving issues needs a complete picture of every existing ID. If part of the
 * tree could not be seen, refuse rather than risk handing out an ID that is already taken.
 */
export function assertComplete(s: Scan): void {
  if (s.badStatusPaths.length) {
    throw new YardhandError(
      `Cannot read status folder${s.badStatusPaths.length > 1 ? "s" : ""}: ${list(s.badStatusPaths)}. Fix that first so no existing ID is missed.`,
    );
  }
  if (s.unreadable.length) {
    throw new YardhandError(
      `Cannot inspect: ${list(s.unreadable)}. Fix the permissions first so no existing ID is missed.`,
    );
  }
  if (s.strayIssues.length) {
    throw new YardhandError(
      `${list(s.strayIssues)} ${s.strayIssues.length > 1 ? "are not statuses but hold" : "is not a status but holds"} issues, or cannot be fully read. Add ${s.strayIssues.length > 1 ? "them" : "it"} to the status list or move the issues, so no existing ID is missed.`,
    );
  }
  if (s.symlinks.length) {
    throw new YardhandError(
      `Symlinks under ${ISSUES_DIR}/ are not supported: ${list(s.symlinks)}. Replace them with real folders and files.`,
    );
  }
}
