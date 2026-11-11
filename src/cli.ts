import { parseArgs } from "node:util";
import * as p from "@clack/prompts";
import pkg from "../package.json";
import { DEFAULT_STATUSES } from "./config.js";
import { DEPOT_INSTALL, ISSUES_DIR, TOOL } from "./names.js";
import { YardhandError } from "./errors.js";
import { init, moveIssue, newIssue, validate } from "./commands.js";
import { STATUS_RE } from "./ids.js";

const HELP = `${TOOL} ${pkg.version}: file-based issue tracking

Usage:
  ${TOOL} init [--yes] [--statuses a,b,c] [--force]
  ${TOOL} new <slug> [--parent <id>] [--kind task|bug] [--assignee <name>]
             [--priority urgent|high|medium|low] [--depends-on <ids>] [--related <ids>]
  ${TOOL} move <id> <status>
  ${TOOL} validate
  ${TOOL} --help | --version
`;

const OPTIONAL_STATUSES = ["review", "merge-ready", "blocked"];

let interactive = false;

async function promptStatuses(): Promise<string[]> {
  interactive = true;
  p.intro(`${TOOL} init`);
  const chosen = await p.multiselect({
    message: "Which statuses do you want? (backlog and done are always included)",
    options: [
      { value: "in-progress", label: "in-progress" },
      ...OPTIONAL_STATUSES.map((s) => ({ value: s, label: s })),
    ],
    initialValues: ["in-progress"],
    required: false,
  });
  if (p.isCancel(chosen)) return cancel();
  const custom = await p.text({
    message: "Custom statuses? Comma-separated, kebab-case (leave blank for none)",
    placeholder: "review-1, review-2",
    defaultValue: "",
    validate: (v) => {
      const bad = splitList(v ?? "").find((s) => !STATUS_RE.test(s));
      return bad ? `"${bad}" must be lowercase kebab-case.` : undefined;
    },
  });
  if (p.isCancel(custom)) return cancel();
  const middle = [...new Set([...(chosen as string[]), ...splitList(custom as string)])].filter(
    (s) => s !== "backlog" && s !== "done",
  );
  let ordered = middle;
  if (middle.length > 1) {
    const order = await p.text({
      message: "Order of the statuses between backlog and done (comma-separated)",
      initialValue: middle.join(", "),
      validate: (v) => {
        const got = splitList(v ?? "");
        const ok = got.length === middle.length && middle.every((m) => got.includes(m));
        return ok ? undefined : `Use each of these once: ${middle.join(", ")}`;
      },
    });
    if (p.isCancel(order)) return cancel();
    ordered = splitList(order as string);
  }
  return ["backlog", ...ordered, "done"];
}

function cancel(): never {
  p.cancel("Cancelled. Nothing was changed.");
  process.exit(1);
}

const splitList = (v: string) =>
  v.split(",").map((s) => s.trim()).filter(Boolean);

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const isHelp = !command || command === "--help" || command === "-h" || command === "help";
  const isVersion = command === "--version" || command === "-v";
  if ((isHelp || isVersion) && rest.length > 0) {
    throw new YardhandError(`Unexpected argument "${rest[0]}". Run "${TOOL} --help".`);
  }
  if (isHelp) {
    process.stdout.write(HELP);
    return 0;
  }
  if (isVersion) {
    process.stdout.write(pkg.version + "\n");
    return 0;
  }
  const cwd = process.cwd();

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
      else if (process.stdin.isTTY) statuses = await promptStatuses();
      else throw new YardhandError(`Not a terminal. Use "${TOOL} init --yes" (optionally with --statuses a,b,c).`);
      const result = init(cwd, statuses, pkg.version, values.force ?? false);
      const lines = [
        `Created ${ISSUES_DIR}/ with statuses: ${result.statuses.join(", ")}`,
        `Updated: ${result.blocks.join(", ")}`,
        "",
        "Optional: install Depot's planning and review skills with",
        `  ${DEPOT_INSTALL}`,
      ];
      if (process.stdin.isTTY && !values.yes && !values.statuses) p.outro(lines.join("\n"));
      else process.stdout.write(lines.join("\n") + "\n");
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
      if (!slug || positionals.length > 1) throw new YardhandError(`Usage: ${TOOL} new <slug> [--parent <id>] [--kind task|bug] [--assignee <name>] [--priority <level>] [--depends-on <ids>] [--related <ids>]`);
      const r = newIssue(cwd, {
        slug,
        parent: values.parent,
        kind: values.kind as "task" | "bug" | undefined,
        assignee: values.assignee,
        priority: values.priority,
        dependsOn: values["depends-on"] === undefined ? undefined : splitList(values["depends-on"]),
        related: values.related === undefined ? undefined : splitList(values.related),
      });
      process.stdout.write(`${r.id} ${r.path}\n`);
      return 0;
    }
    case "move": {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: {} });
      const [id, status] = positionals;
      if (!id || !status || positionals.length > 2) throw new YardhandError(`Usage: ${TOOL} move <id> <status>`);
      const r = moveIssue(cwd, id, status);
      process.stdout.write(`${r.from} -> ${r.to}\n`);
      return 0;
    }
    case "validate": {
      // No options and no positionals: anything extra is a mistake, not something to ignore.
      parseArgs({ args: rest, allowPositionals: false, options: {} });
      const problems = validate(cwd);
      if (problems.length === 0) {
        process.stdout.write("OK\n");
        return 0;
      }
      // One write, then let the process end on its own, so a slow reader still gets every line.
      const lines = problems.map((pr) => `${pr.path}: ${pr.message}`);
      lines.push("", `${problems.length} problem${problems.length === 1 ? "" : "s"} found.`);
      process.stderr.write(lines.join("\n") + "\n");
      return 1;
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
