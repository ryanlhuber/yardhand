import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { YardhandError, NotInitializedError } from "./errors.js";
import { CONFIG_FILE, ISSUES_DIR, ISSUE_FILE, TOOL } from "./names.js";
import {
  type Config,
  assertIssuesDirIsReal,
  findRoot,
  loadConfig,
  parseConfig,
  serializeConfig,
  statusProblems,
} from "./config.js";
import { allIds, assertComplete, rel, scan } from "./scan.js";
import {
  BUG_PREFIX,
  EFFORT_RE,
  HANDLE_RE,
  KINDS,
  LABEL_RE,
  PRIORITIES,
  SEMVER_RE,
  SIZES,
  SLUG_RE,
  type Kind,
  defaultKind,
  depth,
  folderName,
  isValidId,
  nextChild,
  nextTopLevel,
  normalizeHandle,
  normalizeName,
  parentOf,
  parseFolderName,
  splitIdList,
  splitList,
  splitPrefix,
} from "./ids.js";
import { parseFrontMatter, setField } from "./frontmatter.js";
import { commitIssue, TMP_RE, tryRemove } from "./commit.js";
import { readIssues, parentField } from "./issues.js";
import { buildRoadmap } from "./roadmap.js";
import { RELEASES_DIR, ROADMAP_FILE } from "./names.js";
import { renderIssue, renderMaintainRepo, titleFromSlug } from "./template.js";
import { applyBlocks, planBlocks, renderBlock } from "./block.js";
import { withLock } from "./lock.js";

const errCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? "error";
// Control characters (C0, DEL, and C1), Unicode line/paragraph separators, and "#" could change how the file parses.

export interface InitResult {
  root: string;
  statuses: string[];
  blocks: string[];
  /** Ignore files that got an `issues/` line. */
  ignoreFiles: string[];
  /** The CI workflow file created, relative to the root, or null. */
  workflow: string | null;
}

export interface InitOptions {
  /** Add `issues/` to an existing .npmignore and .dockerignore. Default true. */
  ignore?: boolean;
  /** Create the GitHub Action that runs validate on every push. Default true. */
  ci?: boolean;
}

/** Ignore files that, when they exist, should list issues/ so it never ships in a package or image. */
export const IGNORE_FILES = [".npmignore", ".dockerignore"] as const;
export const WORKFLOW_FILE = ".github/workflows/yardhand.yml";

/** True when an ignore file already has a line that excludes issues/. */
export const ignoresIssues = (text: string): boolean =>
  text.split(/\r?\n/).some((l) => /^\/?issues(?:\/(?:\*\*)?)?$/.test(l.trim()));

/** The folder `init` will set up: the existing root if there is one, else the current folder. */
export function initRoot(cwd: string): string {
  try {
    return findRoot(cwd);
  } catch (err) {
    if (err instanceof NotInitializedError) return resolve(cwd);
    throw err;
  }
}

/** Ignore files that exist and do not list issues/ yet. These are the ones `init` offers to change. */
export function ignoreTargets(root: string): string[] {
  return IGNORE_FILES.filter((name) => {
    const path = join(root, name);
    try {
      return lstatSync(path).isFile() && !ignoresIssues(readFileSync(path, "utf8"));
    } catch {
      return false;
    }
  });
}

/** True when `init` should offer the CI workflow: a git repo without the file. */
export const workflowWanted = (root: string): boolean =>
  existsSync(join(root, ".git")) && !existsSync(join(root, WORKFLOW_FILE));

export function renderWorkflow(version: string): string {
  return [
    `name: ${TOOL}`,
    "on: [push, pull_request]",
    "jobs:",
    "  validate:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-node@v4",
    "        with:",
    "          node-version: 22",
    `      - run: npx --yes ${TOOL}@${version} validate`,
    "",
  ].join("\n");
}

