import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { LoloError } from "./errors.js";
import { CONFIG_FILE, ISSUES_DIR, ISSUE_FILE, TOOL } from "./names.js";
import {
  type Config,
  findRoot,
  loadConfig,
  statusProblems,
} from "./config.js";
import { allIds, assertComplete, rel, scan } from "./scan.js";
import {
  SEMVER_RE,
  SLUG_RE,
  depth,
  folderName,
  isValidId,
  nextChild,
  nextTopLevel,
  parentOf,
  parseFolderName,
} from "./ids.js";
import { parseFrontMatter, setField } from "./frontmatter.js";
import { renderIssue } from "./template.js";
import { applyBlocks, planBlocks, renderBlock } from "./block.js";
import { withLock } from "./lock.js";

const errCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? "error";
const TMP_FILE = `.${ISSUE_FILE}.tmp`;

/** Cleanup must never hide the error that caused it. */
function tryRemove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignored on purpose
  }
}
// Control characters, Unicode line/paragraph separators, and "#" could change how the file parses.
const UNSAFE_ASSIGNEE = new RegExp("[\\u0000-\\u001f\\u007f\\u2028\\u2029#]");

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
  if (problems.length) throw new LoloError(problems.join(" "));

  // Like every other command, init works from the existing root when there is one.
  let existing: string | null = null;
  try {
    existing = findRoot(cwd);
  } catch {
    // Not initialized yet, which is the normal case.
  }
  if (existing && !force) {
    const where = rel(resolve(cwd), existing);
    throw new LoloError(
      `Already initialized${where ? ` at ${where}` : ""} (${ISSUES_DIR}/${CONFIG_FILE} exists). Use --force to overwrite the config.`,
    );
  }
  const root = existing ?? resolve(cwd);
  const config: Config = { statuses };

  // Refuse before changing anything: a config that drops a status holding issues would hide
  // those issues, and their IDs would be handed out again.
  if (existing) {
    const stray = scan(root, config).strayIssues;
    if (stray.length) {
      throw new LoloError(
        `These folders hold issues but are not in the new status list: ${stray.join(", ")}. Add them to --statuses, or move the issues first.`,
      );
    }
  }
  // Plan the AGENTS.md / CLAUDE.md updates first: damaged markers must fail before anything is written.
  const plan = planBlocks(root, renderBlock(config, version));

  mkdirSync(join(root, ISSUES_DIR), { recursive: true });
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
  // 000 is the catch-all parent for maintenance and bugs with no clear home.
  if (!allIds(scan(root, config)).includes("000")) {
    const first = statuses[0] as string;
    const dir = join(root, ISSUES_DIR, first, folderName("000", "maintain-repo"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ISSUE_FILE),
      renderIssue({ id: "000", kind: "task", parent: null, status: first, assignee: "" }),
    );
  }
  return { root, statuses, blocks: applyBlocks(plan) };
}

export interface NewOptions {
  slug: string;
  parent?: string;
  kind?: "task" | "bug";
  assignee?: string;
}

export function newIssue(cwd: string, opts: NewOptions): { id: string; path: string } {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  if (!SLUG_RE.test(opts.slug)) {
    throw new LoloError(`Slug "${opts.slug}" must be lowercase kebab-case, for example add-auth.`);
  }
  const kind = opts.kind ?? "task";
  if (kind !== "task" && kind !== "bug") throw new LoloError('--kind must be "task" or "bug".');
  // Checked on the raw value, before any trimming. Control characters (newlines included),
  // Unicode line and paragraph separators, and "#" could all change how the file parses.
  const assignee = opts.assignee ?? "";
  if (UNSAFE_ASSIGNEE.test(assignee)) {
    throw new LoloError("--assignee must be a single line of text and must not contain # or control characters.");
  }
  if (opts.parent !== undefined && !isValidId(opts.parent)) {
    throw new LoloError(`"${opts.parent}" is not a valid ID.`);
  }

  // Scan, allocate, and create under one lock so concurrent runs cannot share an ID.
  return withLock(root, () => {
    const s = scan(root, config);
    assertComplete(s);
    const ids = allIds(s);
    let id: string;
    if (opts.parent) {
      if (!ids.includes(opts.parent)) throw new LoloError(`Parent ${opts.parent} does not exist.`);
      id = nextChild(opts.parent, ids);
    } else {
      id = nextTopLevel(ids);
    }
    const status = config.statuses[0] as string;
    const statusDir = join(root, ISSUES_DIR, status);
    mkdirSync(statusDir, { recursive: true });
    const dir = join(statusDir, folderName(id, opts.slug));
    try {
      mkdirSync(dir);
    } catch (err) {
      if (errCode(err) === "EEXIST") throw new LoloError(`${rel(root, dir)} already exists.`);
      throw err;
    }
    const file = join(dir, ISSUE_FILE);
    writeFileSync(
      file,
      renderIssue({ id, kind, parent: opts.parent ?? null, status, assignee: assignee.trim() }),
      { flag: "wx" },
    );
    return { id, path: rel(root, file) };
  });
}

