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

export function folderName(id: string, slug: string): string {
  return `${id}-${slug}`;
}

/** The ID at the start of a folder name, or null. Used for allocation and lookup. */
export function leadingId(name: string): string | null {
  const m = LEADING_ID_RE.exec(name);
  return m ? (m[1] as string) : null;
}

/** Strict parse: valid ID, hyphen, valid slug. */
export function parseFolderName(
  name: string,
): { id: string; slug: string } | null {
  const id = leadingId(name);
  if (!id) return null;
  const slug = name.slice(id.length + 1);
  return SLUG_RE.test(slug) ? { id, slug } : null;
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

/** Allowed `priority:` values. An empty value means no priority. */
export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

/** Split a comma-separated list of IDs, dropping blanks and repeats. */
export function splitIdList(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(",")) {
    const id = part.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
