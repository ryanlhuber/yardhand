import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { check, init, moveIssue, newIssue, validate } from "../src/commands.js";
import { setIssue } from "../src/set.js";
import { formatTable, listIssues } from "../src/list.js";
import { buildRoadmap, roadmap } from "../src/roadmap.js";
import { release } from "../src/release.js";
import { readIssues } from "../src/issues.js";
import { scan } from "../src/scan.js";
import { loadConfig } from "../src/config.js";
import { compareSemver, normalizeName, priorityRank } from "../src/ids.js";
import { orderStatuses, parseCustomStatuses, reorderStep } from "../src/prompts.js";
import { upsertField, parseFrontMatter } from "../src/frontmatter.js";

const bin = resolve("dist/cli.js");
function repo(statuses = ["backlog", "in-progress", "done"]): string {
  const root = mkdtempSync(join(tmpdir(), "yardhand-c-"));
  init(root, statuses, "0.0.0");
  return root;
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const fields = (root: string, p: string) => parseFrontMatter(read(root, p))!.fields;
const cli = (root: string, ...args: string[]) => spawnSync("node", [bin, ...args], { cwd: root, encoding: "utf8" });

// ---- names

test("normalizeName: trims, lowercases, and turns spaces and underscores into one dash", () => {
  assert.equal(normalizeName("Review 1"), "review-1");
  assert.equal(normalizeName("  Merge  Ready_Now "), "merge-ready-now");
  assert.equal(normalizeName("in-progress"), "in-progress");
});

test("custom statuses: commas or semicolons, normalized, and clear errors", () => {
  assert.deepEqual(parseCustomStatuses("review 1, review 2").names, ["review-1", "review-2"]);
  assert.deepEqual(parseCustomStatuses("Review 1; review 2;").names, ["review-1", "review-2"]);
  assert.match(parseCustomStatuses("backlog").error!, /always included/);
  assert.match(parseCustomStatuses("a, A").error!, /more than once/);
  assert.match(parseCustomStatuses("review", ["review"]).error!, /more than once/);
  assert.match(parseCustomStatuses("qa/review").error!, /letters, numbers/);
  assert.match(parseCustomStatuses("releases").error!, /reserved/);
});

test("default status order is workflow order with custom statuses last", () => {
  assert.deepEqual(orderStatuses(["review", "triage"], ["qa-check"]), ["triage", "backlog", "review", "done", "qa-check"]);
  assert.deepEqual(orderStatuses([], []), ["backlog", "done"]);
});

test("reorder: grab and move, digit jump, and clamping", () => {
  let s = { items: ["a", "b", "c", "d"], cursor: 3, grabbed: false };
  s = reorderStep(s, "up");
  assert.deepEqual(s.items, ["a", "b", "c", "d"], "moving the cursor does not reorder");
  assert.equal(s.cursor, 2);
  s = reorderStep(s, "space");
  s = reorderStep(s, "up");
  assert.deepEqual(s.items, ["a", "c", "b", "d"]);
  s = reorderStep(s, { digit: 1 });
  assert.deepEqual(s.items, ["c", "a", "b", "d"]);
  assert.equal(s.cursor, 0);
  s = reorderStep(s, { digit: 9 });
  assert.deepEqual(s.items, ["a", "b", "d", "c"], "a digit past the end goes to the last slot");
  s = reorderStep(reorderStep(s, "space"), { digit: 1 });
  assert.deepEqual(s.items, ["a", "b", "d", "c"], "digits do nothing unless an item is grabbed");
});

test("semver comparison and priority rank", () => {
  assert.ok(compareSemver("1.4.0", "1.3.9") > 0);
  assert.ok(compareSemver("1.0.0-alpha", "1.0.0") < 0);
  assert.ok(compareSemver("1.0.0-alpha.2", "1.0.0-alpha.10") < 0);
  assert.equal(compareSemver("1.0.0+build", "1.0.0"), 0);
  assert.ok(priorityRank("urgent") < priorityRank("low") && priorityRank("low") < priorityRank(""));
});

// ---- init

test("init: statuses may go before backlog, and 000 always starts in backlog", () => {
  const root = repo(["triage", "backlog", "todo", "done", "canceled"]);
  assert.deepEqual(loadConfig(root).statuses, ["triage", "backlog", "todo", "done", "canceled"]);
  assert.ok(existsSync(join(root, "issues/backlog/000-maintain-repo/ISSUE.md")));
  assert.equal(fields(root, "issues/backlog/000-maintain-repo/ISSUE.md")["kind"], "feature");
  assert.equal(newIssue(root, { slug: "add-auth" }).status, "triage", "new issues start in the first status");
  assert.deepEqual(validate(root), []);
});

test("init: releases cannot be a status, and the config needs backlog and done", () => {
  const fresh = () => mkdtempSync(join(tmpdir(), "yardhand-c-"));
  assert.throws(() => init(fresh(), ["backlog", "releases", "done"], "0.0.0"), /reserved/);
  assert.throws(() => init(fresh(), ["backlog", "review"], "0.0.0"), /must include "done"/);
});

// ---- new

test("new: default kind follows depth, and the template lists every field with hints", () => {
  const root = repo();
  const a = newIssue(root, { slug: "add-auth" });
  const b = newIssue(root, { slug: "add-login", parent: "001" });
  assert.equal(a.kind, "feature");
  assert.equal(b.kind, "task");
  const text = read(root, a.path);
  for (const key of ["priority:", "depends-on:", "related:", "assignee:", "released-in:"]) assert.match(text, new RegExp(`^${key}$`, "m"));
  assert.match(text, /<!-- What and why\./);
  assert.match(text, /<!-- Checkable outcomes/);
  assert.doesNotMatch(text, /^parent:/m);
});

test("new: --kind bug adds the prefix, a typed bug- prefix converts, and conflicts fail", () => {
  const root = repo();
  const a = newIssue(root, { slug: "login-loop", kind: "bug" });
  assert.equal(a.path, "issues/backlog/001-bug-login-loop/ISSUE.md");
  const b = newIssue(root, { slug: "bug-token-expiry" });
  assert.equal(b.path, "issues/backlog/002-bug-token-expiry/ISSUE.md");
  assert.equal(b.kind, "bug");
  assert.ok(b.notes.some((n) => /Converted/.test(n)));
  assert.throws(() => newIssue(root, { slug: "bug-x", kind: "task" }), /--kind is task/);
  assert.throws(() => newIssue(root, { slug: "bug-bug-x" }), /kebab-case/);
  assert.throws(() => newIssue(root, { slug: "x", kind: "story" }), /--kind must be/);
  assert.deepEqual(validate(root), []);
});

test("new: slug is normalized and the change is reported; priority words are enforced", () => {
  const root = repo();
  const r = newIssue(root, { slug: "  Add_Auth Flow ", priority: "High" });
  assert.equal(r.path, "issues/backlog/001-add-auth-flow/ISSUE.md");
  assert.ok(r.notes.some((n) => /normalized/.test(n)));
  assert.equal(fields(root, r.path)["priority"], "high");
  assert.throws(() => newIssue(root, { slug: "x", priority: "1" }), /urgent, high, medium, low/);
});

test("new: summary line and notes are printed by the CLI", () => {
  const root = repo();
  const r = cli(root, "new", "Login Loop", "--kind", "bug", "--priority", "urgent");
  assert.equal(r.status, 0, r.stderr);
  const [first, second, third] = r.stdout.split("\n");
  assert.equal(first, "001  issues/backlog/001-bug-login-loop/ISSUE.md");
  assert.equal(second!.trim(), "bug · urgent · backlog");
  assert.match(third!, /Slug normalized/);
});

// ---- move

test("move: normalizes the status name, is a no-op in the same status, and names the children it left", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  newIssue(root, { slug: "add-login", parent: "001" });
  newIssue(root, { slug: "add-logout", parent: "001" });
  const r = moveIssue(root, "001", "In Progress");
  assert.equal(r.unchanged, false);
  assert.deepEqual(r.children, ["001.01", "001.02"]);
  assert.ok(r.notes.some((n) => /normalized/.test(n)));
  assert.equal(moveIssue(root, "001", "in-progress").unchanged, true);
  assert.equal(fields(root, "issues/in-progress/001-add-auth/ISSUE.md")["status"], "in-progress");
  assert.ok(existsSync(join(root, "issues/backlog/001.01-add-login")), "children stay where they were");
});

