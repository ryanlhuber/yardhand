import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS, type Agent } from "./config.js";
import { BLOCK_END, BLOCK_START, CONFIG_FILE, GENERATED_MARK, ISSUES_DIR, ISSUE_FILE, SKILL_PREFIX, TOOL } from "./names.js";

/** Names shown in the init checklist. */
export const AGENT_LABELS: Record<Agent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  other: "Other (reads AGENTS.md or .agents/skills)",
};

const exists = (root: string, name: string) => existsSync(join(root, name));

/** AI tools whose files are already in the repo. Used to pre-check the init checklist. */
export function detectAgents(root: string): Agent[] {
  const found: Agent[] = [];
  if (exists(root, "CLAUDE.md") || exists(root, ".claude")) found.push("claude-code");
  if (exists(root, ".codex")) found.push("codex");
  if (exists(root, ".opencode") || exists(root, "opencode.json")) found.push("opencode");
  if (found.length === 0 && (exists(root, "AGENTS.md") || exists(root, ".agents"))) found.push("other");
  return found;
}

/** The agents `init` uses when nobody was asked: what is already in the repo, else AGENTS.md only (as before). */
export function defaultAgents(root: string): Agent[] {
  const found = detectAgents(root);
  return found.length ? found : ["other"];
}

/** Turn `--agents a,b` (or `none`) into a list. Throws a plain message on an unknown name. */
export function parseAgents(raw: string): Agent[] | string {
  const parts = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (parts.length === 1 && parts[0] === "none") return [];
  const out: Agent[] = [];
  for (const part of parts) {
    if (!(AGENTS as readonly string[]).includes(part)) return `--agents: "${part}" must be one of: ${AGENTS.join(", ")}, or none.`;
    if (!out.includes(part as Agent)) out.push(part as Agent);
  }
  return out;
}

/** Skill folders and who reads them. Codex, OpenCode and most other tools read .agents/skills; Claude Code reads .claude/skills. */
export const SKILL_DIRS = [
  { dir: ".agents/skills", for: (a: Agent[]) => a.some((x) => x !== "claude-code") },
  { dir: ".claude/skills", for: (a: Agent[]) => a.includes("claude-code") },
] as const;

/** The skill folders that will get yardhand skills for these agents. */
export const skillDirsFor = (agents: Agent[]): string[] => SKILL_DIRS.filter((d) => d.for(agents)).map((d) => d.dir);

/** True when CLAUDE.md pulls in AGENTS.md with an import line, so it needs no block of its own. */
export const importsAgentsMd = (text: string): boolean => /^[ \t]*@(?:\.\/)?AGENTS\.md[ \t]*$/m.test(text);

const npx = `npx ${TOOL}`;
const GENERATED = (version: string) =>
  `${GENERATED_MARK} v${version}. Do not edit: "${TOOL} init --force" rewrites this file. -->`;

const RULES = `The rules are in the ${TOOL} section of AGENTS.md (or CLAUDE.md). Read it first. When this repo has the CLI (\`${npx}\`, or \`pnpm dlx ${TOOL}\` / \`bunx ${TOOL}\`), use it for new IDs, status moves and front matter. Without it, follow the rules in that section exactly.`;

/** The four skills. Each is the body of one SKILL.md, without the front matter. */
export const SKILLS: { name: string; description: string; body: string[] }[] = [
  {
    name: "plan",
    description: `Turn a goal, feature request or bug report into ${TOOL} issues in ${ISSUES_DIR}/. Use when asked to plan work, break down a feature, or file a bug.`,
    body: [
      "# Plan work as issues",
      "",
      RULES,
      "",
      `1. Run \`${npx} list\` and check the work is not already filed.`,
      "2. Choose the level. A goal or feature is level 1 (`017`). A piece of it is level 2 (`017.01`). Something one model session can build is level 3 (`017.01.01`). Maintenance and bugs with no clear home go under `000`.",
      `3. Create each issue with \`${npx} new <slug> --parent <id>\`. Slugs start with a verb (\`add-login-form\`). For a bug, add \`--kind bug\` and describe the symptom (\`login-redirect-loop\`). Never pick an ID yourself.`,
      "4. In each new ISSUE.md, write the H1 title and the Description (what and why). Add acceptance criteria if they are already clear.",
      `5. Leave new issues where \`new\` puts them. Getting them ready is the ${SKILL_PREFIX}refine skill's job.`,
      `6. Run \`${npx} validate\` and fix any errors. Reply with the IDs you created.`,
      "",
      "Do not write code.",
    ],
  },
  {
    name: "refine",
    description: `Get ${TOOL} backlog issues ready to build: split big ones, write acceptance criteria, set size and fields, validate, and move to ready. Use when asked to refine, groom or get an issue ready.`,
    body: [
      "# Refine an issue until it is ready",
      "",
      RULES,
      "",
      "1. Pick the issue (the one asked for, or the highest-priority one in `backlog`). Check it is at the right level. If it needs more than one model session, split it into children and refine those instead.",
      "2. Write the H1 title, the Description (what and why), and the Acceptance criteria as checkboxes, one checkable outcome per line: `- [ ] ...`.",
      `3. Set \`size\` with \`${npx} set <id> --size small|medium|large\`. If it is \`large\`, split it unless there is a good reason not to.`,
      "4. Set what applies: `--labels`, `--priority`, `--depends-on`, `--assignee`, and `--effort` when the assignee is a model.",
      `5. Run \`${npx} validate\` and fix any errors.`,
      `6. Move it with \`${npx} move <id> ready\`. If this repo has no \`ready\` status, stop here and say so.`,
      "",
      "Do not write code.",
    ],
  },
  {
    name: "build",
    description: `Pick up and build a ${TOOL} issue. Use when asked to work on the next issue or to build a specific issue ID.`,
    body: [
      "# Build an issue",
      "",
      RULES,
      "",
      `1. Pick the issue: the one asked for, or from \`ready\`, one whose \`depends-on\` issues are all \`done\`, highest priority first, then lowest ID (\`${npx} list --status ready\`). If the one asked for is not in \`ready\` or has unfinished dependencies, ask before starting.`,
      `2. Claim it: \`${npx} move <id> in-progress\` and \`${npx} set <id> --assignee <your handle>\`. Your handle is listed under \`assignees\` in \`${ISSUES_DIR}/${CONFIG_FILE}\`.`,
      "3. Work on a branch named `<id>-<slug>`. If this repo has its own branch naming rule, follow it and put the issue ID in the branch name.",
      "4. Build what the Description and Acceptance criteria ask for, and nothing else. If you find more work, file it as a new issue instead of doing it.",
      "5. Tick each acceptance criterion you met (`- [x]`). Leave unmet ones unticked.",
      `6. If every criterion is met, move it to \`review\` if that status exists, else \`done\`. If not, leave it in \`in-progress\` and say what is left.`,
      `7. Run \`${npx} validate\` before you finish.`,
    ],
  },
  {
    name: "review",
    description: `Review the work on a ${TOOL} issue against its acceptance criteria. Use when asked to review an issue, or the branch for an issue.`,
    body: [
      "# Review an issue",
      "",
      RULES,
      "",
      `1. Read the issue's ${ISSUE_FILE} and the change on its branch.`,
      "2. If you are the issue's `assignee`, or you built it, stop. Say it needs another reviewer.",
      "3. Check every acceptance criterion against the change. A criterion passes only if the change shows it.",
      `4. If all pass, move the issue to the status after its current one (the order is in \`${ISSUES_DIR}/${CONFIG_FILE}\`).`,
      "5. If any fail, untick them, add a `## Review notes` section at the end of the ISSUE.md saying what is missing, and move the issue back to `in-progress`.",
      `6. Run \`${npx} validate\` before you finish.`,
    ],
  },
];

