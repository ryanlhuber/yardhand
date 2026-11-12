import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BLOCK_END,
  BLOCK_START,
  CONFIG_FILE,
  ISSUES_DIR,
  ISSUE_FILE,
  TOOL,
} from "./names.js";
import { YardhandError } from "./errors.js";
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
    `- **Where:** \`${ISSUES_DIR}/<status>/<id>-<slug>/${ISSUE_FILE}\`. An issue's status is the folder it is in.`,
    `- **Statuses, in order:** ${statuses} (defined in \`${ISSUES_DIR}/${CONFIG_FILE}\`).`,
    "- **IDs:** `017` (a feature or goal), `017.01` (a piece of it), `017.01.01` (a buildable unit, one model session). Three levels at most. `000` is the catch-all for maintenance and bugs with no clear home. Bugs are issues with `kind: bug`. New issues start in the first status.",
    `- **Never invent an ID, never move or rename a folder by hand, and never hand-edit front matter.** Use the commands:`,
    `  - Create: \`npx ${TOOL} new <slug> [--parent <id>] [--kind feature|task|bug] [--priority urgent|high|medium|low] [--depends-on <ids>] [--related <ids>] [--assignee <name>]\``,
    `  - Change status: \`npx ${TOOL} move <id> <status>\``,
    `  - Change anything else: \`npx ${TOOL} set <id> [--kind ...] [--priority ...|none] [--parent <id>] [--depends-on <ids>|none] [--related <ids>|none] [--assignee <name>|none]\``,
    `  - See issues: \`npx ${TOOL} list [--status <name>] [--parent <id>] [--kind <kind>] [--priority <level>] [--json]\``,
    `  - Roadmap and releases: \`npx ${TOOL} roadmap\`, \`npx ${TOOL} release <semver>\``,
    `  - Before finishing any work that touches issues: \`npx ${TOOL} validate\``,
    "- **Folder names:** `<id>-<slug>`, or `<id>-bug-<slug>` for bugs. The `bug-` prefix is added for you; priority is only in front matter.",
    `- **Links:** \`depends-on:\` lists issue IDs that must be finished first (comma-separated). \`related:\` lists issues that are linked but do not block. \`priority:\` is urgent, high, medium, low, or empty. Pick the next issue by priority, and skip any whose \`depends-on\` issues are not in \`done\`.`,
    `- **Rollup:** the \`parent:\` field in ${ISSUE_FILE} decides what rolls up to what, not the folder name.`,
    `- **Reference files** inside an issue folder use relative paths, never \`${ISSUES_DIR}/<status>/...\` paths.`,
    "- **Depot vocabulary:** level 1 is what Depot's skills call an epic; level 3 is a work item.",
    BLOCK_END,
  ].join("\n");
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

/**
 * Replace the marked block in `text`, or append it. Everything outside the markers is kept
 * byte for byte. Damaged markers (one missing, reversed, or repeated) throw instead of
 * guessing, because guessing can delete the user's text.
 */
export function upsertBlock(text: string, block: string, name = "file"): string {
  const starts = count(text, BLOCK_START);
  const ends = count(text, BLOCK_END);
  if (starts === 0 && ends === 0) {
    if (text === "") return block + "\n";
    const gap = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    return text + gap + block + "\n";
  }
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (starts !== 1 || ends !== 1 || end < start) {
    throw new YardhandError(
      `${name} has damaged ${TOOL} markers (${BLOCK_START} and ${BLOCK_END} must each appear once, start first). Fix or remove them, then run again. Nothing was changed.`,
    );
  }
  return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
}

export interface BlockWrite {
  name: string;
  path: string;
  content: string;
}

/**
 * Work out the AGENTS.md (created if missing) and CLAUDE.md (only if it exists) updates without writing.
 *
 * Files are handled as latin1, which maps every byte to one character and back, so bytes outside the
 * block (even invalid UTF-8) come back exactly as they were. The block's own UTF-8 bytes are carried
 * through the same way. The markers are ASCII, so searching still works.
 */
export function planBlocks(root: string, block: string): BlockWrite[] {
  const asBytes = Buffer.from(block, "utf8").toString("latin1");
  const plan: BlockWrite[] = [];
  for (const [name, create] of [
    ["AGENTS.md", true],
    ["CLAUDE.md", false],
  ] as const) {
    const path = join(root, name);
    const exists = existsSync(path);
    if (!exists && !create) continue;
    const current = exists ? readFileSync(path).toString("latin1") : "";
    plan.push({ name, path, content: upsertBlock(current, asBytes, name) });
  }
  return plan;
}

export function applyBlocks(plan: BlockWrite[]): string[] {
  for (const w of plan) writeFileSync(w.path, w.content, "latin1");
  return plan.map((w) => w.name);
}