test("move: the bug- prefix survives a move, and the CLI prints the no-op and children lines", () => {
  const root = repo();
  newIssue(root, { slug: "login-loop", kind: "bug" });
  moveIssue(root, "001", "done");
  assert.ok(existsSync(join(root, "issues/done/001-bug-login-loop/ISSUE.md")));
  const again = cli(root, "move", "001", "done");
  assert.equal(again.status, 0);
  assert.match(again.stdout, /Already in done\. Nothing changed\./);
  newIssue(root, { slug: "add-auth" });
  newIssue(root, { slug: "add-login", parent: "002" });
  assert.match(cli(root, "move", "002", "done").stdout, /1 child not moved \(002\.01\)/);
});

// ---- set

test("set: kind renames the folder, priority does not, and none clears", () => {
  const root = repo();
  newIssue(root, { slug: "login-loop" });
  newIssue(root, { slug: "add-login", parent: "001" });
  const k = setIssue(root, "001.01", { kind: "bug" });
  assert.equal(k.path, "issues/backlog/001.01-bug-add-login");
  assert.ok(existsSync(join(root, "issues/backlog/001.01-bug-add-login/ISSUE.md")));
  const p = setIssue(root, "001.01", { priority: "urgent" });
  assert.equal(p.path, "issues/backlog/001.01-bug-add-login", "priority never renames a folder");
  assert.equal(fields(root, "issues/backlog/001.01-bug-add-login/ISSUE.md")["priority"], "urgent");
  setIssue(root, "001.01", { priority: "none", kind: "task" });
  const f = fields(root, "issues/backlog/001.01-add-login/ISSUE.md");
  assert.equal(f["priority"], "");
  assert.equal(f["kind"], "task");
  assert.match(read(root, "issues/backlog/001.01-add-login/ISSUE.md"), /^priority:$/m, "cleared fields have no trailing space");
  assert.deepEqual(validate(root), []);
});

