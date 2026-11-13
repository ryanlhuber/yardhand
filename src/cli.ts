import { parseArgs } from "node:util";
import pkg from "../package.json";
import { DEFAULT_STATUSES, findRoot } from "./config.js";
import { DEPOT_INSTALL, ISSUES_DIR, TOOL } from "./names.js";
import { NotInitializedError, YardhandError } from "./errors.js";
import { check, init, moveIssue, newIssue } from "./commands.js";
import { setIssue } from "./set.js";
import { formatTable, listIssues } from "./list.js";
import { roadmap } from "./roadmap.js";
import { release } from "./release.js";
import { promptStatuses } from "./prompts.js";
import * as p from "@clack/prompts";

const USAGE = {
  init: `${TOOL} init [--yes] [--statuses a,b,c] [--force]

  Creates ${ISSUES_DIR}/ with one folder per status. In a terminal it asks which statuses you want and in what order.
  --yes             use backlog, in-progress, done without asking
  --statuses a,b,c  use exactly these statuses, in this order (must include backlog and done)
  --force           overwrite the config of an already initialized repo`,
  new: `${TOOL} new <slug> [--parent <id>] [--kind feature|task|bug] [--priority urgent|high|medium|low]
             [--depends-on <ids>] [--related <ids>] [--assignee <name>]

  Creates an issue in the first status and prints its ID and path.
  The slug is tidied up for you ("Add Auth" becomes add-auth). A leading "bug-" means --kind bug.
  Without --kind, level 1 is a feature and deeper levels are tasks.`,
  move: `${TOOL} move <id> <status>

  Moves an issue to another status and rewrites its status field. Status names are tidied up
  ("In Progress" becomes in-progress). Moving to the current status changes nothing.`,
  set: `${TOOL} set <id> [--kind feature|task|bug] [--priority urgent|high|medium|low|none] [--parent <id>]
            [--depends-on <ids>|none] [--related <ids>|none] [--assignee <name>|none] [--released-in <semver>|none]

  Changes fields on an existing issue. A value replaces the old one; "none" clears it.
  Changing --kind renames the folder (adds or removes the bug- prefix). id and status cannot be set here.`,
  list: `${TOOL} list [--status <name>] [--parent <id>] [--kind feature|task|bug] [--priority urgent|high|medium|low] [--json]

  Lists every issue, most urgent first, then by ID. --parent <id> lists everything under that issue.`,
  roadmap: `${TOOL} roadmap [--stdout]

  Writes ${ISSUES_DIR}/ROADMAP.md, built from the parent fields. --stdout prints it instead.`,
  release: `${TOOL} release <semver> [--dry-run]

  Stamps released-in on every done issue that has no version, and writes ${ISSUES_DIR}/releases/<version>.md.
  --dry-run shows what would happen and changes nothing.`,
  validate: `${TOOL} validate [--json]

  Checks every issue and prints each problem with its path. Exits 1 if there is any error.
  --json prints errors and warnings as JSON.`,
} as const;

const HELP = `${TOOL} ${pkg.version}: file-based issue tracking

Usage:
${Object.values(USAGE)
  .map((u) => "  " + (u.split("\n\n")[0] as string).replace(/\n/g, "\n  "))
  .join("\n")}
  ${TOOL} --help | --version

Run "${TOOL} <command> --help" for details.
`;

let interactive = false;

const splitList = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const out = (text: string) => process.stdout.write(text.endsWith("\n") ? text : text + "\n");

/** True when there is no yardhand setup here or above. Any other error (such as an unreadable root) counts as set up. */
function notSetUp(cwd: string): boolean {
  try {
    findRoot(cwd);
    return false;
  } catch (err) {
    return err instanceof NotInitializedError;
  }
}

