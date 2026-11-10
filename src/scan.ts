import { lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { ISSUES_DIR } from "./names.js";
import { LoloError } from "./errors.js";
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
  /** Unknown folders that hold issue-looking folders, so IDs in them would be invisible. */
  strayIssues: string[];
  /** Configured statuses with no folder. */
  missingStatuses: string[];
  /** Configured statuses whose path exists but is a plain file, or cannot be read. */
  badStatusPaths: string[];
  /** Symlinks under issues/ (relative to issues/). Lolo does not follow them. */
  symlinks: string[];
}

/** A path relative to `root`, always with forward slashes, so output and tests match on every OS. */
export const rel = (root: string, p: string): string =>
  relative(root, p).split(sep).join("/");

type Kind = "dir" | "file" | "link" | "none";
const kindOf = (p: string): Kind => {
  try {
    const st = lstatSync(p);
    return st.isSymbolicLink() ? "link" : st.isDirectory() ? "dir" : "file";
  } catch {
    return "none";
  }
};

function holdsIssues(dir: string): boolean {
  try {
    return readdirSync(dir).some((e) => leadingId(e) !== null && kindOf(join(dir, e)) === "dir");
  } catch {
    return false;
  }
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
    symlinks: [],
  };

  for (const entry of readdirSync(base).sort()) {
    // Dot entries (such as the lock) are tool internals, not statuses.
    if (entry.startsWith(".") || config.statuses.includes(entry)) continue;
    const kind = kindOf(join(base, entry));
    if (kind === "link") out.symlinks.push(entry);
    if (kind === "dir") {
      out.unknownDirs.push(entry);
      if (holdsIssues(join(base, entry))) out.strayIssues.push(entry);
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
    if (kind === "file") {
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
      if (k !== "dir") continue;
      out.issues.push({ id: leadingId(folder), folder, status, dir });
    }
  }
  return out;
}

export function allIds(s: Scan): string[] {
  return s.issues.flatMap((i) => (i.id ? [i.id] : []));
}

/**
 * Creating or moving issues needs a complete picture of every existing ID. If part of the
 * tree could not be seen, refuse rather than risk handing out an ID that is already taken.
 */
export function assertComplete(s: Scan): void {
  if (s.badStatusPaths.length) {
    throw new LoloError(
      `Cannot read status folder${s.badStatusPaths.length > 1 ? "s" : ""}: ${s.badStatusPaths.join(", ")}. Fix that first so no existing ID is missed.`,
    );
  }
  if (s.strayIssues.length) {
    throw new LoloError(
      `Folder${s.strayIssues.length > 1 ? "s" : ""} under ${ISSUES_DIR}/ hold${s.strayIssues.length > 1 ? "" : "s"} issues but ${s.strayIssues.length > 1 ? "are" : "is"} not a status: ${s.strayIssues.join(", ")}. Add the status back to the config or move the issues, so no existing ID is missed.`,
    );
  }
  if (s.symlinks.length) {
    throw new LoloError(
      `Symlinks under ${ISSUES_DIR}/ are not supported: ${s.symlinks.join(", ")}. Replace them with real folders.`,
    );
  }
}