export function init(
  cwd: string,
  statuses: string[],
  version: string,
  force = false,
  opts: InitOptions = {},
): InitResult {
  const problems = statusProblems(statuses);
  if (problems.length) throw new YardhandError(problems.join(" "));

  // Like every other command, init works from the existing root when there is one. Only
  // "not set up yet" means start fresh; a root that is there but unreadable is an error.
  let existing: string | null = null;
  try {
    existing = findRoot(cwd);
  } catch (err) {
    if (!(err instanceof NotInitializedError)) throw err;
  }
  if (existing && !force) {
    const where = rel(resolve(cwd), existing);
    throw new YardhandError(
      `Already initialized${where ? ` at ${where}` : ""} (${ISSUES_DIR}/${CONFIG_FILE} exists). Use --force to overwrite the config.`,
    );
  }
  const root = existing ?? resolve(cwd);
  const config: Config = { statuses, labels: [], assignees: {} };
  // --force replaces the statuses but keeps the labels and assignees already defined.
  if (existing) {
    try {
      const old = parseConfig(readFileSync(join(root, ISSUES_DIR, CONFIG_FILE), "utf8"));
      config.labels = old.labels;
      config.assignees = old.assignees;
    } catch {
      // An unreadable or invalid old config is being replaced anyway.
    }
  }
  assertIssuesDirIsReal(root);

  // Plan the AGENTS.md / CLAUDE.md updates first: damaged markers must fail before anything is written.
  const plan = planBlocks(root, renderBlock(config, version));

  mkdirSync(join(root, ISSUES_DIR), { recursive: true });
  // Everything that reads or changes issues/ happens under the same lock as new and move.
  withLock(root, () => {
    // Refuse before changing anything unless every existing ID is visible. A status list that
    // drops a folder holding issues, or a part of the tree that cannot be read, would hide
    // IDs and let them be handed out again.
    assertComplete(scan(root, config));
    const hasCatchAll = allIds(scan(root, config)).includes("000");

    writeFileSync(join(root, ISSUES_DIR, CONFIG_FILE), serializeConfig(config));
    for (const status of statuses) {
      const dir = join(root, ISSUES_DIR, status);
      mkdirSync(dir, { recursive: true });
      const keep = join(dir, ".gitkeep");
      if (!existsSync(keep)) writeFileSync(keep, "");
    }
    // 000 is the catch-all parent for maintenance and bugs with no clear home. It always starts
    // in backlog, whichever status comes first. Created with exclusive operations, so an
    // existing issue can never be overwritten.
    if (!hasCatchAll) {
      const first = "backlog";
      const dir = join(root, ISSUES_DIR, first, folderName("000", "maintain-repo"));
      try {
        mkdirSync(dir);
        writeFileSync(join(dir, ISSUE_FILE), renderMaintainRepo(first, TOOL), { flag: "wx" });
      } catch (err) {
        if (errCode(err) !== "EEXIST") throw err;
      }
    }
  });

  // Append-only: one "issues/" line at the end of each existing ignore file that lacks it.
  const ignoreFiles: string[] = [];
  if (opts.ignore ?? true) {
    for (const name of ignoreTargets(root)) {
      const path = join(root, name);
      const text = readFileSync(path, "utf8");
      writeFileSync(path, text + (text === "" || text.endsWith("\n") ? "" : "\n") + `${ISSUES_DIR}/\n`);
      ignoreFiles.push(name);
    }
  }
  // Never overwrites: created only when missing, exclusively.
  let workflow: string | null = null;
  if ((opts.ci ?? true) && workflowWanted(root)) {
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    try {
      writeFileSync(join(root, WORKFLOW_FILE), renderWorkflow(version), { flag: "wx" });
      workflow = WORKFLOW_FILE;
    } catch (err) {
      if (errCode(err) !== "EEXIST") throw err;
    }
  }
  return { root, statuses, blocks: applyBlocks(plan), ignoreFiles, workflow };
}

export interface NewOptions {
  slug: string;
  parent?: string;
  kind?: string;
  assignee?: string;
  priority?: string;
  size?: string;
  labels?: string[];
  effort?: string;
  dependsOn?: string[];
  related?: string[];
}

/** Check an assignee typed on the command line: add the @ if missing, then it must be a handle in yardhand.json. */
export function checkAssignee(input: string, config: Config, notes: string[]): string {
  const handle = normalizeHandle(input);
  if (!HANDLE_RE.test(handle)) {
    throw new YardhandError(`--assignee "${input}" must be a handle: @ then lowercase kebab-case, like @claude-opus (no dots or spaces).`);
  }
  if (!config.assignees[handle]) {
    throw new YardhandError(`--assignee ${handle} is not in ${ISSUES_DIR}/${CONFIG_FILE}. Add it under "assignees" first, like "${handle}": "person" or "model".`);
  }
  if (handle !== input.trim()) notes.push(`Assignee normalized: "${input.trim()}" -> ${handle}`);
  return handle;
}

