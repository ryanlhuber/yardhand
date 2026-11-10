import { YardhandError } from "./errors.js";

export interface FrontMatter {
  fields: Record<string, string>;
  /** Keys that appear more than once. */
  duplicates: string[];
  /** Index of the closing `---` line. */
  end: number;
}

/** Parse a simple `key: value` block between `---` lines. Returns null when there is none. */
export function parseFrontMatter(text: string): FrontMatter | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  // No prototype, so keys like "constructor" or "toString" are ordinary keys.
  const fields: Record<string, string> = Object.create(null);
  const duplicates: string[] = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i] as string;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    // [\s\S] rather than ".", because "." does not match U+2028 or U+2029.
    const m = /^([A-Za-z][A-Za-z0-9-]*):([\s\S]*)$/.exec(line);
    if (!m) return null;
    const key = m[1] as string;
    // Drop a trailing comment that starts with whitespace then "#". A "#" inside a value is kept.
    const value = (m[2] as string).replace(/(^|\s+)#.*$/, "").trim();
    if (key in fields && !duplicates.includes(key)) duplicates.push(key);
    fields[key] = value;
  }
  return { fields, duplicates, end };
}

/** Replace one field's value in place, keeping every other line (and any comment) as written. */
export function setField(text: string, key: string, value: string): string {
  const fm = parseFrontMatter(text);
  if (!fm) throw new YardhandError("The issue file has no valid front matter.");
  if (fm.duplicates.includes(key)) {
    throw new YardhandError(`Field "${key}" appears more than once in the front matter. Remove the extra line first.`);
  }
  const lines = text.split("\n");
  for (let i = 1; i < fm.end; i++) {
    const line = lines[i] as string;
    const m = new RegExp(`^${key}:(.*)$`).exec(line.replace(/\r$/, ""));
    if (m) {
      const comment = /\s+#.*$/.exec(m[1] as string)?.[0] ?? "";
      const eol = line.endsWith("\r") ? "\r" : "";
      lines[i] = `${key}: ${value}${comment}${eol}`;
      return lines.join("\n");
    }
  }
  throw new YardhandError(`Field "${key}" not found in the front matter.`);
}
