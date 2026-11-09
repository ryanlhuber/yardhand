import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCK_END, BLOCK_START, CONFIG_FILE, ISSUES_DIR, TOOL } from "./names.js";
import type { Config } from "./config.js";

/** The generated "Work items" block. Built from the config and CLI version so it cannot drift. */
export function renderBlock(config: Config, version: string): string {
  const statuses = config.statuses.join(" → ");
  return [
    BLOCK_START,
    `## Work items (${TOOL} v${version})`,
    "",
    `Issues are files in this repo, managed with \`${TOOL}\`. Do not edit this block by hand; \`${TOOL} init\` regenerates it.`,
    "",
    `- **Where:** \`${ISSUES_DIR}/<status>/<id>-<slug>/ISSUE.md\`. An issue's status is the folder it is in.`,
    `- **Statuses, in order:** ${statuses} (defined in \`${ISSUES_DIR}/${CONFIG_FILE}\`).`,
    "- **IDs:** `017` (a feature or goal), `017.01` (a piece of it), `017.01.01` (a buildable unit, one model session). Three levels at most. `000` is the catch-all for maintenance and bugs with no clear home. Bugs are issues with `kind: bug`.",
    "- **Never invent an ID, and never move a folder by hand.**",
    `  - Create: \`npx ${TOOL} new <slug> [--parent <id>] [--kind task|bug]\``,
    `  - Change status: \`npx ${TOOL} move <id> <status>\``,
    `  - Before finishing any work that touches issues: \`npx ${TOOL} validate\``,
    "- **Rollup:** the `parent:` field in ISSUE.md decides what rolls up to what, not the folder name.",
    "- **Reference files** inside an issue folder use relative paths, never `issues/<status>/...` paths.",
    "- **Depot vocabulary:** level 1 is what Depot's skills call an epic; level 3 is a work item.",
    BLOCK_END,
  ].join("\n");
}

/** Replace the marked block in `text`, or append it. Content outside the markers is untouched. */
export function upsertBlock(text: string, block: string): string {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start !== -1 && end > start) {
    return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
  }
  if (text.trim() === "") return block + "\n";
  return text.replace(/\s*$/, "") + "\n\n" + block + "\n";
}

/** Write the block into AGENTS.md (created if missing) and CLAUDE.md (only if it exists). */
export function writeBlocks(root: string, block: string): string[] {
  const written: string[] = [];
  for (const [name, create] of [
    ["AGENTS.md", true],
    ["CLAUDE.md", false],
  ] as const) {
    const path = join(root, name);
    const exists = existsSync(path);
    if (!exists && !create) continue;
    const current = exists ? readFileSync(path, "utf8") : "";
    writeFileSync(path, upsertBlock(current, block));
    written.push(name);
  }
  return written;
}