export function moveIssue(cwd: string, id: string, status: string): { from: string; to: string } {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  if (!config.statuses.includes(status)) {
    throw new LoloError(`Unknown status "${status}". Statuses: ${config.statuses.join(", ")}.`);
  }
  if (!isValidId(id)) throw new LoloError(`"${id}" is not a valid ID.`);

  return withLock(root, () => {
    const s = scan(root, config);
    assertComplete(s);
    const matches = s.issues.filter((i) => i.id === id);
    if (matches.length === 0) throw new LoloError(`Issue ${id} not found.`);
    if (matches.length > 1) {
      throw new LoloError(`Issue ${id} exists in more than one place; run ${TOOL} validate and fix the duplicate first.`);
    }
    const issue = matches[0]!;
    if (issue.status === status) throw new LoloError(`Issue ${id} is already in ${status}.`);
    const statusDir = join(root, ISSUES_DIR, status);
    const dest = join(statusDir, issue.folder);
    if (existsSync(dest)) throw new LoloError(`${rel(root, dest)} already exists.`);

    // Everything that can fail on content happens before anything moves.
    const file = join(issue.dir, ISSUE_FILE);
    let text: string;
    try {
      if (lstatSync(file).isSymbolicLink()) {
        throw new LoloError(`${rel(root, file)} is a symlink. ${TOOL} does not follow symlinks.`);
      }
      text = readFileSync(file, "utf8");
    } catch (err) {
      if (err instanceof LoloError) throw err;
      throw new LoloError(`Cannot read ${rel(root, file)} (${errCode(err)}).`);
    }
    const updated = setField(text, "status", status);

    // The new status is written to a temp file first, so a failed or partial write can only
    // damage the temp file. Then: move the folder, and rename the temp file over ISSUE.md
    // (an atomic replace). If that last step fails, move the folder back. The original
    // ISSUE.md is untouched until the final rename, so the folder and the status field
    // cannot disagree, short of the move-back itself failing, which is reported.
    const tmp = join(issue.dir, TMP_FILE);
    try {
      writeFileSync(tmp, updated);
    } catch (err) {
      tryRemove(tmp);
      throw new LoloError(`Could not write the new status (${errCode(err)}). Nothing was moved.`);
    }
    try {
      mkdirSync(statusDir, { recursive: true });
      renameSync(issue.dir, dest);
    } catch (err) {
      tryRemove(tmp);
      throw new LoloError(`Could not move ${rel(root, issue.dir)} (${errCode(err)}). Nothing was moved.`);
    }
    try {
      renameSync(join(dest, TMP_FILE), join(dest, ISSUE_FILE));
    } catch (err) {
      try {
        renameSync(dest, issue.dir);
      } catch {
        throw new LoloError(
          `${rel(root, dest)} was moved to ${status} but its status field still says ${issue.status}, and it could not be moved back (${errCode(err)}). Move it back by hand, or fix the field.`,
        );
      }
      tryRemove(join(issue.dir, TMP_FILE));
      throw new LoloError(`Could not update ${ISSUE_FILE} (${errCode(err)}). Nothing was moved.`);
    }
    return { from: rel(root, issue.dir), to: rel(root, dest) };
  });
}

export interface Problem {
  path: string;
  message: string;
}

export function validate(cwd: string): Problem[] {
  const root = findRoot(cwd);
  const out: Problem[] = [];
  try {
    collect(root, out);
  } catch (err) {
    // A filesystem surprise must not discard what was already found.
    out.push({ path: ISSUES_DIR, message: `Could not finish checking (${errCode(err)}${err instanceof Error ? `: ${err.message}` : ""}).` });
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
      message: err instanceof LoloError ? err.message : `${CONFIG_FILE} cannot be read (${errCode(err)}).`,
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

  interface Known {
    id: string;
    depth: number;
    path: string;
  }
  const byId = new Map<string, Known[]>();
  const withFields: { known: Known; fields: Record<string, string> }[] = [];

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

    const file = join(issue.dir, ISSUE_FILE);
    const here = rel(root, file);
    let text: string;
    try {
      if (lstatSync(file).isSymbolicLink()) {
        out.push({ path: here, message: "Symlinks are not supported." });
        continue;
      }
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
  }

  for (const [id, list] of byId) {
    if (list.length > 1) {
      out.push({
        path: list.map((k) => k.path).join(", "),
        message: `ID ${id} is used more than once.`,
      });
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
}