/** Check --labels: each must be defined in yardhand.json. Repeats are dropped. */
export function checkLabels(labels: string[], config: Config): string[] {
  const out = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  for (const l of out) {
    if (!LABEL_RE.test(l)) throw new YardhandError(`--labels: "${l}" must be lowercase kebab-case.`);
    if (!config.labels.includes(l)) {
      throw new YardhandError(`--labels: "${l}" is not in ${ISSUES_DIR}/${CONFIG_FILE}. Add it to "labels" first.`);
    }
  }
  return out;
}

export function checkSize(input: string): string {
  const v = input.trim().toLowerCase();
  if (!(SIZES as readonly string[]).includes(v)) throw new YardhandError(`--size must be one of: ${SIZES.join(", ")}.`);
  return v;
}

export function checkEffort(input: string): string {
  const v = input.trim();
  if (!EFFORT_RE.test(v)) throw new YardhandError(`--effort "${v}" must be one word: lowercase letters, digits and dashes, like high or xhigh.`);
  return v;
}

/** The warning for effort on an issue no model will pick up, or null. */
export function effortWarning(id: string, effort: string, assignee: string, config: Config): string | null {
  if (!effort) return null;
  if (!assignee) return `${id} has effort but no assignee. Effort only matters for a model.`;
  const a = config.assignees[assignee];
  if (a && a.type !== "model") return `${id} has effort but is assigned to a person (${assignee}). Effort only matters for a model.`;
  return null;
}

export interface NewResult {
  id: string;
  path: string;
  kind: Kind;
  priority: string;
  parent: string | null;
  status: string;
  /** Things the tool changed or converted for the caller, to print. */
  notes: string[];
  /** Things that are allowed but probably not intended. */
  warnings: string[];
}

export function newIssue(cwd: string, opts: NewOptions): NewResult {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  const notes: string[] = [];

  // Normalize what was typed, then turn a leading "bug-" into --kind bug.
  let slug = normalizeName(opts.slug);
  if (slug !== opts.slug) notes.push(`Slug normalized: "${opts.slug}" -> ${slug}`);
  let kindOpt = opts.kind === undefined ? undefined : opts.kind.trim().toLowerCase();
  if (kindOpt !== undefined && !(KINDS as readonly string[]).includes(kindOpt)) {
    throw new YardhandError(`--kind must be one of: ${KINDS.join(", ")}.`);
  }
  if (slug.startsWith(BUG_PREFIX)) {
    if (kindOpt !== undefined && kindOpt !== "bug") {
      throw new YardhandError(`The slug starts with "${BUG_PREFIX}" but --kind is ${kindOpt}. Use --kind bug, or drop the prefix.`);
    }
    slug = slug.slice(BUG_PREFIX.length);
    kindOpt = "bug";
    notes.push(`Converted the "${BUG_PREFIX}" prefix to --kind bug.`);
  }
  if (!SLUG_RE.test(slug) || slug.startsWith(BUG_PREFIX)) {
    throw new YardhandError(`Slug "${opts.slug}" must be lowercase kebab-case, for example add-auth.`);
  }
  const assignee = opts.assignee === undefined || opts.assignee.trim() === "" ? "" : checkAssignee(opts.assignee, config, notes);
  const size = opts.size === undefined ? "" : checkSize(opts.size);
  const labels = checkLabels(opts.labels ?? [], config);
  const effort = opts.effort === undefined ? "" : checkEffort(opts.effort);
  if (opts.parent !== undefined && !isValidId(opts.parent)) {
    throw new YardhandError(`"${opts.parent}" is not a valid ID.`);
  }
  const priority = (opts.priority ?? "").trim().toLowerCase();
  if (priority !== "" && !(PRIORITIES as readonly string[]).includes(priority)) {
    throw new YardhandError(`--priority must be one of: ${PRIORITIES.join(", ")}.`);
  }
  const dependsOn = [...new Set(opts.dependsOn ?? [])];
  const related = [...new Set(opts.related ?? [])];
  for (const [flag, list] of [["--depends-on", dependsOn], ["--related", related]] as const) {
    const bad = list.find((x) => !isValidId(x));
    if (bad !== undefined) throw new YardhandError(`${flag}: "${bad}" is not a valid ID.`);
  }

  // Scan, allocate, and create under one lock so concurrent runs cannot share an ID.
  return withLock(root, () => {
    const s = scan(root, config);
    assertComplete(s);
    const ids = allIds(s);
    let id: string;
    if (opts.parent) {
      if (!ids.includes(opts.parent)) throw new YardhandError(`Parent ${opts.parent} does not exist.`);
      id = nextChild(opts.parent, ids);
    } else {
      id = nextTopLevel(ids);
    }
    for (const [flag, list] of [["--depends-on", dependsOn], ["--related", related]] as const) {
      const missing = list.find((x) => !ids.includes(x));
      if (missing !== undefined) throw new YardhandError(`${flag}: issue ${missing} does not exist.`);
    }
    const kind = (kindOpt ?? defaultKind(id)) as Kind;
    const status = config.statuses[0] as string;
    const statusDir = join(root, ISSUES_DIR, status);
    mkdirSync(statusDir, { recursive: true });
    const dir = join(statusDir, folderName(id, slug, kind === "bug"));
    if (existsSync(dir)) throw new YardhandError(`${rel(root, dir)} already exists.`);
    // Build the folder under a temporary name, then rename it into place, so a failed write
    // can never leave a half-made issue behind.
    const staging = join(statusDir, `.new-${randomBytes(6).toString("hex")}.tmp`);
    try {
      mkdirSync(staging);
      writeFileSync(
        join(staging, ISSUE_FILE),
        renderIssue({
          id,
          kind,
          parent: opts.parent ?? null,
          status,
          assignee,
          title: titleFromSlug(slug),
          priority,
          size,
          labels,
          effort,
          dependsOn,
          related,
        }),
        { flag: "wx" },
      );
      renameSync(staging, dir);
    } catch (err) {
      rmSync(staging, { recursive: true, force: true });
      throw err;
    }
    const file = join(dir, ISSUE_FILE);
    const warn = effortWarning(id, effort, assignee, config);
    return { id, path: rel(root, file), kind, priority, parent: opts.parent ?? null, status, notes, warnings: warn ? [warn] : [] };
  });
}

