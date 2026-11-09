import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { LoloError } from "./errors.js";
import {
  CONFIG_FILE,
  ISSUES_DIR,
  ISSUE_FILE,
} from "./names.js";
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
import { renderBlock, writeBlocks } from "./block.js";

export interface InitResult {
  root: string;
  statuses: string[];
  blocks: string[];
}

export function init(
  root: string,
  statuses: string[],
  version: string,
  force = false,
): InitResult {
  const problems = statusProblems(statuses);
  if (problems.length) throw new LoloError(problems.join(" "));
  const configPath = join(root, ISSUES_DIR, CONFIG_FILE);
  if (existsSync(configPath) && !force) {
    throw new LoloError(`${ISSUES_DIR}/${CONFIG_FILE} already exists. Use --force to overwrite it.`);
  }
  const config: Config = { statuses };
  mkdirSync(join(root, ISSUES_DIR), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  for (const status of statuses) {
    const dir = join(root, ISSUES_DIR, status);
    mkdirSync(dir, { recursive: true });
    const keep = join(dir, ".gitkeep");
    if (!existsSync(keep)) writeFileSync(keep, "");
  }
  // 000 is the catch-all parent for maintenance and bugs with no clear home.
  const s = scan(root, config);
  if (!allIds(s).includes("000")) {
    const dir = join(root, ISSUES_DIR, statuses[0] as string, folderName("000", "maintain-repo"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, ISSUE_FILE),
      renderIssue({ id: "000", kind: "task", parent: null, status: statuses[0] as string, assignee: "" }),
    );
  }
  const blocks = writeBlocks(root, renderBlock(config, version));
  return { root, statuses, blocks };
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
  const s = scan(root, config);
  const ids = allIds(s);
  let id: string;
  if (opts.parent) {
    if (!isValidId(opts.parent)) throw new LoloError(`"${opts.parent}" is not a valid ID.`);
    if (!ids.includes(opts.parent)) throw new LoloError(`Parent ${opts.parent} does not exist.`);
    id = nextChild(opts.parent, ids);
  } else {
    id = nextTopLevel(ids);
  }
  const status = config.statuses[0] as string;
  const dir = join(root, ISSUES_DIR, status, folderName(id, opts.slug));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, ISSUE_FILE);
  writeFileSync(
    file,
    renderIssue({ id, kind, parent: opts.parent ?? null, status, assignee: opts.assignee ?? "" }),
  );
  return { id, path: relative(root, file) };
}

export function moveIssue(cwd: string, id: string, status: string): { from: string; to: string } {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  if (!config.statuses.includes(status)) {
    throw new LoloError(`Unknown status "${status}". Statuses: ${config.statuses.join(", ")}.`);
  }
  if (!isValidId(id)) throw new LoloError(`"${id}" is not a valid ID.`);
  const matches = scan(root, config).issues.filter((i) => i.id === id);
  if (matches.length === 0) throw new LoloError(`Issue ${id} not found.`);
  if (matches.length > 1) {
    throw new LoloError(`Issue ${id} exists in more than one place; run validate and fix the duplicate first.`);
  }
  const issue = matches[0]!;
  if (issue.status === status) throw new LoloError(`Issue ${id} is already in ${status}.`);
  const dest = join(root, ISSUES_DIR, status, issue.folder);
  if (existsSync(dest)) throw new LoloError(`${relative(root, dest)} already exists.`);
  const file = join(issue.dir, ISSUE_FILE);
  if (!existsSync(file)) throw new LoloError(`${relative(root, file)} is missing.`);
  // Rewrite status first so a bad ISSUE.md fails before anything moves.
  const updated = setField(readFileSync(file, "utf8"), "status", status);
  writeFileSync(file, updated);
  renameSync(issue.dir, dest);
  return { from: relative(root, issue.dir), to: relative(root, dest) };
}

export interface Problem {
  path: string;
  message: string;
}

export function validate(cwd: string): Problem[] {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  const s = scan(root, config);
  const out: Problem[] = [];
  const rel = (p: string) => relative(root, p);

  for (const d of s.unknownDirs) {
    out.push({ path: `${ISSUES_DIR}/${d}`, message: "Folder is not a status in lolo.json." });
  }
  for (const st of s.missingStatuses) {
    out.push({ path: `${ISSUES_DIR}/${st}`, message: "Status folder is missing." });
  }

  // First pass: parse folders and files, collect IDs.
  interface Known {
    id: string;
    depth: number;
    parent: string;
    path: string;
  }
  const byId = new Map<string, Known[]>();
  const issueFields: { known: Known; fields: Record<string, string> }[] = [];

  for (const issue of s.issues) {
    const path = rel(issue.dir);
    const parsed = parseFolderName(issue.folder);
    if (!parsed) {
      out.push({
        path,
        message: issue.id
          ? "Folder name must be <id>-<slug> with a lowercase kebab-case slug."
          : "Folder name must start with a valid ID, then a hyphen, then a slug.",
      });
      continue;
    }
    // Register the ID before reading the file, so duplicates and parent lookups
    // still see issues whose ISSUE.md is missing or broken.
    const known: Known = { id: parsed.id, depth: depth(parsed.id), parent: "", path };
    byId.set(parsed.id, [...(byId.get(parsed.id) ?? []), known]);
    const file = join(issue.dir, ISSUE_FILE);
    if (!existsSync(file)) {
      out.push({ path, message: `${ISSUE_FILE} is missing.` });
      continue;
    }
    const fm = parseFrontMatter(readFileSync(file, "utf8"));
    if (!fm) {
      out.push({ path: rel(file), message: "Front matter is missing or malformed." });
      continue;
    }
    const f = fm.fields;
    known.parent = f["parent"] ?? "";
    issueFields.push({ known, fields: f });

    const here = rel(file);
    if (f["id"] !== parsed.id) {
      out.push({ path: here, message: `id "${f["id"] ?? ""}" does not match the folder ID ${parsed.id}.` });
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
  for (const { known, fields } of issueFields) {
    const here = `${known.path}/${ISSUE_FILE}`;
    const parent = fields["parent"] ?? "";
    if (known.depth === 1) {
      if (parent) out.push({ path: here, message: "A level-1 issue must not have a parent." });
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