test("set: setting a field to its current value changes nothing", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth", priority: "high" });
  const r = setIssue(root, "001", { priority: "high", assignee: "none" });
  assert.equal(r.unchanged, true);
  assert.equal(cli(root, "set", "001", "--priority", "high").stdout.trim(), "Nothing changed.");
  assert.equal(cli(root, "set", "001").status, 1, "at least one flag is required");
});

test("set: every change is validated before anything is written", () => {
  const root = repo();
  newIssue(root, { slug: "one" });
  newIssue(root, { slug: "two" });
  newIssue(root, { slug: "piece", parent: "001" });
  const before = read(root, "issues/backlog/001.01-piece/ISSUE.md");
  assert.throws(() => setIssue(root, "001", { parent: "002" }), /level-1/);
  assert.throws(() => setIssue(root, "001.01", { parent: "none" }), /must have a parent/);
  assert.throws(() => setIssue(root, "001.01", { parent: "077" }), /does not exist/);
  assert.throws(() => setIssue(root, "001.01", { parent: "001.01" }), /shallower/);
  assert.throws(() => setIssue(root, "001.01", { dependsOn: "001.01" }), /itself/);
  assert.throws(() => setIssue(root, "001.01", { dependsOn: "099" }), /does not exist/);
  assert.throws(() => setIssue(root, "001.01", { priority: "asap" }), /urgent, high/);
  assert.throws(() => setIssue(root, "001.01", { releasedIn: "v1" }), /semver/);
  assert.throws(() => setIssue(root, "001.01", { assignee: "a # b" }), /assignee/);
  assert.throws(() => setIssue(root, "001.01", { kind: "story" }), /--kind must be/);
  assert.throws(() => setIssue(root, "042", { priority: "low" }), /not found/);
  assert.equal(read(root, "issues/backlog/001.01-piece/ISSUE.md"), before);
  // A valid parent change keeps the folder and the ID.
  setIssue(root, "001.01", { parent: "002" });
  assert.ok(existsSync(join(root, "issues/backlog/001.01-piece/ISSUE.md")));
  assert.equal(fields(root, "issues/backlog/001.01-piece/ISSUE.md")["parent"], "002");
  assert.deepEqual(validate(root), []);
});

test("set: lists replace, and a depends-on loop is refused", () => {
  const root = repo();
  for (const slug of ["a-one", "a-two", "a-three"]) newIssue(root, { slug });
  setIssue(root, "001", { dependsOn: "002, 003" });
  assert.equal(fields(root, "issues/backlog/001-a-one/ISSUE.md")["depends-on"], "002, 003");
  setIssue(root, "001", { dependsOn: "002" });
  assert.equal(fields(root, "issues/backlog/001-a-one/ISSUE.md")["depends-on"], "002");
  setIssue(root, "002", { dependsOn: "003" });
  assert.throws(() => setIssue(root, "003", { dependsOn: "001" }), /loop/);
  setIssue(root, "001", { dependsOn: "none", related: "003" });
  assert.equal(fields(root, "issues/backlog/001-a-one/ISSUE.md")["depends-on"], "");
  assert.deepEqual(validate(root), []);
});

