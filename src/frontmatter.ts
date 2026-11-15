import { YardhandError } from "./errors.js";

export interface FrontMatter {
  /** Values with any trailing comment removed and surrounding quotes taken off. */
  fields: Record<string, string>;
  /** Values as written, before quotes are taken off (trailing comment still removed). */
  raw: Record<string, string>;
  /** Keys that appear more than once. */
  duplicates: string[];
  /** Index of the closing `---` line. */
  end: number;
}

/** Take matching surrounding quotes off a value: `"@ryan"` becomes `@ryan`. */
export const unquote = (v: string): string => {
  const m = /^(["'])([\s\S]*)\1$/.exec(v);
  return m ? (m[2] as string) : v;
};

/** Parse a simple `key: value` block between `---` lines. Returns null when there is none. */
export function parseFrontMatter(text: string): FrontMatter | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  // No prototype, so keys like "constructor" or "toString" are ordinary keys.
  const fields: Record<string, string> = Object.create(null);
  const raw: Record<string, string> = Object.create(null);
  const duplicates: string[] = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i] as string;
    // Blank lines and comment lines (such as the `# Required` and `# Optional` group headers) are skipped.
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    // [\s\S] rather than ".", because "." does not match U+2028 or U+2029.
    const m = /^([A-Za-z][A-Za-z0-9-]*):([\s\S]*)$/.exec(line);
    if (!m) return null;
    const key = m[1] as string;
    // Drop a trailing comment that starts with whitespace then "#". A "#" inside a value is kept.
    const value = (m[2] as string).replace(/(^|\s+)#.*$/, "").trim();
    if (key in fields && !duplicates.includes(key)) duplicates.push(key);
    raw[key] = value;
    fields[key] = unquote(value);
  }
  return { fields, raw, duplicates, end };
}

/** Column where trailing comments start in the template, so they line up. */
export const COMMENT_COLUMN = 20;

/** One front-matter line: `key: value`, then the comment lined up at `column` (at least one space before it). */
export function fieldLine(key: string, value: string, comment = "", column = COMMENT_COLUMN): string {
  const base = `${key}:${value ? " " + value : ""}`;
  if (!comment) return base;
  return base + " ".repeat(Math.max(1, column - base.length)) + comment;
}

/** Replace one field's value in place, keeping every other line (and the line's comment, still lined up) as written. */
export function setField(text: string, key: string, value: string): string {
  const fm = parseFrontMatter(text);
  if (!fm) throw new YardhandError("The issue file has no valid front matter.");
  if (fm.duplicates.includes(key)) {
    throw new YardhandError(`Field "${key}" appears more than once in the front matter. Remove the extra line first.`);
  }
  const lines = text.split("\n");
  for (let i = 1; i < fm.end; i++) {
    const line = lines[i] as string;
    const bare = line.replace(/\r$/, "");
    const m = new RegExp(`^${key}:(.*)$`).exec(bare);
    if (m) {
      const found = /\s+(#.*)$/.exec(m[1] as string);
      const eol = line.endsWith("\r") ? "\r" : "";
      // Keep the comment where it was: same column if the new value fits, one space after it if not.
      const column = found ? bare.length - (found[1] as string).length : COMMENT_COLUMN;
      lines[i] = fieldLine(key, value, found?.[1] ?? "", column) + eol;
      return lines.join("\n");
    }
  }
  throw new YardhandError(`Field "${key}" not found in the front matter.`);
}

/** Like setField, but adds the field just before the closing `---` when the file does not have it yet. */
export function upsertField(text: string, key: string, value: string): string {
  const fm = parseFrontMatter(text);
  if (!fm) throw new YardhandError("The issue file has no valid front matter.");
  if (fm.fields[key] !== undefined) return setField(text, key, value);
  const lines = text.split("\n");
  const eol = (lines[fm.end] as string).endsWith("\r") ? "\r" : "";
  lines.splice(fm.end, 0, `${key}:${value ? " " + value : ""}${eol}`);
  return lines.join("\n");
}
