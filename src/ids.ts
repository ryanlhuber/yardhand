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

/** Allowed `priority:` values, 1 highest. An empty value means no priority. */
export const PRIORITIES = ["1", "2", "3"] as const;

/** Words a slug may not start with: they are the folder-name prefixes. */
export const RESERVED_PREFIXES = ["p1", "p2", "p3", "bug"] as const;

/** Soft limit for the folder name after the ID, so sidebars do not cut it off. */
export const NAME_SOFT_LIMIT = 40;

/** True when the slug's first word is a reserved prefix word (`p1-x`, `bug-x`, or just `bug`). */
export function startsWithReserved(slug: string): boolean {
  return (RESERVED_PREFIXES as readonly string[]).includes(slug.split("-")[0] as string);
}

export interface NameParts {
  priority?: string;
  bug?: boolean;
}

/** `<id>-[pN-][bug-]<slug>`. Priority first, then bug. */
export function folderName(id: string, slug: string, parts: NameParts = {}): string {
  const p = parts.priority ? `p${parts.priority}-` : "";
  const b = parts.bug ? "bug-" : "";
  return `${id}-${p}${b}${slug}`;
}

/** The ID at the start of a folder name, or null. Used for allocation and lookup. */
export function leadingId(name: string): string | null {
  const m = LEADING_ID_RE.exec(name);
  return m ? (m[1] as string) : null;
}

/**
 * Strict parse: valid ID, hyphen, optional `pN-`, optional `bug-`, then a valid slug that does
 * not itself start with a reserved word. `priority` is "" when there is no priority prefix.
 */
export function parseFolderName(
  name: string,
): { id: string; priority: string; bug: boolean; slug: string } | null {
  const id = leadingId(name);
  if (!id) return null;
  let rest = name.slice(id.length + 1);
  let priority = "";
  const p = /^p([123])-/.exec(rest);
  if (p) {
    priority = p[1] as string;
    rest = rest.slice(p[0].length);
  }
  let bug = false;
  if (rest.startsWith("bug-")) {
    bug = true;
    rest = rest.slice(4);
  }
  if (!SLUG_RE.test(rest) || startsWithReserved(rest)) return null;
  return { id, priority, bug, slug: rest };
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

/** Split a comma-separated list of IDs, dropping blanks and repeats. */
export function splitIdList(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
