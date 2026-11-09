import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILE, ISSUES_DIR, TOOL } from "./names.js";
import { LoloError } from "./errors.js";
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
    throw new LoloError(`${CONFIG_FILE} is not valid JSON.`);
  }
  const statuses = (data as { statuses?: unknown } | null)?.statuses;
  const problems = statusProblems(statuses);
  if (problems.length) throw new LoloError(`${CONFIG_FILE}: ${problems.join(" ")}`);
  return { statuses: statuses as string[] };
}

/** Walk upward from `start` to find the repo root, the folder that holds issues/lolo.json. */
export function findRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ISSUES_DIR, CONFIG_FILE))) return dir;
    const up = dirname(dir);
    if (up === dir) {
      throw new LoloError(`No ${ISSUES_DIR}/${CONFIG_FILE} found. Run "${TOOL} init" first.`);
    }
    dir = up;
  }
}

export function loadConfig(root: string): Config {
  return parseConfig(readFileSync(join(root, ISSUES_DIR, CONFIG_FILE), "utf8"));
}
