import { YardhandError } from "./errors.js";

const CHILD = "(?:0[1-9]|[1-9]\\d)";
export const ID_RE = new RegExp(`^\\d{3}(?:\\.${CHILD}){0,2}$`);
export const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const STATUS_RE = SLUG_RE;
// The regular expression published at semver.org.
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

// An ID followed by a hyphen at the start of a folder name. Matching on the
// separator keeps `017` from ever matching `0170`.
const LEADING_ID_RE = new RegExp(`^(\\d{3}(?:\\.${CHILD}){0,2})-`);

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

export function depth(id: string): number {
  return id.split(".").length;
}

export function parentOf(id: string): string | null {
  const parts = id.split(".");
  return parts.length === 1 ? null : parts.slice(0, -1).join(".");
}

/** The only reserved folder prefix. It follows the ID and marks `kind: bug`. */
export const BUG_PREFIX = "bug-";

export const KINDS = ["feature", "task", "bug"] as const;
export type Kind = (typeof KINDS)[number];

/** Default kind by depth: level 1 is a feature, deeper levels are tasks. */
export const defaultKind = (id: string): Kind => (depth(id) === 1 ? "feature" : "task");

/**
 * Turn what someone typed into a name: trim, lowercase, and turn runs of spaces and
 * underscores into one dash. "Review 1" becomes "review-1". Validation happens after.
 */
export function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export function folderName(id: string, slug: string, bug = false): string {
  return `${id}-${bug ? BUG_PREFIX : ""}${slug}`;
}

/** Split the text after "<id>-" into the bug marker and the slug. */
export function splitPrefix(rest: string): { bug: boolean; slug: string } {
  return rest.startsWith(BUG_PREFIX)
    ? { bug: true, slug: rest.slice(BUG_PREFIX.length) }
    : { bug: false, slug: rest };
}

/** The ID at the start of a folder name, or null. Used for allocation and lookup. */
export function leadingId(name: string): string | null {
  const m = LEADING_ID_RE.exec(name);
  return m ? (m[1] as string) : null;
}

/** Strict parse: valid ID, hyphen, valid slug. */
export function parseFolderName(
  name: string,
): { id: string; slug: string; bug: boolean } | null {
  const id = leadingId(name);
  if (!id) return null;
  const { bug, slug } = splitPrefix(name.slice(id.length + 1));
  // A second "bug-" would be a reserved prefix used as part of the slug.
  if (!SLUG_RE.test(slug) || slug.startsWith(BUG_PREFIX)) return null;
  return { id, slug, bug };
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/** Next level-1 ID: highest existing level-1 number plus one. */
export function nextTopLevel(existing: Iterable<string>): string {
  let max = 0;
  for (const id of existing) {
    if (depth(id) === 1) max = Math.max(max, Number(id));
  }
  if (max >= 999) throw new YardhandError("No level-1 IDs left (999 is the maximum).");
  return pad(max + 1, 3);
}

/** Next child of `parent`: highest existing child number under that ID prefix plus one. */
export function nextChild(parent: string, existing: Iterable<string>): string {
  if (depth(parent) >= 3) {
    throw new YardhandError(`${parent} is already at the third level and cannot have children.`);
  }
  const want = depth(parent) + 1;
  const prefix = `${parent}.`;
  let max = 0;
  for (const id of existing) {
    if (depth(id) === want && id.startsWith(prefix)) {
      max = Math.max(max, Number(id.slice(prefix.length)));
    }
  }
  if (max >= 99) throw new YardhandError(`No child IDs left under ${parent} (99 is the maximum).`);
  return `${parent}.${pad(max + 1, 2)}`;
}

/** Allowed `priority:` values, most urgent first. An empty value means no priority. */
export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
/** Sort rank: urgent is 0, no priority sorts last. */
export const priorityRank = (p: string): number => {
  const i = (PRIORITIES as readonly string[]).indexOf(p);
  return i === -1 ? PRIORITIES.length : i;
};

/** Compare two semver strings by precedence (build metadata ignored). Returns <0, 0, or >0. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = (v.split("+")[0] as string).split("-", 2) as [string, string | undefined];
    return { nums: core.split(".").map(Number), pre: pre === undefined ? null : pre.split(".") };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] as number) - (y.nums[i] as number);
    if (d !== 0) return d;
  }
  if (x.pre === null && y.pre === null) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) - Number(q);
    if (pn !== qn) return pn ? -1 : 1;
    if (!pn && p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Split a comma-separated list of IDs, dropping blanks and repeats. */
export function splitIdList(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
