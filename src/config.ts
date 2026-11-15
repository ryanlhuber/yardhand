import { lstatSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CONFIG_FILE, ISSUES_DIR, RELEASES_DIR, TOOL } from "./names.js";
import { YardhandError, NotInitializedError } from "./errors.js";
import { HANDLE_RE, LABEL_RE, STATUS_RE } from "./ids.js";

export type AssigneeType = "person" | "model";

export interface Assignee {
  type: AssigneeType;
  /** Optional command template a later `run` command can use to launch a model. */
  run?: string;
}

export interface Config {
  statuses: string[];
  /** Allowed label names. */
  labels: string[];
  /** Assignee handles (like `@ryan`, `@claude-opus`) and what each one is. */
  assignees: Record<string, Assignee>;
  /**
   * AI tools that work in this repo. An empty list means AI is off. Missing (configs written
   * before this field existed) means AI is on with AGENTS.md only, as before.
   */
  agents?: Agent[];
}

/** AI tools `init` can set up. "other" means any tool that reads AGENTS.md or .agents/skills. */
export const AGENTS = ["claude-code", "codex", "opencode", "other"] as const;
export type Agent = (typeof AGENTS)[number];

/** True unless the config turns AI off with an empty "agents" list. */
export const aiOn = (config: Config): boolean => config.agents === undefined || config.agents.length > 0;

export const DEFAULT_STATUSES = ["backlog", "ready", "in-progress", "done"];

/** Problems with a statuses list, empty when valid. */
export function statusProblems(statuses: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(statuses) || statuses.some((s) => typeof s !== "string")) {
    return ['"statuses" must be an array of strings.'];
  }
  const list = statuses as string[];
  if (list.length < 2) out.push('"statuses" needs at least "backlog" and "done".');
  if (list.includes(RELEASES_DIR)) out.push(`"${RELEASES_DIR}" is reserved for release files and cannot be a status.`);
  for (const required of ["backlog", "done"]) {
    if (!list.includes(required)) out.push(`"statuses" must include "${required}".`);
  }
  const seen = new Set<string>();
  for (const s of list) {
    if (!STATUS_RE.test(s)) out.push(`Status "${s}" must be lowercase kebab-case.`);
    if (seen.has(s)) out.push(`Status "${s}" appears more than once.`);
    seen.add(s);
  }
  return out;
}

/** Problems with a labels list, empty when valid. A missing list means no labels. */
export function labelProblems(labels: unknown): string[] {
  if (labels === undefined) return [];
  if (!Array.isArray(labels) || labels.some((l) => typeof l !== "string")) return ['"labels" must be an array of strings.'];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of labels as string[]) {
    if (!LABEL_RE.test(l)) out.push(`Label "${l}" must be lowercase kebab-case.`);
    if (seen.has(l)) out.push(`Label "${l}" appears more than once.`);
    seen.add(l);
  }
  return out;
}

/** Problems with the agents list, empty when valid. A missing list is fine. */
export function agentProblems(agents: unknown): string[] {
  if (agents === undefined) return [];
  if (!Array.isArray(agents) || agents.some((a) => typeof a !== "string")) {
    return [`"agents" must be an array, like ["claude-code", "codex"], or [] for no AI.`];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const a of agents as string[]) {
    if (!(AGENTS as readonly string[]).includes(a)) out.push(`Agent "${a}" must be one of: ${AGENTS.join(", ")}.`);
    if (seen.has(a)) out.push(`Agent "${a}" appears more than once.`);
    seen.add(a);
  }
  return out;
}

const isType = (t: unknown): t is AssigneeType => t === "person" || t === "model";

/** Problems with the assignees map, empty when valid. A missing map means no assignees. */
export function assigneeProblems(assignees: unknown): string[] {
  if (assignees === undefined) return [];
  if (assignees === null || typeof assignees !== "object" || Array.isArray(assignees)) {
    return ['"assignees" must be an object mapping handles to "person" or "model", like {"@ryan": "person"}.'];
  }
  const out: string[] = [];
  for (const [handle, value] of Object.entries(assignees)) {
    if (!HANDLE_RE.test(handle)) out.push(`Assignee "${handle}" must be @ then lowercase kebab-case, like @claude-opus (no dots or spaces).`);
    if (isType(value)) continue;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const v = value as { type?: unknown; run?: unknown };
      if (!isType(v.type)) out.push(`Assignee "${handle}" needs "type": "person" or "model".`);
      if (v.run !== undefined && typeof v.run !== "string") out.push(`Assignee "${handle}": "run" must be a string.`);
      continue;
    }
    out.push(`Assignee "${handle}" must be "person", "model", or an object with a "type".`);
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
  const obj = (data ?? {}) as { statuses?: unknown; labels?: unknown; assignees?: unknown; agents?: unknown };
  const problems = [
    ...statusProblems(obj.statuses),
    ...labelProblems(obj.labels),
    ...assigneeProblems(obj.assignees),
    ...agentProblems(obj.agents),
  ];
  if (problems.length) throw new YardhandError(`${CONFIG_FILE}: ${problems.join(" ")}`);
  const assignees: Record<string, Assignee> = Object.create(null);
  for (const [handle, value] of Object.entries((obj.assignees ?? {}) as Record<string, unknown>)) {
    assignees[handle] = isType(value) ? { type: value } : (value as Assignee);
  }
  const config: Config = { statuses: obj.statuses as string[], labels: (obj.labels as string[] | undefined) ?? [], assignees };
  if (obj.agents !== undefined) config.agents = obj.agents as Agent[];
  return config;
}

/** The JSON written to yardhand.json. Assignees keep the short "person"/"model" form unless they carry more. */
export function serializeConfig(config: Config): string {
  const assignees: Record<string, unknown> = {};
  for (const [handle, a] of Object.entries(config.assignees)) assignees[handle] = a.run === undefined ? a.type : a;
  const data: Record<string, unknown> = { statuses: config.statuses, labels: config.labels, assignees };
  if (config.agents !== undefined) data["agents"] = config.agents;
  return JSON.stringify(data, null, 2) + "\n";
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