async function main(argv: string[]): Promise<number> {
  // A bare `yardhand` in a terminal, in a repo that is not set up yet, walks through init (like `npm create vite`).
  // Everywhere else (already set up, or not a terminal) it prints the help.
  if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY && notSetUp(process.cwd())) argv = ["init"];
  const [command, ...rest] = argv;
  const isHelp = !command || command === "--help" || command === "-h" || command === "help";
  const isVersion = command === "--version" || command === "-v";
  if ((isHelp || isVersion) && rest.length > 0) {
    throw new YardhandError(`Unexpected argument "${rest[0]}". Run "${TOOL} --help".`);
  }
  if (isHelp) {
    out(HELP);
    return 0;
  }
  if (isVersion) {
    out(pkg.version);
    return 0;
  }
  const cwd = process.cwd();
  // `<command> --help` prints that command's usage. Anything else typed with it is an error.
  if (command in USAGE && rest.some((a) => a === "--help" || a === "-h")) {
    if (rest.length > 1) throw new YardhandError(`Unexpected argument "${rest.find((a) => a !== "--help" && a !== "-h")}". Run "${TOOL} ${command} --help" on its own.`);
    out(USAGE[command as keyof typeof USAGE]);
    return 0;
  }

  switch (command) {
    case "init": {
      const { values } = parseArgs({
        args: rest,
        options: {
          yes: { type: "boolean", short: "y" },
          statuses: { type: "string" },
          force: { type: "boolean" },
        },
      });
      let statuses: string[];
      if (values.statuses !== undefined) statuses = splitList(values.statuses);
      else if (values.yes) statuses = DEFAULT_STATUSES;
      else if (process.stdin.isTTY) {
        interactive = true;
        statuses = await promptStatuses();
      } else throw new YardhandError(`Not a terminal. Use "${TOOL} init --yes" (optionally with --statuses a,b,c).`);
      const result = init(cwd, statuses, pkg.version, values.force ?? false);
      const lines = [
        `Created ${ISSUES_DIR}/ with statuses: ${result.statuses.join(" → ")}`,
        `Updated: ${result.blocks.join(", ")}`,
        "",
        "Optional: install Depot's planning and review skills with",
        `  ${DEPOT_INSTALL}`,
      ];
      if (interactive) p.outro(lines.join("\n"));
      else out(lines.join("\n"));
      return 0;
    }
    case "new": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          parent: { type: "string" },
          kind: { type: "string" },
          assignee: { type: "string" },
          priority: { type: "string" },
          "depends-on": { type: "string" },
          related: { type: "string" },
        },
      });
      const slug = positionals[0];
      if (!slug || positionals.length > 1) throw new YardhandError(`Usage: ${USAGE.new.split("\n\n")[0]!.replace(/\n\s+/g, " ")}`);
      const r = newIssue(cwd, {
        slug,
        parent: values.parent,
        kind: values.kind,
        assignee: values.assignee,
        priority: values.priority,
        dependsOn: values["depends-on"] === undefined ? undefined : splitList(values["depends-on"]),
        related: values.related === undefined ? undefined : splitList(values.related),
      });
      const summary = [r.kind, r.priority, r.parent ? `parent ${r.parent}` : "", r.status].filter(Boolean).join(" · ");
      out([`${r.id}  ${r.path}`, `${" ".repeat(r.id.length + 2)}${summary}`, ...r.notes].join("\n"));
      return 0;
    }
    case "move": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
      const [id, status] = positionals;
      if (!id || !status || positionals.length > 2) throw new YardhandError(`Usage: ${TOOL} move <id> <status>`);
      const r = moveIssue(cwd, id, status);
      const lines = r.unchanged ? [`Already in ${r.status}. Nothing changed.`] : [`${r.from} -> ${r.to}`];
      lines.push(...r.notes);
      if (r.children.length) {
        lines.push(`${plural(r.children.length, "child", "children")} not moved (${r.children.join(", ")})`);
      }
      out(lines.join("\n"));
      return 0;
    }
    case "set": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          kind: { type: "string" },
          priority: { type: "string" },
          parent: { type: "string" },
          "depends-on": { type: "string" },
          related: { type: "string" },
          assignee: { type: "string" },
          "released-in": { type: "string" },
        },
      });
      const [id] = positionals;
      if (!id || positionals.length > 1) throw new YardhandError(`Usage: ${USAGE.set.split("\n\n")[0]!.replace(/\n\s+/g, " ")}`);
      const r = setIssue(cwd, id, {
        kind: values.kind,
        priority: values.priority,
        parent: values.parent,
        dependsOn: values["depends-on"],
        related: values.related,
        assignee: values.assignee,
        releasedIn: values["released-in"],
      });
      if (r.unchanged) out("Nothing changed.");
      else {
        out(`${r.id}  ${r.path}\n${" ".repeat(r.id.length + 2)}${r.changes.map((c) => `${c.field}: ${c.from} -> ${c.to}`).join(" · ")}`);
      }
      return 0;
    }
    case "list": {
      const { values } = parseArgs({
        args: rest,
        allowPositionals: false,
        options: {
          status: { type: "string" },
          parent: { type: "string" },
          kind: { type: "string" },
          priority: { type: "string" },
          json: { type: "boolean" },
        },
      });
      const rows = listIssues(cwd, values);
      out(values.json ? JSON.stringify(rows, null, 2) : formatTable(rows));
      return 0;
    }
    case "roadmap": {
      const { values } = parseArgs({ args: rest, allowPositionals: false, options: { stdout: { type: "boolean" } } });
      const r = roadmap(cwd, values.stdout ?? false);
      out(values.stdout ? r.text : `Wrote ${r.path} (${plural(r.issues, "issue")})`);
      return 0;
    }
    case "release": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { "dry-run": { type: "boolean" } },
      });
      const [version] = positionals;
      if (!version || positionals.length > 1) throw new YardhandError(`Usage: ${TOOL} release <semver> [--dry-run]`);
      const r = release(cwd, version, values["dry-run"] ?? false);
      const lines: string[] = [...r.notes];
      if (r.stamped.length) {
        lines.push(
          `${r.dryRun ? "Would stamp" : "Stamped"} released-in: ${r.version} on ${plural(r.stamped.length, "issue")}`,
          `  ${r.stamped.join("  ")}`,
        );
        lines.push(r.dryRun ? "(dry run, nothing written)" : `Wrote ${r.file}`);
      }
      out(lines.join("\n"));
      return 0;
    }
    case "validate": {
      const { values } = parseArgs({ args: rest, allowPositionals: false, options: { json: { type: "boolean" } } });
      const { errors, warnings } = check(cwd);
      if (values.json) {
        out(JSON.stringify({ ok: errors.length === 0, errors, warnings }, null, 2));
        return errors.length ? 1 : 0;
      }
      if (errors.length === 0 && warnings.length === 0) {
        out("OK");
        return 0;
      }
      // One write, then let the process end on its own, so a slow reader still gets every line.
      const lines = errors.map((pr) => `${pr.path}: ${pr.message}`);
      if (warnings.length) {
        if (lines.length) lines.push("");
        lines.push("Warnings:", ...warnings.map((w) => `${w.path}: ${w.message}`));
      }
      lines.push(
        "",
        warnings.length
          ? `${plural(errors.length, "problem")}, ${plural(warnings.length, "warning")}.`
          : `${plural(errors.length, "problem")} found.`,
      );
      process.stderr.write(lines.join("\n") + "\n");
      return errors.length ? 1 : 0;
    }
    default:
      throw new YardhandError(`Unknown command "${command}". Run "${TOOL} --help".`);
  }
}

// Set the exit code and let Node flush stdout/stderr before exiting. Calling process.exit() right
// after a write can cut off output on a pipe. The interactive prompts leave stdin open, so that
// path exits explicitly (its output goes to a terminal, which is written synchronously).
const finish = (code: number) => {
  process.exitCode = code;
  if (interactive) process.exit(code);
};

main(process.argv.slice(2)).then(finish, (err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message.replace(/^(TypeError|Error) \[[A-Z_]+\]: /, "")}\n`);
  finish(1);
});
