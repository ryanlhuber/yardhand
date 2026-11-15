// 0.3.0: the grouped template, H1 title, size, labels, effort, @handle assignees, list syntax,
// init's ready status, ignore entries and CI workflow, and the new validate checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { check, init, moveIssue, newIssue, shipRisks, uncheckedCriteria, validate, WORKFLOW_FILE } from "../src/commands.js";
import { setIssue } from "../src/set.js";
import { listIssues } from "../src/list.js";
import { buildRoadmap } from "../src/roadmap.js";
import { readIssues } from "../src/issues.js";
import { scan } from "../src/scan.js";
import { loadConfig, DEFAULT_STATUSES } from "../src/config.js";
import { release } from "../src/release.js";
import { parseFrontMatter } from "../src/frontmatter.js";
import { splitList } from "../src/ids.js";
import { OPTIONAL_STATUSES, orderStatuses } from "../src/prompts.js";
import { titleFromSlug } from "../src/template.js";

const STATUSES = ["backlog", "ready", "in-progress", "done", "canceled"];
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const fields = (root: string, p: string) => parseFrontMatter(read(root, p))!.fields;

function repo(extra: { labels?: string[]; assignees?: Record<string, unknown> } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "yardhand-fields-"));
  init(root, STATUSES, "0.0.0");
  const cfg = join(root, "issues/yardhand.json");
  const current = JSON.parse(readFileSync(cfg, "utf8"));
  writeFileSync(cfg, JSON.stringify({ ...current, ...extra }, null, 2));
  return root;
}
const team = () =>
  repo({
    labels: ["backend", "frontend", "auth"],
    assignees: { "@ryan": "person", "@claude-opus": "model", "@gpt-6-1-sol": { type: "model", run: "codex exec" } },
  });

test("template: exact output for a buildable unit with every flag", () => {
  const root = team();
  newIssue(root, { slug: "add-auth" });
  newIssue(root, { slug: "add-login", parent: "001" });
  const r = newIssue(root, {
    slug: "add-login-form",
    parent: "001.01",
    priority: "high",
    size: "medium",
    labels: ["frontend", "auth"],
    assignee: "claude-opus",
    effort: "xhigh",
  });
  assert.equal(
    read(root, r.path),
    [
      "---",
      "# Required",
      "id: 001.01.01",
      "kind: task          # feature | task | bug",
      "parent: 001.01      # omit for level 1 only",
      "status: backlog     # must match the folder",
      "",
      "# Optional (blank = unset)",
      "priority: high      # urgent | high | medium | low",
      "size: medium        # small | medium | large",
      "labels: [frontend, auth] # names from issues/yardhand.json, e.g. [backend, auth]",
      "depends-on:         # issue IDs, e.g. [017.01.01, 017.02]",
      "related:            # issue IDs",
      'assignee: "@claude-opus" # "@handle" from issues/yardhand.json, e.g. "@claude-opus"',
      "effort: xhigh       # free text, one word, e.g. low | medium | high | xhigh",
      "released-in:        # set by `release`",
      "---",
      "",
      "# Add login form",
      "",
      "## Description",
      "<!-- What and why. A buildable unit should fit one model session. -->",
      "",
      "## Acceptance criteria",
      "<!-- Checkable outcomes, one per line, as checkboxes: - [ ] ... -->",
      "- [ ]",
      "",
    ].join("\n"),
  );
  assert.ok(r.notes.some((n) => /Assignee normalized: "claude-opus" -> @claude-opus/.test(n)));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(check(root).errors, []);
});

