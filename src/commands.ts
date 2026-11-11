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
  PRIORITIES,
  SEMVER_RE,
  SLUG_RE,
  depth,
  folderName,
  isValidId,
  nextChild,
  nextTopLevel,
  parentOf,
  parseFolderName,
  splitIdList,
} from "./ids.js";
import { parseFrontMatter, setField } from "./frontmatter.js";
import { renderIssue } from "./template.js";
import { applyBlocks, planBlocks, renderBlock } from "./block.js";
import { withLock } from "./lock.js";

const errCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? "error";
// Temp files for a status rewrite: a random name, created exclusively, so an existing file,
// hard link, or symlink at a guessable path can never be written through.
const tmpName = () => `.${ISSUE_FILE}.${randomBytes(6).toString("hex")}.tmp`;
const TMP_RE = new RegExp(`^\\.${ISSUE_FILE.replace(/\./g, "\\.")}\\..+\\.tmp$`);

/** Cleanup must never hide the error that caused it. */
function tryRemove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignored on purpose
  }
}
// Control characters (C0, DEL, and C1), Unicode line/paragraph separators, and "#" could change how the file parses.
const UNSAFE_ASSIGNEE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029#]");

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
    // 000 is the catch-all parent for maintenance and bugs with no clear home. Created with
    // exclusive operations, so an existing issue can never be overwritten.
    if (!hasCatchAll) {
      const first = statuses[0] as string;
      const dir = join(root, ISSUES_DIR, first, folderName("000", "maintain-repo"));
      try {
        mkdirSync(dir);
        writeFileSync(
          join(dir, ISSUE_FILE),
          renderIssue({ id: "000", kind: "task", parent: null, status: first, assignee: "" }),
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
  kind?: "task" | "bug";
  assignee?: string;
  priority?: string;
  dependsOn?: string[];
  related?: string[];
}

export function newIssue(cwd: string, opts: NewOptions): { id: string; path: string } {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  if (!SLUG_RE.test(opts.slug)) {
    throw new YardhandError(`Slug "${opts.slug}" must be lowercase kebab-case, for example add-auth.`);
  }
  const kind = opts.kind ?? "task";
  if (kind !== "task" && kind !== "bug") throw new YardhandError('--kind must be "task" or "bug".');
  // Checked on the raw value, before any trimming. Control characters (newlines included),
  // Unicode line and paragraph separators, and "#" could all change how the file parses.
  const assignee = opts.assignee ?? "";
  if (UNSAFE_ASSIGNEE.test(assignee)) {
    throw new YardhandError("--assignee must be a single line of text and must not contain # or control characters.");
  }
  if (opts.parent !== undefined && !isValidId(opts.parent)) {
    throw new YardhandError(`"${opts.parent}" is not a valid ID.`);
  }
  const priority = opts.priority ?? "";
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
    const status = config.statuses[0] as string;
    const statusDir = join(root, ISSUES_DIR, status);
    mkdirSync(statusDir, { recursive: true });
    const dir = join(statusDir, folderName(id, opts.slug));
    try {
      mkdirSync(dir);
    } catch (err) {
      if (errCode(err) === "EEXIST") throw new YardhandError(`${rel(root, dir)} already exists.`);
      throw err;
    }
    const file = join(dir, ISSUE_FILE);
    writeFileSync(
      file,
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
    return { id, path: rel(root, file) };
  });
}

export function moveIssue(cwd: string, id: string, status: string): { from: string; to: string } {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  if (!config.statuses.includes(status)) {
    throw new YardhandError(`Unknown status "${status}". Statuses: ${config.statuses.join(", ")}.`);
  }
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
    if (issue.status === status) throw new YardhandError(`Issue ${id} is already in ${status}.`);
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

    // The new status is written to a temp file first, so a failed or partial write can only
    // damage the temp file. Then: move the folder, and rename the temp file over ISSUE.md
    // (an atomic replace). If that last step fails, move the folder back. The original
    // ISSUE.md is untouched until the final rename, so the folder and the status field
    // cannot disagree, short of the move-back itself failing, which is reported. A crash
    // between the two renames leaves a mismatch and a temp file, both of which validate reports.
    const name = tmpName();
    const tmp = join(issue.dir, name);
    try {
      writeFileSync(tmp, updated, { flag: "wx" });
    } catch (err) {
      tryRemove(tmp);
      throw new YardhandError(`Could not write the new status (${errCode(err)}). Nothing was moved.`);
    }
    try {
      mkdirSync(statusDir, { recursive: true });
      renameSync(issue.dir, dest);
    } catch (err) {
      tryRemove(tmp);
      throw new YardhandError(`Could not move ${rel(root, issue.dir)} (${errCode(err)}). Nothing was moved.`);
    }
    try {
      renameSync(join(dest, name), join(dest, ISSUE_FILE));
    } catch (err) {
      try {
        renameSync(dest, issue.dir);
      } catch {
        throw new YardhandError(
          `${rel(root, dest)} was moved to ${status} but its status field still says ${issue.status}, and it could not be moved back (${errCode(err)}). Move it back by hand, or fix the field.`,
        );
      }
      tryRemove(join(issue.dir, name));
      throw new YardhandError(`Could not update ${ISSUE_FILE} (${errCode(err)}). Nothing was moved.`);
    }
    return { from: rel(root, issue.dir), to: rel(root, dest) };
  });
}

