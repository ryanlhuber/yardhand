export interface FrontMatter {
  fields: Record<string, string>;
  /** Line offsets of the block, for in-place edits. */
  start: number;
  end: number;
}

/** Parse a simple `key: value` block between `---` lines. Returns null when there is none. */
export function parseFrontMatter(text: string): FrontMatter | null {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  const fields: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i] as string;
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const m = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/.exec(line);
    if (!m) return null;
    // Drop a trailing comment that starts with whitespace then "#".
    const value = (m[2] as string).replace(/\s+#.*$/, "").trim();
    fields[m[1] as string] = value;
  }
  return { fields, start: 0, end };
}

/** Replace one field's value in place, keeping every other line (and any comment) as written. */
export function setField(text: string, key: string, value: string): string {
  const fm = parseFrontMatter(text);
  if (!fm) throw new Error("ISSUE.md has no front matter.");
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
  throw new Error(`Field "${key}" not found in front matter.`);
}