test("template: the H1 title drops the bug- prefix and is sentence case", () => {
  assert.equal(titleFromSlug("add-login-form"), "Add login form");
  const root = team();
  const r = newIssue(root, { slug: "bug-login-redirect-loop" });
  assert.match(read(root, r.path), /^# Login redirect loop$/m);
});

test("lists: [a, b] is written, and the old comma form still reads", () => {
  assert.deepEqual(splitList("[001, 002]"), ["001", "002"]);
  assert.deepEqual(splitList("001, 002"), ["001", "002"]);
  assert.deepEqual(splitList("[]"), []);
  assert.deepEqual(splitList("['a', \"b\", a]"), ["a", "b"]);
  const root = team();
  newIssue(root, { slug: "one" });
  const two = newIssue(root, { slug: "two", dependsOn: ["001"] });
  writeFileSync(join(root, two.path), read(root, two.path).replace(/^depends-on:.*$/m, "depends-on: 001"));
  assert.deepEqual(validate(root), [], "0.2-style lists stay valid");
  assert.deepEqual(listIssues(root, {}).find((r) => r.id === "002")?.dependsOn, ["001"]);
});

test("set: keeps both group comments and every field comment, and writes lists and handles", () => {
  const root = team();
  const r = newIssue(root, { slug: "add-auth" });
  const before = read(root, r.path);
  setIssue(root, "001", { priority: "urgent", size: "large", labels: "backend,auth", assignee: "ryan", related: "none" });
  const after = read(root, r.path);
  assert.match(after, /^# Required$/m);
  assert.match(after, /^# Optional \(blank = unset\)$/m);
  for (const comment of before.match(/# [^\n]+/g)!) assert.ok(after.includes(comment), comment);
  assert.match(after, /^priority: urgent    # urgent/m, "comment stays in its column");
  assert.match(after, /^labels: \[backend, auth\] # names/m);
  assert.match(after, /^assignee: "@ryan" +#/m);
  assert.deepEqual(validate(root), []);
  const cleared = setIssue(root, "001", { labels: "none", assignee: "none", size: "none" });
  assert.deepEqual(cleared.changes.map((c) => c.to), ["none", "none", "none"]);
  assert.match(read(root, r.path), /^labels: +# names/m);
});

test("move and release keep the front matter comments", () => {
  const root = team();
  const r = newIssue(root, { slug: "add-auth" });
  moveIssue(root, "001", "done");
  release(root, "1.0.0");
  const text = read(root, "issues/done/001-add-auth/ISSUE.md");
  assert.match(text, /^# Required$/m);
  assert.match(text, /^status: done +# must match the folder$/m);
  assert.match(text, /^released-in: 1\.0\.0 +# set by `release`$/m);
  void r;
});

test("assignee: must be a registered @handle, written quoted", () => {
  const root = team();
  assert.throws(() => newIssue(root, { slug: "a", assignee: "@nobody" }), /not in issues\/yardhand\.json/);
  assert.throws(() => newIssue(root, { slug: "a", assignee: "GPT-6.1 Sol" }), /must be a handle/);
  const r = newIssue(root, { slug: "a", assignee: "@ryan" });
  assert.deepEqual(r.notes, [], "nothing to normalize");
  // Hand edits: unquoted, unknown, and free text are all errors that say how to fix them.
  const p = r.path;
  writeFileSync(join(root, p), read(root, p).replace('"@ryan"', "@ryan"));
  assert.match(validate(root).map((e) => e.message).join("\n"), /must be in quotes/);
  writeFileSync(join(root, p), read(root, p).replace(/^assignee:.*$/m, 'assignee: "@ghost"'));
  assert.match(validate(root).map((e) => e.message).join("\n"), /@ghost is not listed under "assignees"/);
  writeFileSync(join(root, p), read(root, p).replace(/^assignee:.*$/m, "assignee: Ryan H"));
  assert.match(validate(root).map((e) => e.message).join("\n"), /must be a handle/);
  assert.deepEqual(listIssues(root, { assignee: "ghost" }), []);
});

test("labels: must be defined in yardhand.json, with no repeats", () => {
  const root = team();
  assert.throws(() => newIssue(root, { slug: "a", labels: ["front-end"] }), /"front-end" is not in issues\/yardhand\.json/);
  const r = newIssue(root, { slug: "a", labels: ["backend", "backend"] });
  assert.equal(fields(root, r.path)["labels"], "[backend]", "repeats on the command line are dropped");
  newIssue(root, { slug: "b", labels: ["frontend"] });
  assert.deepEqual(listIssues(root, { label: "backend" }).map((x) => x.id), ["001"]);
  writeFileSync(join(root, r.path), read(root, r.path).replace(/^labels:.*$/m, "labels: [backend, backend, Ops]"));
  const msgs = validate(root).map((e) => e.message).join("\n");
  assert.match(msgs, /more than once/);
  assert.match(msgs, /"Ops" must be lowercase kebab-case/);
});

test("size: values, list filter, and the parent and large warnings", () => {
  const root = team();
  assert.throws(() => newIssue(root, { slug: "a", size: "huge" }), /--size must be one of/);
  newIssue(root, { slug: "add-auth", size: "large" }); // 001, no children yet
  assert.deepEqual(check(root).warnings.map((w) => w.rule), ["size-large"]);
  newIssue(root, { slug: "add-login", parent: "001", size: "small" });
  assert.deepEqual(check(root).warnings.map((w) => w.rule), ["size-on-parent"]);
  assert.deepEqual(listIssues(root, { size: "small" }).map((x) => x.id), ["001.01"]);
  setIssue(root, "001", { size: "none" });
  newIssue(root, { slug: "big", size: "large" }); // 002
  moveIssue(root, "002", "done");
  assert.deepEqual(check(root).warnings, [], "a finished large issue is fine");
});

test("effort: one word, and a warning when no model will use it", () => {
  const root = team();
  assert.throws(() => newIssue(root, { slug: "a", effort: "very high" }), /must be one word/);
  assert.throws(() => newIssue(root, { slug: "a", effort: "$(rm -rf ~)" }), /must be one word/);
  const a = newIssue(root, { slug: "a", effort: "high" });
  assert.match(a.warnings[0] ?? "", /no assignee/);
  const s = setIssue(root, "001", { assignee: "@ryan" });
  assert.match(s.warnings[0] ?? "", /assigned to a person/);
  assert.deepEqual(setIssue(root, "001", { assignee: "@gpt-6-1-sol" }).warnings, []);
  assert.deepEqual(check(root).warnings, []);
  setIssue(root, "001", { assignee: "none" });
  assert.deepEqual(check(root).warnings.map((w) => w.rule), ["effort-no-model"]);
  assert.equal(listIssues(root, {}).find((x) => x.id === "001")?.effort, "high");
});

test("validate: unchecked acceptance criteria on done issues are a warning", () => {
  assert.equal(uncheckedCriteria("## Acceptance criteria\n- [ ]\n- [x] done\n- [ ] open\n* [ ] also open\n\n## Notes\n- [ ] not counted\n"), 2);
  assert.equal(uncheckedCriteria("## Acceptance criteria\n```\n- [ ] in a code block\n```\n"), 0);
  const root = team();
  const r = newIssue(root, { slug: "add-auth" });
  writeFileSync(join(root, r.path), read(root, r.path).replace(/- \[ \]$/m, "- [x] Form renders\n- [ ] Error shows on bad password"));
  assert.deepEqual(check(root).warnings, [], "only done issues are checked");
  moveIssue(root, "001", "done");
  const w = check(root).warnings;
  assert.equal(w[0]?.rule, "unchecked-criteria");
  assert.match(w[0]?.message ?? "", /001 is done but has 1 unchecked acceptance criterion/);
  assert.deepEqual(check(root).errors, []);
});

test("roadmap: size tags on open leaves and a large-left count on parents", () => {
  const root = team();
  newIssue(root, { slug: "add-auth" });
  newIssue(root, { slug: "add-login", parent: "001", size: "large" });
  newIssue(root, { slug: "add-logout", parent: "001", size: "small" });
  const text = buildRoadmap(readIssues(root, scan(root, loadConfig(root))));
  assert.match(text, /^## 001  add-auth · 0 of 2 done · 1 large left · backlog$/m);
  assert.match(text, /^- \[ \] 001\.01  add-login · large · backlog$/m);
  assert.match(text, /^- \[ \] 001\.02  add-logout · small · backlog$/m);
});

test("config: labels and assignees are checked", () => {
  const root = team();
  const cfg = join(root, "issues/yardhand.json");
  writeFileSync(cfg, JSON.stringify({ statuses: STATUSES, labels: ["Back End"], assignees: { "gpt-6.1": "model", "@x": "robot" } }));
  const msg = validate(root)[0]?.message ?? "";
  assert.match(msg, /Label "Back End" must be lowercase kebab-case/);
  assert.match(msg, /Assignee "gpt-6\.1" must be @ then lowercase kebab-case/);
  assert.match(msg, /Assignee "@x" must be "person", "model"/);
});

test("init: ready is a default status, and the old todo is no longer offered", () => {
  assert.deepEqual(DEFAULT_STATUSES, ["backlog", "ready", "in-progress", "done"]);
  assert.ok((OPTIONAL_STATUSES as readonly string[]).includes("ready"));
  assert.ok(!(OPTIONAL_STATUSES as readonly string[]).includes("todo"));
  assert.deepEqual(orderStatuses(["ready", "in-progress"], []), ["backlog", "ready", "in-progress", "done"]);
});

test("init: appends issues/ to existing ignore files only, once", () => {
  const root = mkdtempSync(join(tmpdir(), "yardhand-ignore-"));
  writeFileSync(join(root, ".npmignore"), "node_modules"); // no trailing newline
  writeFileSync(join(root, ".dockerignore"), "/issues/\n");
  const r = init(root, DEFAULT_STATUSES, "0.0.0");
  assert.deepEqual(r.ignoreFiles, [".npmignore"]);
  assert.equal(read(root, ".npmignore"), "node_modules\nissues/\n");
  assert.equal(read(root, ".dockerignore"), "/issues/\n", "already listed, untouched");
  assert.ok(!existsSync(join(root, ".gitignore")), "never touches .gitignore");
  const again = init(root, DEFAULT_STATUSES, "0.0.0", true);
  assert.deepEqual(again.ignoreFiles, []);
  const off = mkdtempSync(join(tmpdir(), "yardhand-ignore-off-"));
  writeFileSync(join(off, ".npmignore"), "x\n");
  init(off, DEFAULT_STATUSES, "0.0.0", false, { ignore: false });
  assert.equal(read(off, ".npmignore"), "x\n");
});

test("init: creates the CI workflow in a git repo, pinned, and never overwrites", () => {
  const plain = mkdtempSync(join(tmpdir(), "yardhand-ci-plain-"));
  assert.equal(init(plain, DEFAULT_STATUSES, "1.2.3").workflow, null, "not a git repo");
  const root = mkdtempSync(join(tmpdir(), "yardhand-ci-"));
  mkdirSync(join(root, ".git"));
  const r = init(root, DEFAULT_STATUSES, "1.2.3");
  assert.equal(r.workflow, WORKFLOW_FILE);
  const yml = read(root, WORKFLOW_FILE);
  assert.match(yml, /^on: \[push, pull_request\]$/m);
  assert.match(yml, /run: npx --yes yardhand@1\.2\.3 validate/);
  writeFileSync(join(root, WORKFLOW_FILE), "mine\n");
  assert.equal(init(root, DEFAULT_STATUSES, "9.9.9", true).workflow, null);
  assert.equal(read(root, WORKFLOW_FILE), "mine\n");
  const off = mkdtempSync(join(tmpdir(), "yardhand-ci-off-"));
  mkdirSync(join(off, ".git"));
  assert.equal(init(off, DEFAULT_STATUSES, "1.2.3", false, { ci: false }).workflow, null);
});

test("init --force keeps labels and assignees", () => {
  const root = team();
  init(root, ["backlog", "done"], "0.0.0", true);
  const cfg = loadConfig(root);
  assert.deepEqual(cfg.statuses, ["backlog", "done"]);
  assert.deepEqual(cfg.labels, ["backend", "frontend", "auth"]);
  assert.deepEqual(Object.keys(cfg.assignees), ["@ryan", "@claude-opus", "@gpt-6-1-sol"]);
  assert.match(read(root, "issues/yardhand.json"), /"@ryan": "person"/, "short form kept");
  assert.match(read(root, "issues/yardhand.json"), /"run": "codex exec"/);
});

test("validate: warns when issues/ could be published or copied into an image", () => {
  const root = team();
  assert.deepEqual(shipRisks(root), [], "no package.json or Dockerfile, no warning");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
  assert.match(shipRisks(root)[0]?.message ?? "", /could be published by npm/);
  writeFileSync(join(root, ".npmignore"), "issues\n");
  assert.deepEqual(shipRisks(root), []);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", files: ["dist", "issues/"] }));
  assert.match(shipRisks(root)[0]?.message ?? "", /"files" includes issues\//);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x", files: ["dist"] }));
  assert.deepEqual(shipRisks(root), []);
  writeFileSync(join(root, "Dockerfile"), "FROM node\nCOPY . .\n");
  assert.match(shipRisks(root)[0]?.message ?? "", /copied into a Docker image/);
  writeFileSync(join(root, ".dockerignore"), "issues/**\n");
  assert.deepEqual(shipRisks(root), []);
  assert.deepEqual(check(root).errors, [], "ship risks are warnings only");
});

test("CLI: new, set, list with the 0.3 flags, and warnings go to stderr", () => {
  const bin = resolve("dist/cli.js");
  const root = team();
  const run = (...args: string[]) => spawnSync("node", [bin, ...args], { cwd: root, encoding: "utf8" });
  const n = run("new", "add-auth", "--size", "small", "--labels", "backend,auth", "--assignee", "ryan", "--effort", "high");
  assert.equal(n.status, 0, n.stderr);
  assert.match(n.stdout, /Assignee normalized/);
  assert.match(n.stderr, /^Warning: 001 has effort but is assigned to a person/m);
  assert.equal(run("set", "001", "--assignee", "@claude-opus").stderr, "");
  const l = JSON.parse(run("list", "--label", "auth", "--size", "small", "--assignee", "claude-opus", "--json").stdout);
  assert.equal(l.length, 1);
  assert.deepEqual(l[0].labels, ["backend", "auth"]);
  assert.equal(l[0].effort, "high");
  assert.match(run("new", "--help").stdout, /--effort <word>/);
  assert.match(run("init", "--help").stdout, /--no-ci/);
  assert.equal(run("validate").stdout.trim(), "OK");
});
