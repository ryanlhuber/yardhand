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
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** List every issue folder across all status folders, done included. */
export function scan(root: string, config: Config): Scan {
  const base = join(root, ISSUES_DIR);
  const issues: IssueDir[] = [];
  const unknownDirs: string[] = [];
  const missingStatuses: string[] = [];

  for (const entry of readdirSync(base).sort()) {
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
    for (const folder of readdirSync(statusDir).sort()) {
      const dir = join(statusDir, folder);
      if (!isDir(dir)) continue;
      issues.push({ id: leadingId(folder), folder, status, dir });
    }
  }
  return { issues, unknownDirs, missingStatuses };
}

export function allIds(s: Scan): string[] {
  return s.issues.flatMap((i) => (i.id ? [i.id] : []));
}
