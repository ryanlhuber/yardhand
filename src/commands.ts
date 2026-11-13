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
  statusProblems,
} from "./config.js";
import { allIds, assertComplete, rel, scan } from "./scan.js";
import {
  BUG_PREFIX,
  KINDS,
  PRIORITIES,
  SEMVER_RE,
  SLUG_RE,
  type Kind,
  defaultKind,
  depth,
  folderName,
  isValidId,
  nextChild,
  nextTopLevel,
  normalizeName,
  parentOf,
  parseFolderName,
  splitIdList,
  splitPrefix,
  UNSAFE_ASSIGNEE,
} from "./ids.js";
import { parseFrontMatter, setField } from "./frontmatter.js";
import { commitIssue, TMP_RE, tryRemove } from "./commit.js";
import { readIssues, parentField } from "./issues.js";
import { buildRoadmap } from "./roadmap.js";
import { RELEASES_DIR, ROADMAP_FILE } from "./names.js";
import { renderIssue } from "./template.js";
import { applyBlocks, planBlocks, renderBlock } from "./block.js";
import { withLock } from "./lock.js";

const errCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? "error";
// Control characters (C0, DEL, and C1), Unicode line/paragraph separators, and "#" could change how the file parses.

export interface InitResult {
  root: string;
  statuses: string[];
  blocks: string[];
}

export function init(
  cwd: string,
  statuses: string[],
  version: string,
  force = false,
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
  const config: Config = { statuses };
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

    writeFileSync(
      join(root, ISSUES_DIR, CONFIG_FILE),
      JSON.stringify(config, null, 2) + "\n",
    );
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
        writeFileSync(
          join(dir, ISSUE_FILE),
          renderIssue({ id: "000", kind: defaultKind("000"), parent: null, status: first, assignee: "" }),
          { flag: "wx" },
        );
      } catch (err) {
        if (errCode(err) !== "EEXIST") throw err;
      }
    }
  });
  return { root, statuses, blocks: applyBlocks(plan) };
}

export interface NewOptions {
  slug: string;
  parent?: string;
  kind?: string;
  assignee?: string;
  priority?: string;
  dependsOn?: string[];
  related?: string[];
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
  // Checked on the raw value, before any trimming. Control characters (newlines included),
  // Unicode line and paragraph separators, and "#" could all change how the file parses.
  const assignee = opts.assignee ?? "";
  if (UNSAFE_ASSIGNEE.test(assignee)) {
    throw new YardhandError("--assignee must be a single line of text and must not contain # or control characters.");
  }
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
          assignee: assignee.trim(),
          priority,
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
    return { id, path: rel(root, file), kind, priority, parent: opts.parent ?? null, status, notes };
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
    if (f["assignee"] && UNSAFE_ASSIGNEE.test(f["assignee"])) {
      bad(here, "assignee", "assignee must be a single line of text and must not contain # or control characters.");
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
}