export interface Problem {
  path: string;
  message: string;
}

export function validate(cwd: string): Problem[] {
  const out: Problem[] = [];
  try {
    collect(findRoot(cwd), out);
  } catch (err) {
    // Root discovery and filesystem surprises are findings too, and must not discard what was
    // already found.
    out.push({
      path: ISSUES_DIR,
      message:
        err instanceof YardhandError
          ? err.message
          : `Could not finish checking (${errCode(err)}${err instanceof Error ? `: ${err.message}` : ""}).`,
    });
  }
  return out;
}

function collect(root: string, out: Problem[]): void {
  let config: Config;
  try {
    config = loadConfig(root);
  } catch (err) {
    out.push({
      path: `${ISSUES_DIR}/${CONFIG_FILE}`,
      message: err instanceof YardhandError ? err.message : `${CONFIG_FILE} cannot be read (${errCode(err)}).`,
    });
    return;
  }
  const s = scan(root, config);

  for (const d of s.unknownDirs) {
    out.push({ path: `${ISSUES_DIR}/${d}`, message: `Folder is not a status in ${CONFIG_FILE}.` });
  }
  for (const st of s.missingStatuses) {
    out.push({ path: `${ISSUES_DIR}/${st}`, message: "Status folder is missing." });
  }
  for (const st of s.badStatusPaths) {
    out.push({ path: `${ISSUES_DIR}/${st}`, message: "Status path is not a readable folder." });
  }
  for (const link of s.symlinks) {
    out.push({ path: `${ISSUES_DIR}/${link}`, message: "Symlinks are not supported." });
  }
  for (const u of s.unreadable) {
    out.push({ path: `${ISSUES_DIR}/${u}`, message: "Cannot be inspected (permissions or I/O error)." });
  }

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
    if (!issue.id) {
      out.push({ path, message: "Folder name must start with a valid ID, then a hyphen, then a slug." });
    } else if (!parseFolderName(issue.folder)) {
      // A bad slug is reported, but the issue still takes part in every other check.
      out.push({ path, message: "Folder name must be <id>-<slug> with a lowercase kebab-case slug." });
    }
    const known: Known | null = issue.id
      ? { id: issue.id, depth: depth(issue.id), path }
      : null;
    if (known) byId.set(known.id, [...(byId.get(known.id) ?? []), known]);

    // A move that was interrupted between its two renames leaves a temp file behind.
    try {
      for (const name of readdirSync(issue.dir)) {
        if (TMP_RE.test(name)) {
          out.push({
            path: `${path}/${name}`,
            message: `Leftover temp file from an interrupted move. The status field may not match the folder: check ${ISSUE_FILE}, then delete the temp file (or rename it over ${ISSUE_FILE} to finish the move).`,
          });
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
      out.push({
        path,
        message: errCode(err) === "ENOENT" ? `${ISSUE_FILE} is missing.` : `${ISSUE_FILE} cannot be read (${errCode(err)}).`,
      });
      continue;
    }
    const fm = parseFrontMatter(text);
    if (!fm) {
      out.push({ path: here, message: "Front matter is missing or malformed." });
      continue;
    }
    const f = fm.fields;
    if (known) withFields.push({ known, fields: f });
    else idless.push({ path, fields: f });

    for (const key of fm.duplicates) {
      out.push({ path: here, message: `Field "${key}" appears more than once.` });
    }
    if (issue.id && f["id"] !== issue.id) {
      out.push({ path: here, message: `id "${f["id"] ?? ""}" does not match the folder ID ${issue.id}.` });
    }
    if (f["status"] !== issue.status) {
      out.push({
        path: here,
        message: `status "${f["status"] ?? ""}" does not match its folder (${issue.status}).`,
      });
    }
    if (f["kind"] !== "task" && f["kind"] !== "bug") {
      out.push({ path: here, message: 'kind must be "task" or "bug".' });
    }
    if (f["released-in"] && !SEMVER_RE.test(f["released-in"])) {
      out.push({ path: here, message: `released-in "${f["released-in"]}" is not valid semver.` });
    }
    if (f["priority"] && !(PRIORITIES as readonly string[]).includes(f["priority"])) {
      out.push({ path: here, message: `priority "${f["priority"]}" must be one of: ${PRIORITIES.join(", ")} (or empty).` });
    }
  }

  for (const [id, list] of byId) {
    if (list.length > 1) {
      out.push({
        path: list.map((k) => k.path).join(", "),
        message: `ID ${id} is used more than once.`,
      });
    }
  }

  // Folders with no valid ID: report what can be checked without it.
  for (const { path, fields } of idless) {
    const here = `${path}/${ISSUE_FILE}`;
    if (fields["id"] === undefined || fields["id"] === "") {
      out.push({ path: here, message: "id is required." });
    } else if (!isValidId(fields["id"])) {
      out.push({ path: here, message: `id "${fields["id"]}" is not a valid ID.` });
    }
    const parent = fields["parent"];
    if (parent && (!isValidId(parent) || !byId.has(parent))) {
      out.push({ path: here, message: `parent ${parent} does not exist.` });
    }
  }

  // Parent checks need the full ID set.
  for (const { known, fields } of withFields) {
    const here = `${known.path}/${ISSUE_FILE}`;
    const parent = fields["parent"];
    if (known.depth === 1) {
      if (parent !== undefined) {
        out.push({ path: here, message: "A level-1 issue must omit the parent field." });
      }
      continue;
    }
    if (!parent) {
      out.push({
        path: here,
        message: `parent is required (expected ${parentOf(known.id)} unless the work moved).`,
      });
      continue;
    }
    if (!isValidId(parent) || !byId.has(parent)) {
      out.push({ path: here, message: `parent ${parent} does not exist.` });
    } else if (depth(parent) >= known.depth) {
      out.push({ path: here, message: `parent ${parent} must be at a shallower level than ${known.id}.` });
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
          out.push({ path: here, message: `${key} "${target}" is not a valid ID.` });
        } else if (!byId.has(target)) {
          out.push({ path: here, message: `${key} ${target} does not exist.` });
        } else if (target === known.id) {
          out.push({ path: here, message: `${key} must not list the issue itself (${target}).` });
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
        out.push({
          path: `${pathOf(next)}/${ISSUE_FILE}`,
          message: `depends-on loop: ${loop.join(" -> ")}.`,
        });
      } else if (st === undefined) {
        walk(next, [...trail, next]);
      }
    }
    state.set(id, 2);
  };
  for (const id of dependsGraph.keys()) {
    if (!state.has(id)) walk(id, [id]);
  }
}