test("set: adds a field an older issue file does not have", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  writeFileSync(join(root, p), read(root, p).replace("priority:\n", ""));
  setIssue(root, "001", { priority: "low" });
  assert.equal(fields(root, p)["priority"], "low");
  assert.equal(upsertField("---\nid: 1\n---\n", "x", "").split("\n")[2], "x:", "an empty value leaves no trailing space");
});

// ---- list

test("list: sorted urgent first, filterable, and JSON", () => {
  const root = repo();
  newIssue(root, { slug: "plain-one" });
  newIssue(root, { slug: "low-one", priority: "low" });
  newIssue(root, { slug: "urgent-one", priority: "urgent" });
  newIssue(root, { slug: "child-bug", parent: "003", kind: "bug", priority: "high" });
  moveIssue(root, "002", "done");
  assert.deepEqual(listIssues(root).map((r) => r.id), ["003", "003.01", "002", "000", "001"]);
  assert.deepEqual(listIssues(root, { status: "Done" }).map((r) => r.id), ["002"]);
  assert.deepEqual(listIssues(root, { kind: "bug" }).map((r) => r.id), ["003.01"]);
  assert.deepEqual(listIssues(root, { priority: "urgent" }).map((r) => r.id), ["003"]);
  assert.deepEqual(listIssues(root, { parent: "003" }).map((r) => r.id), ["003.01"]);
  assert.throws(() => listIssues(root, { status: "nope" }), /Unknown status/);
  assert.throws(() => listIssues(root, { parent: "042" }), /not found/);
  assert.match(formatTable(listIssues(root)), /^urgent {2}003 {5}feature {2}backlog {2}urgent-one$/m);
  const json = JSON.parse(cli(root, "list", "--parent", "003", "--json").stdout);
  assert.equal(json[0].id, "003.01");
  assert.equal(json[0].slug, "child-bug");
  assert.equal(json[0].kind, "bug");
});

// ---- roadmap

function sampleTree(): string {
  const root = repo(["backlog", "in-progress", "done", "canceled"]);
  newIssue(root, { slug: "add-auth" }); // 001
  newIssue(root, { slug: "add-login", parent: "001" }); // 001.01
  newIssue(root, { slug: "login-loop", parent: "001.01", kind: "bug", priority: "high" }); // 001.01.01
  newIssue(root, { slug: "add-form", parent: "001.01" }); // 001.01.02
  newIssue(root, { slug: "drop-idea", parent: "001.01" }); // 001.01.03
  moveIssue(root, "001.01.02", "done");
  moveIssue(root, "001.01.03", "canceled");
  moveIssue(root, "001.01.01", "in-progress");
  return root;
}