export interface MoveResult {
  from: string;
  to: string;
  status: string;
  /** True when the issue was already in that status and nothing changed. */
  unchanged: boolean;
  /** Direct children (by `parent:`) that were not moved. */
  children: string[];
  notes: string[];
}

export function moveIssue(cwd: string, id: string, statusInput: string): MoveResult {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  const status = normalizeName(statusInput);
  const notes: string[] = [];
  if (!config.statuses.includes(status)) {
    throw new YardhandError(`Unknown status "${statusInput}". Statuses: ${config.statuses.join(", ")}.`);
  }
  if (status !== statusInput) notes.push(`Status normalized: "${statusInput}" -> ${status}`);
  if (!isValidId(id)) throw new YardhandError(`"${id}" is not a valid ID.`);

  return withLock(root, () => {
    const s = scan(root, config);
    assertComplete(s);
    const matches = s.issues.filter((i) => i.id === id);
    if (matches.length === 0) throw new YardhandError(`Issue ${id} not found.`);
    if (matches.length > 1) {
      throw new YardhandError(`Issue ${id} exists in more than one place; run ${TOOL} validate and fix the duplicate first.`);
    }
    const issue = matches[0]!;
    const children = readIssues(root, s)
      .filter((i) => i.id && parentField(i) === id)
      .map((i) => i.id as string)
      .sort();
    if (issue.status === status) {
      return { from: rel(root, issue.dir), to: rel(root, issue.dir), status, unchanged: true, children: [], notes };
    }
    const statusDir = join(root, ISSUES_DIR, status);
    const dest = join(statusDir, issue.folder);
    if (existsSync(dest)) throw new YardhandError(`${rel(root, dest)} already exists.`);

    // Everything that can fail on content happens before anything moves.
    const file = join(issue.dir, ISSUE_FILE);
    let text: string;
    try {
      if (lstatSync(file).isSymbolicLink()) {
        throw new YardhandError(`${rel(root, file)} is a symlink. ${TOOL} does not follow symlinks.`);
      }
      text = readFileSync(file, "utf8");
    } catch (err) {
      if (err instanceof YardhandError) throw err;
      throw new YardhandError(`Cannot read ${rel(root, file)} (${errCode(err)}).`);
    }
    const updated = setField(text, "status", status);
    commitIssue(root, issue, updated, {
      destDir: dest,
      what: "the new status",
      stateHint: `Move it back by hand, or fix the field (it should say ${status}).`,
    });
    return { from: rel(root, issue.dir), to: rel(root, dest), status, unchanged: false, children, notes };
  });
}