/** One SKILL.md file. */
export function renderSkill(skill: (typeof SKILLS)[number], version: string): string {
  return [
    "---",
    `name: ${SKILL_PREFIX}${skill.name}`,
    `description: ${skill.description}`,
    "---",
    "",
    GENERATED(version),
    "",
    ...skill.body,
    "",
  ].join("\n");
}

const isGenerated = (path: string): boolean => {
  try {
    return lstatSync(path).isFile() && readFileSync(path, "utf8").includes(GENERATED_MARK);
  } catch {
    return false;
  }
};

export interface SkillPlan {
  /** Files to write: path relative to the root, and content. */
  write: { path: string; content: string }[];
  /** Generated files to remove, relative to the root. */
  remove: string[];
  /** Files that exist but were not written by yardhand, so they are left alone. */
  skipped: string[];
}

/**
 * Work out the skill files for these agents without writing. Only files yardhand generated are ever
 * replaced or removed; a file at the same path written by someone else is left alone and reported.
 */
export function planSkills(root: string, agents: Agent[], version: string): SkillPlan {
  const plan: SkillPlan = { write: [], remove: [], skipped: [] };
  const wanted = skillDirsFor(agents);
  for (const { dir } of SKILL_DIRS) {
    if (wanted.includes(dir)) {
      for (const skill of SKILLS) {
        const path = `${dir}/${SKILL_PREFIX}${skill.name}/SKILL.md`;
        const full = join(root, path);
        if (existsSync(full) && !isGenerated(full)) plan.skipped.push(path);
        else plan.write.push({ path, content: renderSkill(skill, version) });
      }
      continue;
    }
    // Not wanted: remove every generated yardhand skill in this folder, including ones from older versions.
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, dir)).filter((e) => e.startsWith(SKILL_PREFIX));
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const path = `${dir}/${entry}/SKILL.md`;
      if (isGenerated(join(root, path))) plan.remove.push(path);
    }
  }
  return plan;
}

/** Write and remove what the plan says. Folders left empty by a removal are removed too. */
export function applySkills(root: string, plan: SkillPlan): void {
  for (const w of plan.write) {
    const full = join(root, w.path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, w.content);
  }
  for (const path of plan.remove) {
    const full = join(root, path);
    rmSync(full, { force: true });
    // Remove the skill folder, then the skills folder and its parent, but only while each is empty.
    let dir = join(full, "..");
    for (let i = 0; i < 3; i++) {
      try {
        rmdirSync(dir);
      } catch {
        break;
      }
      dir = join(dir, "..");
    }
  }
}

/** Lines that name another tracker or a branch naming rule. */
const CONFLICT_RE = /\b(linear|jira|github issues|asana|trello|shortcut)\b|\bbranch(es)?\b.*\b(name|names|named|naming|prefix)\b|\b(name|names|naming|prefix)\b.*\bbranch(es)?\b/i;

/**
 * Lines outside the yardhand block, in AGENTS.md and CLAUDE.md, that may conflict with yardhand.
 * Only reported, never changed.
 */
export function findConflicts(root: string): string[] {
  const found: string[] = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    let text: string;
    try {
      text = readFileSync(join(root, name), "utf8");
    } catch {
      continue;
    }
    let inside = false;
    text.split(/\r?\n/).forEach((line, i) => {
      if (line.includes(BLOCK_START)) inside = true;
      const skip = inside;
      if (line.includes(BLOCK_END)) inside = false;
      if (skip || !CONFLICT_RE.test(line)) return;
      const shown = line.trim().length > 70 ? line.trim().slice(0, 67) + "..." : line.trim();
      found.push(`${name} line ${i + 1} may conflict with ${TOOL} ("${shown}"). Check it.`);
    });
  }
  return found;
}
