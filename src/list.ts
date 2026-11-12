import { YardhandError } from "./errors.js";
import { findRoot, loadConfig } from "./config.js";
import { scan } from "./scan.js";
import { readIssues, descendantsOf } from "./issues.js";
import { KINDS, PRIORITIES, isValidId, normalizeName, priorityRank, splitIdList } from "./ids.js";

export interface ListFilters {
  status?: string;
  parent?: string;
  kind?: string;
  priority?: string;
}

export interface ListRow {
  id: string;
  kind: string;
  status: string;
  priority: string;
  slug: string;
  parent: string;
  dependsOn: string[];
  related: string[];
  assignee: string;
  releasedIn: string;
  path: string;
}

/** Every matching issue, urgent first, then by ID. Read-only. */
export function listIssues(cwd: string, filters: ListFilters = {}): ListRow[] {
  const root = findRoot(cwd);
  const config = loadConfig(root);
  const status = filters.status === undefined ? undefined : normalizeName(filters.status);
  if (status !== undefined && !config.statuses.includes(status)) {
    throw new YardhandError(`Unknown status "${filters.status}". Statuses: ${config.statuses.join(", ")}.`);
  }
  const kind = filters.kind?.trim().toLowerCase();
  if (kind !== undefined && !(KINDS as readonly string[]).includes(kind)) {
    throw new YardhandError(`--kind must be one of: ${KINDS.join(", ")}.`);
  }
  const priority = filters.priority?.trim().toLowerCase();
  if (priority !== undefined && !(PRIORITIES as readonly string[]).includes(priority)) {
    throw new YardhandError(`--priority must be one of: ${PRIORITIES.join(", ")}.`);
  }

  const all = readIssues(root, scan(root, config));
  let pool = all;
  if (filters.parent !== undefined) {
    if (!isValidId(filters.parent)) throw new YardhandError(`"${filters.parent}" is not a valid ID.`);
    if (!all.some((i) => i.id === filters.parent)) throw new YardhandError(`Issue ${filters.parent} not found.`);
    pool = descendantsOf(all, filters.parent);
  }
  const rows: ListRow[] = [];
  for (const i of pool) {
    if (!i.id) continue;
    const f = i.fields ?? {};
    const row: ListRow = {
      id: i.id,
      kind: f["kind"] ?? (i.bug ? "bug" : ""),
      status: i.status,
      priority: f["priority"] ?? "",
      slug: i.slug,
      parent: f["parent"] ?? "",
      dependsOn: splitIdList(f["depends-on"] ?? ""),
      related: splitIdList(f["related"] ?? ""),
      assignee: f["assignee"] ?? "",
      releasedIn: f["released-in"] ?? "",
      path: i.path,
    };
    if (status !== undefined && row.status !== status) continue;
    if (kind !== undefined && row.kind !== kind) continue;
    if (priority !== undefined && row.priority !== priority) continue;
    rows.push(row);
  }
  rows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

/** Plain-text table: priority, ID, kind, status, slug. */
export function formatTable(rows: ListRow[]): string {
  if (rows.length === 0) return "No issues.\n";
  const cols = rows.map((r) => [r.priority, r.id, r.kind || "?", r.status, r.slug]);
  const widths = [0, 1, 2, 3].map((c) => Math.max(...cols.map((r) => (r[c] as string).length)));
  return (
    cols
      .map((r) => [...widths.map((w, c) => (r[c] as string).padEnd(w)), r[4]].join("  ").trimEnd())
      .join("\n") + "\n"
  );
}
