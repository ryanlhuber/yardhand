import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ISSUES_DIR } from "./names.js";
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
  /** Configured statuses with no folder. */
  missingStatuses: string[];
  /** Configured statuses whose path exists but is not a folder, or cannot be read. */
  badStatusPaths: string[];
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** List every issue folder across all status folders, done included. Never throws on filesystem shape. */
export function scan(root: string, config: Config): Scan {
  const base = join(root, ISSUES_DIR);
  const issues: IssueDir[] = [];
  const unknownDirs: string[] = [];
  const missingStatuses: string[] = [];
  const badStatusPaths: string[] = [];

  for (const entry of readdirSync(base).sort()) {
    // Dot folders (such as the lock) are tool internals, not statuses.
    if (entry.startsWith(".")) continue;
    if (isDir(join(base, entry)) && !config.statuses.includes(entry)) {
      unknownDirs.push(entry);
    }
  }
  for (const status of config.statuses) {
    const statusDir = join(base, status);
    if (!existsSync(statusDir)) {
      missingStatuses.push(status);
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(statusDir).sort();
    } catch {
      badStatusPaths.push(status);
      continue;
    }
    for (const folder of entries) {
      const dir = join(statusDir, folder);
      if (!isDir(dir)) continue;
      issues.push({ id: leadingId(folder), folder, status, dir });
    }
  }
  return { issues, unknownDirs, missingStatuses, badStatusPaths };
}

export function allIds(s: Scan): string[] {
  return s.issues.flatMap((i) => (i.id ? [i.id] : []));
}