export interface Problem {
  path: string;
  /** Short name of the rule that failed, for `validate --json`. */
  rule: string;
  message: string;
}

export interface CheckResult {
  errors: Problem[];
  warnings: Problem[];
}

/** Slug length that triggers a warning (not counting a `bug-` prefix). */
export const SOFT_SLUG_LIMIT = 40;

/** Errors and warnings for the whole issues/ tree. */
export function check(cwd: string): CheckResult {
  const result: CheckResult = { errors: [], warnings: [] };
  try {
    collect(findRoot(cwd), result);
  } catch (err) {
    // Root discovery and filesystem surprises are findings too, and must not discard what was
    // already found.
    result.errors.push({
      path: ISSUES_DIR,
      rule: "root",
      message:
        err instanceof YardhandError
          ? err.message
          : `Could not finish checking (${errCode(err)}${err instanceof Error ? `: ${err.message}` : ""}).`,
    });
  }
  return result;
}

/** Errors only, for callers that do not care about warnings. */
export function validate(cwd: string): Problem[] {
  return check(cwd).errors;
}

function collect(root: string, result: CheckResult): void {
  const out = result.errors;
  const bad = (path: string, rule: string, message: string) => out.push({ path, rule, message });
  let config: Config;
  try {
    config = loadConfig(root);
  } catch (err) {
    bad(
      `${ISSUES_DIR}/${CONFIG_FILE}`,
      "config",
      err instanceof YardhandError ? err.message : `${CONFIG_FILE} cannot be read (${errCode(err)}).`,
    );
    return;
  }
  const s = scan(root, config);

  for (const d of s.unknownDirs) bad(`${ISSUES_DIR}/${d}`, "unknown-folder", `Folder is not a status in ${CONFIG_FILE}.`);
  for (const f of s.strayFiles) bad(`${ISSUES_DIR}/${f}`, "unknown-file", `Unexpected file. ${ISSUES_DIR}/ holds only ${CONFIG_FILE}, ${ROADMAP_FILE}, status folders and ${RELEASES_DIR}/.`);
  for (const st of s.missingStatuses) bad(`${ISSUES_DIR}/${st}`, "status-folder", "Status folder is missing.");
  for (const st of s.badStatusPaths) bad(`${ISSUES_DIR}/${st}`, "status-folder", "Status path is not a readable folder.");
  for (const link of s.symlinks) bad(`${ISSUES_DIR}/${link}`, "symlink", "Symlinks are not supported.");
  for (const u of s.unreadable) bad(`${ISSUES_DIR}/${u}`, "unreadable", "Cannot be inspected (permissions or I/O error).");

  interface Known {
    id: string;
    depth: number;
    path: string;
  }
  const byId = new Map<string, Known[]>();
  const withFields: { known: Known; fields: Record<string, string> }[] = [];
  // Folders with no recognizable ID: they still get the checks that do not need the folder ID.
  const idless: { path: string; fields: Record<string, string> }[] = [];

  for (const issue of s.issues) {
    const path = rel(root, issue.dir);
    const { bug: hasBugPrefix, slug } = splitPrefix(issue.id ? issue.folder.slice(issue.id.length + 1) : issue.folder);
    if (!issue.id) {
      bad(path, "folder-name", "Folder name must start with a valid ID, then a hyphen, then a slug.");
    } else if (!parseFolderName(issue.folder)) {
      // A bad slug is reported, but the issue still takes part in every other check.
      if (hasBugPrefix && slug.startsWith(BUG_PREFIX)) {
        bad(path, "reserved-prefix", `"${BUG_PREFIX}" is reserved: it may appear only once, right after the ID.`);
      } else {
        bad(path, "folder-name", "Folder name must be <id>-<slug> with a lowercase kebab-case slug.");
      }
    } else if (slug.length > SOFT_SLUG_LIMIT) {
      result.warnings.push({
        path,
        rule: "slug-length",
        message: `Slug is ${slug.length} characters; the soft limit is ${SOFT_SLUG_LIMIT}.`,
      });
    }
    const known: Known | null = issue.id ? { id: issue.id, depth: depth(issue.id), path } : null;
    if (known) byId.set(known.id, [...(byId.get(known.id) ?? []), known]);

    // A move that was interrupted between its two renames leaves a temp file behind.
    try {
      for (const name of readdirSync(issue.dir)) {
        if (TMP_RE.test(name)) {
          bad(
            `${path}/${name}`,
            "temp-file",
            `Leftover temp file from an interrupted change. The ${ISSUE_FILE} fields may not match the folder: check ${ISSUE_FILE}, then delete the temp file (or rename it over ${ISSUE_FILE} to finish the change).`,
          );
        }
      }
    } catch {
      // Unreadable folders are reported by the scan.
    }

    const file = join(issue.dir, ISSUE_FILE);
    const here = rel(root, file);
    let text: string;
    try {
      // A symlinked ISSUE.md is already reported by the scan; do not read through it.
      if (lstatSync(file).isSymbolicLink()) continue;
      text = readFileSync(file, "utf8");
    } catch (err) {
      bad(
        path,
        "issue-file",
        errCode(err) === "ENOENT" ? `${ISSUE_FILE} is missing.` : `${ISSUE_FILE} cannot be read (${errCode(err)}).`,
      );
      continue;
    }
    const fm = parseFrontMatter(text);
    if (!fm) {
      bad(here, "front-matter", "Front matter is missing or malformed.");
      continue;
    }
    const f = fm.fields;
    if (known) withFields.push({ known, fields: f });
    else idless.push({ path, fields: f });

    for (const key of fm.duplicates) bad(here, "duplicate-key", `Field "${key}" appears more than once.`);
    if (issue.id && f["id"] !== issue.id) {
      bad(here, "id", `id "${f["id"] ?? ""}" does not match the folder ID ${issue.id}.`);
    }
    if (f["status"] !== issue.status) {
      bad(here, "status", `status "${f["status"] ?? ""}" does not match its folder (${issue.status}).`);
    }
    const kind = f["kind"];
    if (!(KINDS as readonly string[]).includes(kind ?? "")) {
      bad(here, "kind", `kind must be ${KINDS.map((k) => `"${k}"`).join(", ").replace(/, ("bug")$/, " or $1")}.`);
    } else if (issue.id && parseFolderName(issue.folder)) {
      // The bug- prefix and kind: bug must agree (front matter is the source of truth).
      if (kind === "bug" && !hasBugPrefix) {
        bad(here, "bug-prefix", `kind is bug but the folder name has no "${BUG_PREFIX}" prefix. Run "${TOOL} set ${issue.id} --kind bug" to fix it.`);
      } else if (kind !== "bug" && hasBugPrefix) {
        bad(here, "bug-prefix", `The folder name has the "${BUG_PREFIX}" prefix but kind is ${kind}. Run "${TOOL} set ${issue.id} --kind ${kind}" to fix it.`);
      }
    }
    const assignee = f["assignee"] ?? "";
    if (assignee) {
      if (!HANDLE_RE.test(assignee)) {
        bad(here, "assignee", `assignee "${assignee}" must be a handle: @ then lowercase kebab-case, like "@claude-opus".`);
      } else if (!config.assignees[assignee]) {
        bad(here, "assignee", `assignee ${assignee} is not listed under "assignees" in ${ISSUES_DIR}/${CONFIG_FILE}. Add it there, or fix the spelling.`);
      } else if (!/^(["']).*\1$/.test(fm.raw["assignee"] ?? "")) {
        bad(here, "assignee", `assignee must be in quotes, like assignee: "${assignee}" (YAML cannot start a value with @).`);
      }
    }
    const size = f["size"] ?? "";
    if (size && !(SIZES as readonly string[]).includes(size)) {
      bad(here, "size", `size "${size}" must be one of: ${SIZES.join(", ")} (or empty).`);
    }
    const labels = splitList(f["labels"] ?? "");
    const rawLabels = (f["labels"] ?? "").replace(/^\[|\]$/g, "").split(",").map((l) => l.trim()).filter(Boolean);
    if (rawLabels.length !== labels.length) bad(here, "labels", "labels lists the same label more than once.");
    for (const l of labels) {
      if (!LABEL_RE.test(l)) bad(here, "labels", `label "${l}" must be lowercase kebab-case.`);
      else if (!config.labels.includes(l)) bad(here, "labels", `label "${l}" is not listed under "labels" in ${ISSUES_DIR}/${CONFIG_FILE}. Add it there, or fix the spelling.`);
    }
    const effort = f["effort"] ?? "";
    if (effort && !EFFORT_RE.test(effort)) {
      bad(here, "effort", `effort "${effort}" must be one word: lowercase letters, digits and dashes, like high.`);
    } else if (issue.id) {
      const w = effortWarning(issue.id, effort, HANDLE_RE.test(assignee) ? assignee : "", config);
      if (w) result.warnings.push({ path: here, rule: "effort-no-model", message: w });
    }
    if (issue.status === DONE_STATUS) {
      const open = uncheckedCriteria(text);
      if (open > 0) {
        result.warnings.push({
          path: here,
          rule: "unchecked-criteria",
          message: `${issue.id ?? path} is done but has ${open} unchecked acceptance ${open === 1 ? "criterion" : "criteria"}.`,
        });
      }
    }
    if (f["released-in"] && !SEMVER_RE.test(f["released-in"])) {
      bad(here, "released-in", `released-in "${f["released-in"]}" is not valid semver.`);
    }
    if (f["priority"] && !(PRIORITIES as readonly string[]).includes(f["priority"])) {
      bad(here, "priority", `priority "${f["priority"]}" must be one of: ${PRIORITIES.join(", ")} (or empty).`);
    }
  }

  for (const [id, list] of byId) {
    if (list.length > 1) {
      bad(list.map((k) => k.path).join(", "), "duplicate-id", `ID ${id} is used more than once.`);
    }
  }

  // Folders with no valid ID: report what can be checked without it.
  for (const { path, fields } of idless) {
    const here = `${path}/${ISSUE_FILE}`;
    if (fields["id"] === undefined || fields["id"] === "") {
      bad(here, "id", "id is required.");
    } else if (!isValidId(fields["id"])) {
      bad(here, "id", `id "${fields["id"]}" is not a valid ID.`);
    }
    const parent = fields["parent"];
    if (parent && (!isValidId(parent) || !byId.has(parent))) bad(here, "parent", `parent ${parent} does not exist.`);
  }

  // Parent checks need the full ID set.
  for (const { known, fields } of withFields) {
    const here = `${known.path}/${ISSUE_FILE}`;
    const parent = fields["parent"];
    if (known.depth === 1) {
      if (parent !== undefined) bad(here, "parent", "A level-1 issue must omit the parent field.");
      continue;
    }
    if (!parent) {
      bad(here, "parent", `parent is required (expected ${parentOf(known.id)} unless the work moved).`);
      continue;
    }
    if (!isValidId(parent) || !byId.has(parent)) {
      bad(here, "parent", `parent ${parent} does not exist.`);
    } else if (depth(parent) >= known.depth) {
      bad(here, "parent", `parent ${parent} must be at a shallower level than ${known.id}.`);
    }
  }

  // Size warnings: size belongs on issues with no children, and a large open issue may need splitting.
  const parents = new Set(withFields.map((w) => w.fields["parent"]).filter((p): p is string => !!p));
  for (const { known, fields } of withFields) {
    const here = `${known.path}/${ISSUE_FILE}`;
    const size = fields["size"];
    if (!size) continue;
    if (parents.has(known.id)) {
      result.warnings.push({ path: here, rule: "size-on-parent", message: `${known.id} has children, so leave size blank. Its size is its children's.` });
    } else if (size === "large") {
      const status = fields["status"];
      if (status !== DONE_STATUS && status !== "canceled") {
        result.warnings.push({ path: here, rule: "size-large", message: `${known.id} is large: consider splitting it.` });
      }
    }
  }

  // Link checks: depends-on and related must name existing issues other than the issue itself.
  const dependsGraph = new Map<string, string[]>();
  for (const { known, fields } of withFields) {
    const here = `${known.path}/${ISSUE_FILE}`;
    for (const key of ["depends-on", "related"] as const) {
      const ids = splitIdList(fields[key] ?? "");
      for (const target of ids) {
        if (!isValidId(target)) {
          bad(here, key, `${key} "${target}" is not a valid ID.`);
        } else if (!byId.has(target)) {
          bad(here, key, `${key} ${target} does not exist.`);
        } else if (target === known.id) {
          bad(here, key, `${key} must not list the issue itself (${target}).`);
        }
      }
      if (key === "depends-on") {
        dependsGraph.set(known.id, ids.filter((t) => t !== known.id && byId.has(t)));
      }
    }
  }

  // A depends-on loop (A needs B, B needs A) can never be finished. Report each loop once.
  const state = new Map<string, 1 | 2>(); // 1 = on the current path, 2 = done
  const pathOf = (id: string) => byId.get(id)?.[0]?.path ?? id;
  const walk = (id: string, trail: string[]): void => {
    state.set(id, 1);
    for (const next of dependsGraph.get(id) ?? []) {
      const st = state.get(next);
      if (st === 1) {
        const loop = [...trail.slice(trail.indexOf(next)), next];
        bad(`${pathOf(next)}/${ISSUE_FILE}`, "depends-on-loop", `depends-on loop: ${loop.join(" -> ")}.`);
      } else if (st === undefined) {
        walk(next, [...trail, next]);
      }
    }
    state.set(id, 2);
  };
  for (const id of dependsGraph.keys()) {
    if (!state.has(id)) walk(id, [id]);
  }

  // Warning: a generated roadmap that no longer matches the issues. No warning when there is no file.
  const roadmapFile = join(root, ISSUES_DIR, ROADMAP_FILE);
  try {
    if (existsSync(roadmapFile) && !lstatSync(roadmapFile).isSymbolicLink()) {
      if (readFileSync(roadmapFile, "utf8") !== buildRoadmap(readIssues(root, s))) {
        result.warnings.push({
          path: `${ISSUES_DIR}/${ROADMAP_FILE}`,
          rule: "roadmap-stale",
          message: `${ROADMAP_FILE} is out of date, run ${TOOL} roadmap.`,
        });
      }
    }
  } catch {
    // An unreadable roadmap is not worth failing validation over.
  }

  result.warnings.push(...shipRisks(root));
}

const readText = (path: string): string | null => {
  try {
    return lstatSync(path).isFile() ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
};

/** Warnings when issues/ could end up in a published npm package or a Docker image. Repo-root files only. */
export function shipRisks(root: string): Problem[] {
  const out: Problem[] = [];
  const pkgText = readText(join(root, "package.json"));
  if (pkgText !== null) {
    let files: unknown;
    try {
      files = (JSON.parse(pkgText) as { files?: unknown } | null)?.files;
    } catch {
      files = undefined;
    }
    if (Array.isArray(files)) {
      if (files.some((f) => typeof f === "string" && /^\/?issues(?:\/(?:\*\*?)?)?$/.test(f.trim()))) {
        out.push({ path: "package.json", rule: "ship-npm", message: `package.json "files" includes ${ISSUES_DIR}/. Remove it so issues are never published.` });
      }
    } else {
      const npmignore = readText(join(root, ".npmignore"));
      if (npmignore === null || !ignoresIssues(npmignore)) {
        out.push({
          path: "package.json",
          rule: "ship-npm",
          message: `${ISSUES_DIR}/ could be published by npm. Add "files" to package.json or ${ISSUES_DIR}/ to .npmignore.`,
        });
      }
    }
  }
  if (readText(join(root, "Dockerfile")) !== null) {
    const dockerignore = readText(join(root, ".dockerignore"));
    if (dockerignore === null || !ignoresIssues(dockerignore)) {
      out.push({
        path: "Dockerfile",
        rule: "ship-docker",
        message: `${ISSUES_DIR}/ could be copied into a Docker image. Add ${ISSUES_DIR}/ to .dockerignore.`,
      });
    }
  }
  return out;
}

const DONE_STATUS = "done";

/** Unchecked boxes with text (`- [ ] something`) under the `## Acceptance criteria` heading, up to the next heading of level 2 or above. */
export function uncheckedCriteria(text: string): number {
  const lines = text.split(/\r?\n/);
  let inside = false;
  let fence = false;
  let count = 0;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    if (/^#{1,2}\s/.test(line)) {
      inside = /^##\s+Acceptance criteria\s*$/i.test(line);
      continue;
    }
    // An empty box (the template's placeholder) is not a criterion yet, so it does not count.
    if (inside && /^\s*[-*+]\s+\[ \]\s+\S/.test(line)) count++;
  }
  return count;
}
