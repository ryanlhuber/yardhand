import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { LoloError } from "./errors.js";
import { CONFIG_FILE, ISSUES_DIR, ISSUE_FILE, TOOL } from "./names.js";
import {
  type Config,
  findRoot,
  loadConfig,
  statusProblems,
} from "./config.js";
import { allIds, scan } from "./scan.js";
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
    const where = relative(resolve(cwd), existing);
    throw new LoloError(
      `Already initialized${where ? ` at ${where}` : ""} (${ISSUES_DIR}/${CONFIG_FILE} exists). Use --force to overwrite the config.`,
    );
  }
  const root = existing ?? resolve(cwd);

  const config: Config = { statuses };
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
  const assignee = (opts.assignee ?? "").trim();
  if (/[\r\n#]/.test(assignee)) {
    throw new LoloError("--assignee must be one line and must not contain #.");
  }
  if (opts.parent !== undefined && !isValidId(opts.parent)) {
    throw new LoloError(`"${opts.parent}" is not a valid ID.`);
  }

  // Scan, allocate, and create under one lock so concurrent runs cannot share an ID.
  return withLock(root, () => {
    const ids = allIds(scan(root, config));
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
      if (errCode(err) === "EEXIST") throw new LoloError(`${relative(root, dir)} already exists.`);
      throw err;
    }
    const file = join(dir, ISSUE_FILE);
    writeFileSync(
      file,
      renderIssue({ id, kind, parent: opts.parent ?? null, status, assignee }),
      { flag: "wx" },
    );
    return { id, path: relative(root, file) };
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
    const matches = scan(root, config).issues.filter((i) => i.id === id);
    if (matches.length === 0) throw new LoloError(`Issue ${id} not found.`);
    if (matches.length > 1) {
      throw new LoloError(`Issue ${id} exists in more than one place; run ${TOOL} validate and fix the duplicate first.`);
    }
    const issue = matches[0]!;
    if (issue.status === status) throw new LoloError(`Issue ${id} is already in ${status}.`);
    const statusDir = join(root, ISSUES_DIR, status);
    const dest = join(statusDir, issue.folder);
    if (existsSync(dest)) throw new LoloError(`${relative(root, dest)} already exists.`);

    // Everything that can fail on content happens before anything moves.
    const file = join(issue.dir, ISSUE_FILE);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (err) {
      throw new LoloError(`Cannot read ${relative(root, file)} (${errCode(err)}).`);
    }
    const updated = setField(text, "status", status);

    // Move first, then rewrite status. If the rewrite fails, move the folder back, so the
    // folder and the status field are never left disagreeing.
    mkdirSync(statusDir, { recursive: true });
    renameSync(issue.dir, dest);
    try {
      writeFileSync(join(dest, ISSUE_FILE), updated);
    } catch (err) {
      try {
        renameSync(dest, issue.dir);
      } catch {
        throw new LoloError(
          `Moved ${relative(root, issue.dir)} to ${relative(root, dest)} but could not update its status field (${errCode(err)}), and could not move it back. Fix it by hand.`,
        );
      }
      throw new LoloError(`Could not update ${ISSUE_FILE} (${errCode(err)}). Nothing was moved.`);
    }
    return { from: relative(root, issue.dir), to: relative(root, dest) };
  });
}

export interface Problem {
  path: string;
  message: string;
}

export function validate(cwd: string): Problem[] {
  const root = findRoot(cwd);
  let config: Config;
  try {
    config = loadConfig(root);
  } catch (err) {
    if (err instanceof LoloError) {
      return [{ path: `${ISSUES_DIR}/${CONFIG_FILE}`, message: err.message }];
    }
    throw err;
  }
  const s = scan(root, config);
  const out: Problem[] = [];
  const rel = (p: string) => relative(root, p);

  for (const d of s.unknownDirs) {
    out.push({ path: `${ISSUES_DIR}/${d}`, message: `Folder is not a status in ${CONFIG_FILE}.` });
  }
  for (const st of s.missingStatuses) {
    out.push({ path: `${ISSUES_DIR}/${st}`, message: "Status folder is missing." });
  }
  for (const st of s.badStatusPaths) {
    out.push({ path: `${ISSUES_DIR}/${st}`, message: "Status path is not a readable folder." });
  }

  interface Known {
    id: string;
    depth: number;
    path: string;
  }
  const byId = new Map<string, Known[]>();
  const withFields: { known: Known; fields: Record<string, string> }[] = [];

  for (const issue of s.issues) {
    const path = rel(issue.dir);
    if (!issue.id) {
      out.push({ path, message: "Folder name must start with a valid ID, then a hyphen, then a slug." });
      continue;
    }
    // A bad slug is reported, but the issue still takes part in every other check.
    if (!parseFolderName(issue.folder)) {
      out.push({ path, message: "Folder name must be <id>-<slug> with a lowercase kebab-case slug." });
    }
    const known: Known = { id: issue.id, depth: depth(issue.id), path };
    byId.set(issue.id, [...(byId.get(issue.id) ?? []), known]);

    const file = join(issue.dir, ISSUE_FILE);
    const here = rel(file);
    let text: string;
    try {
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
    withFields.push({ known, fields: f });

    for (const key of fm.duplicates) {
      out.push({ path: here, message: `Field "${key}" appears more than once.` });
    }
    if (f["id"] !== issue.id) {
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

  return out;
}