test("roadmap: tree from parent fields, progress counts, and tags", () => {
  const root = sampleTree();
  const text = buildRoadmap(readIssues(root, scan(root, loadConfig(root))));
  assert.match(text, /^## 001 {2}add-auth · 1 of 3 done · backlog$/m);
  assert.match(text, /^- \[ \] 001\.01 {2}add-login · 1 of 2 done · backlog$/m);
  assert.match(text, /^ {2}- \[ \] 001\.01\.01 {2}login-loop · bug · high · in-progress$/m);
  assert.match(text, /^ {2}- \[x\] 001\.01\.02 {2}add-form$/m);
  assert.match(text, /^ {2}- \[-\] 001\.01\.03 {2}drop-idea · canceled$/m);
});

test("roadmap: follows parent fields when work moved, and is written and compared by validate", () => {
  const root = sampleTree();
  newIssue(root, { slug: "add-billing" }); // 002
  setIssue(root, "001.01", { parent: "002" }); // wrong shape on purpose? level 2 under level 1 is fine
  const r = roadmap(root);
  assert.equal(r.path, "issues/ROADMAP.md");
  const text = read(root, "issues/ROADMAP.md");
  assert.ok(text.indexOf("## 002") < text.indexOf("001.01  add-login"), "001.01 now sits under 002");
  assert.equal(check(root).warnings.length, 0);
  assert.deepEqual(check(root).errors, []);
  setIssue(root, "002", { priority: "low" });
  const c = check(root);
  assert.equal(c.warnings[0]?.rule, "roadmap-stale");
  assert.equal(c.errors.length, 0, "a stale roadmap is only a warning");
  assert.equal(cli(root, "validate").status, 0);
  assert.match(cli(root, "validate").stderr, /ROADMAP\.md is out of date, run yardhand roadmap/);
  assert.equal(roadmap(root, true).path, null, "--stdout writes nothing");
});

// ---- release

test("release: stamps done issues without a version and writes the release file", () => {
  const root = sampleTree();
  const dry = release(root, "1.0.0", true);
  assert.deepEqual(dry.stamped, ["001.01.02"]);
  assert.ok(!existsSync(join(root, "issues/releases")));
  const r = release(root, "1.0.0");
  assert.deepEqual(r.stamped, ["001.01.02"]);
  assert.equal(r.file, "issues/releases/1.0.0.md");
  assert.equal(fields(root, "issues/done/001.01.02-add-form/ISSUE.md")["released-in"], "1.0.0");
  const file = read(root, "issues/releases/1.0.0.md");
  assert.match(file, /^# Release 1\.0\.0$/m);
  assert.match(file, /^Date: \d{4}-\d{2}-\d{2}$/m);
  assert.match(file, /^## 001 {2}add-auth$/m);
  assert.match(file, /^- 001\.01\.02 {2}add-form$/m);
  assert.equal(fields(root, "issues/in-progress/001.01.01-bug-login-loop/ISSUE.md")["released-in"], "", "other statuses are never stamped");
  assert.equal(fields(root, "issues/canceled/001.01.03-drop-idea/ISSUE.md")["released-in"], "");
  assert.deepEqual(validate(root), [], "the releases folder is allowed");
});

test("release: the same version twice fails, earlier versions are never overwritten, nothing to release is fine", () => {
  const root = sampleTree();
  release(root, "1.0.0");
  assert.throws(() => release(root, "1.0.0"), /already released/);
  const none = release(root, "1.1.0");
  assert.deepEqual(none.stamped, []);
  assert.equal(none.file, null);
  assert.ok(none.notes.includes("Nothing to release."));
  assert.ok(!existsSync(join(root, "issues/releases/1.1.0.md")));
  moveIssue(root, "001.01.01", "done");
  const next = release(root, "1.0.1");
  assert.deepEqual(next.stamped, ["001.01.01"], "the earlier release's issue is not touched");
  assert.equal(fields(root, "issues/done/001.01.02-add-form/ISSUE.md")["released-in"], "1.0.0");
  const lower = release(root, "0.9.0", true);
  assert.deepEqual(lower.stamped, []);
  assert.throws(() => release(root, "v1.2.0"), /not valid semver/);
});

test("release: a version lower than an existing one only warns", () => {
  const root = sampleTree();
  release(root, "2.0.0");
  moveIssue(root, "001.01.01", "done");
  const r = release(root, "1.5.0");
  assert.deepEqual(r.stamped, ["001.01.01"]);
  assert.ok(r.notes.some((n) => /lower than the existing release 2\.0\.0/.test(n)));
});

// ---- validate

test("validate: bug prefix, reserved prefix, kind values, and slug length", () => {
  const root = repo();
  newIssue(root, { slug: "login-loop", kind: "bug" });
  newIssue(root, { slug: "add-auth" });
  const bug = "issues/backlog/001-bug-login-loop/ISSUE.md";
  writeFileSync(join(root, bug), read(root, bug).replace("kind: bug", "kind: task"));
  const auth = "issues/backlog/002-add-auth/ISSUE.md";
  writeFileSync(join(root, auth), read(root, auth).replace("kind: feature", "kind: bug"));
  mkdirSync(join(root, "issues/backlog/003-bug-bug-twice"));
  writeFileSync(join(root, "issues/backlog/003-bug-bug-twice/ISSUE.md"), "---\nid: 003\nkind: bug\nstatus: backlog\n---\n");
  const rules = check(root).errors.map((e) => e.rule);
  assert.equal(rules.filter((r) => r === "bug-prefix").length, 2);
  assert.ok(rules.includes("reserved-prefix"));
  const msgs = check(root).errors.map((e) => e.message).join("\n");
  assert.match(msgs, /yardhand set 001 --kind task/);
  assert.match(msgs, /yardhand set 002 --kind bug/);

  const root2 = repo();
  newIssue(root2, { slug: "a".repeat(41) });
  const c = check(root2);
  assert.deepEqual(c.errors, []);
  assert.equal(c.warnings[0]?.rule, "slug-length");
  const r = cli(root2, "validate");
  assert.equal(r.status, 0, "a warning does not fail validation");
  assert.match(r.stderr, /0 problems, 1 warning\./);
});

test("validate: old priority words fail with the allowed list, and feature is a valid kind", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  writeFileSync(join(root, p), read(root, p).replace("priority:", "priority: 2"));
  assert.match(check(root).errors[0]!.message, /priority "2" must be one of: urgent, high, medium, low/);
  writeFileSync(join(root, p), read(root, p).replace("priority: 2", "priority: medium"));
  assert.deepEqual(validate(root), []);
});

test("validate --json: errors and warnings with path, rule and message", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const ok = JSON.parse(cli(root, "validate", "--json").stdout);
  assert.deepEqual(ok, { ok: true, errors: [], warnings: [] });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  writeFileSync(join(root, p), read(root, p).replace("kind: feature", "kind: story"));
  const r = cli(root, "validate", "--json");
  assert.equal(r.status, 1);
  const bad = JSON.parse(r.stdout);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].rule, "kind");
  assert.match(bad.errors[0].path, /001-add-auth\/ISSUE\.md$/);
  assert.match(bad.errors[0].message, /kind must be/);
});

