import { lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILE, ISSUES_DIR, TOOL } from "./names.js";
import { YardhandError, NotInitializedError } from "./errors.js";
import { STATUS_RE } from "./ids.js";

export interface Config {
  statuses: string[];
}

export const DEFAULT_STATUSES = ["backlog", "in-progress", "done"];

/** Problems with a statuses list, empty when valid. */
export function statusProblems(statuses: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(statuses) || statuses.some((s) => typeof s !== "string")) {
    return ['"statuses" must be an array of strings.'];
  }
  const list = statuses as string[];
  if (list.length < 2) out.push('"statuses" needs at least "backlog" and "done".');
  if (list[0] !== "backlog") out.push('The first status must be "backlog".');
  if (list[list.length - 1] !== "done") out.push('The last status must be "done".');
  const seen = new Set<string>();
  for (const s of list) {
    if (!STATUS_RE.test(s)) out.push(`Status "${s}" must be lowercase kebab-case.`);
    if (seen.has(s)) out.push(`Status "${s}" appears more than once.`);
    seen.add(s);
  }
  return out;
}

export function parseConfig(text: string): Config {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new YardhandError(`${CONFIG_FILE} is not valid JSON.`);
  }
  const statuses = (data as { statuses?: unknown } | null)?.statuses;
  const problems = statusProblems(statuses);
  if (problems.length) throw new YardhandError(`${CONFIG_FILE}: ${problems.join(" ")}`);
  return { statuses: statuses as string[] };
}

/** issues/ must be a real folder. Yardhand never follows a symlink there. */
export function assertIssuesDirIsReal(root: string): void {
  try {
    if (lstatSync(join(root, ISSUES_DIR)).isSymbolicLink()) {
      throw new YardhandError(`${ISSUES_DIR}/ is a symlink. ${TOOL} does not follow symlinks.`);
    }
  } catch (err) {
    if (err instanceof YardhandError) throw err;
    // Missing is fine here; other errors surface where the folder is used.
  }
}

/** Walk upward from `start` to find the repo root, the folder that holds issues/yardhand.json. */
export function findRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    try {
      statSync(join(dir, ISSUES_DIR, CONFIG_FILE));
      // Found. If it was reached through a symlinked issues/, refuse; an unrelated symlink
      // named issues/ in some parent folder is not our concern.
      assertIssuesDirIsReal(dir);
      return dir;
    } catch (err) {
      if (err instanceof YardhandError) throw err;
      const code = (err as NodeJS.ErrnoException).code;
      // Absent is the normal "keep looking". Anything else means issues/ is there but cannot be
      // read, and walking past it would hide the real problem.
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new YardhandError(`Cannot read ${ISSUES_DIR}/${CONFIG_FILE} in ${dir} (${code ?? "error"}).`);
      }
    }
    const up = dirname(dir);
    if (up === dir) {
      throw new NotInitializedError(`No ${ISSUES_DIR}/${CONFIG_FILE} found. Run "${TOOL} init" first.`);
    }
    dir = up;
  }
}

export function loadConfig(root: string): Config {
  return parseConfig(readFileSync(join(root, ISSUES_DIR, CONFIG_FILE), "utf8"));
}