// ---- help

test("every command answers --help with its own usage", () => {
  const root = repo();
  for (const c of ["init", "new", "move", "set", "list", "roadmap", "release", "validate"]) {
    const r = cli(root, c, "--help");
    assert.equal(r.status, 0, c);
    assert.match(r.stdout, new RegExp(`^yardhand ${c}`), c);
  }
  assert.match(cli(root, "new", "--help").stdout, /--assignee/);
  assert.match(cli(root, "--help").stdout, /yardhand release <semver>/);
});

// ---- review fixes (0.2.1)

test("set --kind repairs a folder whose bug- prefix disagrees with an already-correct kind", () => {
  const root = repo();
  newIssue(root, { slug: "fix-login" });
  const f = join(root, "issues/backlog/001-fix-login/ISSUE.md");
  writeFileSync(f, read(root, "issues/backlog/001-fix-login/ISSUE.md").replace(/^kind: .*/m, "kind: bug"));
  assert.ok(validate(root).some((e) => /bug-/.test(e.message)));
  const r = setIssue(root, "001", { kind: "bug" });
  assert.equal(r.unchanged, false);
  assert.ok(existsSync(join(root, "issues/backlog/001-bug-fix-login/ISSUE.md")));
  assert.deepEqual(validate(root), []);
  // Running it again is a real no-op.
  assert.equal(setIssue(root, "001", { kind: "bug" }).unchanged, true);
});

test("validate: a loose file in issues/ is an error, ROADMAP.md and the config are not", () => {
  const root = repo();
  roadmap(root);
  assert.deepEqual(validate(root), []);
  writeFileSync(join(root, "issues/garbage.txt"), "x");
  const errs = validate(root);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!.message, /Unexpected file/);
});

test("validate: a hand-edited assignee with control characters is an error", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const f = join(root, "issues/backlog/001-add-auth/ISSUE.md");
  writeFileSync(f, read(root, "issues/backlog/001-add-auth/ISSUE.md").replace(/^assignee:.*/m, "assignee: bad name"));
  assert.ok(validate(root).some((e) => /assignee/.test(e.message)));
});

test("<command> --help with extra arguments is an error", () => {
  const root = repo();
  const bad = cli(root, "new", "--help", "extra");
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Unexpected argument "extra"/);
  assert.equal(cli(root, "new", "--help").status, 0);
});

test("release: rebuilds a missing release file from issues already stamped with that version", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  moveIssue(root, "001", "done");
  release(root, "1.0.0", false);
  const file = join(root, "issues/releases/1.0.0.md");
  rmSync(file);
  const again = release(root, "1.0.0", false);
  assert.equal(again.stamped.length, 0);
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, "utf8"), /001/);
  // With the file back, the version is permanent again.
  assert.throws(() => release(root, "1.0.0", false), /already released/);
});

test("new: builds the folder in staging and leaves no staging folder behind", () => {
  const root = repo();
  const r = newIssue(root, { slug: "add-auth" });
  assert.ok(existsSync(resolve(root, r.path)));
  assert.deepEqual(readdirSync(join(root, "issues/backlog")).filter((n) => n.startsWith(".new-")), []);
  assert.deepEqual(validate(root), []);
});
