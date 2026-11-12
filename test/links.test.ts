import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init, newIssue, validate } from "../src/commands.js";
import { parseFrontMatter } from "../src/frontmatter.js";
import { splitIdList } from "../src/ids.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "yardhand-links-"));
  init(root, ["backlog", "in-progress", "done"], "0.0.0");
  return root;
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const fields = (root: string, p: string) => parseFrontMatter(read(root, p))!.fields;
const messages = (root: string) => validate(root).map((p) => p.message).join("\n");

test("links: splitIdList trims, drops blanks and repeats", () => {
  assert.deepEqual(splitIdList(" 017.02 , ,017.03,017.02 "), ["017.02", "017.03"]);
  assert.deepEqual(splitIdList(""), []);
});

test("links: new writes blank priority, depends-on and related by default", () => {
  const root = repo();
  const { path } = newIssue(root, { slug: "add-auth" });
  const text = read(root, path);
  assert.match(text, /\npriority:\n/);
  assert.match(text, /\ndepends-on:\n/);
  assert.match(text, /\nrelated:\n/);
  assert.deepEqual(validate(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("links: new stores priority, depends-on and related", () => {
  const root = repo();
  newIssue(root, { slug: "one" }); // 001
  newIssue(root, { slug: "two" }); // 002
  const { path } = newIssue(root, {
    slug: "three",
    priority: "2",
    dependsOn: ["001", "002"],
    related: ["001"],
  });
  const f = fields(root, path);
  assert.equal(f["priority"], "2");
  assert.equal(f["depends-on"], "001, 002");
  assert.equal(f["related"], "001");
  assert.deepEqual(validate(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("links: new rejects a bad priority, a bad ID, and an issue that does not exist", () => {
  const root = repo();
  newIssue(root, { slug: "one" });
  assert.throws(() => newIssue(root, { slug: "x", priority: "asap" }), /--priority must be one of/);
  assert.throws(() => newIssue(root, { slug: "x", dependsOn: ["17"] }), /--depends-on: "17" is not a valid ID/);
  assert.throws(() => newIssue(root, { slug: "x", related: ["abc"] }), /--related: "abc" is not a valid ID/);
  assert.throws(() => newIssue(root, { slug: "x", dependsOn: ["009"] }), /--depends-on: issue 009 does not exist/);
  assert.throws(() => newIssue(root, { slug: "x", related: ["009"] }), /--related: issue 009 does not exist/);
  // A failed new must not leave a folder behind or use up an ID.
  assert.equal(newIssue(root, { slug: "next" }).id, "002");
  rmSync(root, { recursive: true, force: true });
});

test("links: issues without the new fields are still valid", () => {
  const root = repo();
  const { path } = newIssue(root, { slug: "old-style" });
  const stripped = read(root, path).replace(/^(priority|depends-on|related):\n/gm, "");
  writeFileSync(join(root, path), stripped);
  assert.deepEqual(validate(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("links: validate reports a bad priority", () => {
  const root = repo();
  const { path } = newIssue(root, { slug: "one" });
  writeFileSync(join(root, path), read(root, path).replace("priority:", "priority: asap"));
  assert.match(messages(root), /priority "asap" must be one of: 1, 2, 3/);
  rmSync(root, { recursive: true, force: true });
});

test("links: validate reports missing targets, bad IDs and self links", () => {
  const root = repo();
  const { path } = newIssue(root, { slug: "one" }); // 001
  const set = (dep: string, rel: string) =>
    writeFileSync(
      join(root, path),
      read(root, path).replace(/^depends-on:.*$/m, `depends-on: ${dep}`).replace(/^related:.*$/m, `related: ${rel}`),
    );
  set("009", "");
  assert.match(messages(root), /depends-on 009 does not exist/);
  set("", "009");
  assert.match(messages(root), /related 009 does not exist/);
  set("17", "");
  assert.match(messages(root), /depends-on "17" is not a valid ID/);
  set("001", "");
  assert.match(messages(root), /depends-on must not list the issue itself \(001\)/);
  set("", "001");
  assert.match(messages(root), /related must not list the issue itself \(001\)/);
  rmSync(root, { recursive: true, force: true });
});

test("links: related may point both ways, depends-on may not loop", () => {
  const root = repo();
  const a = newIssue(root, { slug: "one" }); // 001
  const b = newIssue(root, { slug: "two" }); // 002
  const c = newIssue(root, { slug: "three" }); // 003
  const set = (p: string, dep: string, rel = "") =>
    writeFileSync(
      join(root, p),
      read(root, p).replace(/^depends-on:.*$/m, `depends-on: ${dep}`).replace(/^related:.*$/m, `related: ${rel}`),
    );
  // related both ways is fine
  set(a.path, "", "002");
  set(b.path, "", "001");
  assert.deepEqual(validate(root), []);
  // a chain is fine
  set(a.path, "002");
  set(b.path, "003");
  assert.deepEqual(validate(root), []);
  // a two-issue loop
  set(b.path, "001");
  assert.match(messages(root), /depends-on loop: 001 -> 002 -> 001/);
  // a three-issue loop is reported once
  set(b.path, "003");
  set(c.path, "001");
  const loops = validate(root).filter((p) => /depends-on loop/.test(p.message));
  assert.equal(loops.length, 1);
  assert.match(loops[0]!.message, /001 -> 002 -> 003 -> 001/);
  rmSync(root, { recursive: true, force: true });
});

test("links: CLI new accepts --priority, --depends-on and --related", () => {
  const bin = resolve("dist/cli.js");
  const root = mkdtempSync(join(tmpdir(), "yardhand-links-cli-"));
  const run = (...args: string[]) => spawnSync("node", [bin, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run("init", "--yes").status, 0);
  assert.equal(run("new", "add-auth").status, 0); // 001
  assert.equal(run("new", "add-login").status, 0); // 002
  const r = run("new", "add-ui", "--priority", "1", "--depends-on", "001, 002", "--related", "001");
  assert.equal(r.status, 0, r.stderr);
  const f = fields(root, r.stdout.trim().split(" ")[1]!);
  assert.equal(f["priority"], "1");
  assert.equal(f["depends-on"], "001, 002");
  assert.equal(f["related"], "001");
  assert.equal(run("new", "bad", "--priority", "asap").status, 1);
  assert.equal(run("validate").stdout.trim(), "OK");
  rmSync(root, { recursive: true, force: true });
});

test("prefixes: new adds p and bug prefixes to the folder name", () => {
  const root = repo();
  const a = newIssue(root, { slug: "add-auth", priority: "1" });
  assert.equal(a.path, "issues/backlog/001-p1-add-auth/ISSUE.md");
  const b = newIssue(root, { slug: "login-loop", parent: "001", kind: "bug", priority: "2" });
  assert.equal(b.path, "issues/backlog/001.01-p2-bug-login-loop/ISSUE.md");
  const c = newIssue(root, { slug: "crash", kind: "bug" });
  assert.equal(c.path, "issues/backlog/002-bug-crash/ISSUE.md");
  assert.deepEqual(validate(root), []);
  rmSync(root, { recursive: true, force: true });
});

test("prefixes: new rejects a slug that starts with a reserved word", () => {
  const root = repo();
  for (const slug of ["bug-crash", "p1-add-auth", "p3-x", "bug"]) {
    assert.throws(() => newIssue(root, { slug }), /reserved word/, slug);
  }
  assert.doesNotThrow(() => newIssue(root, { slug: "fix-typo" }));
  rmSync(root, { recursive: true, force: true });
});

test("prefixes: validate reports a prefix that disagrees with front matter", () => {
  const root = repo();
  const a = newIssue(root, { slug: "add-auth", priority: "1" });
  writeFileSync(join(root, a.path), read(root, a.path).replace("priority: 1", "priority:"));
  assert.match(messages(root), /p1- prefix but priority is empty/);
  writeFileSync(join(root, a.path), read(root, a.path).replace("priority:", "priority: 3"));
  assert.match(messages(root), /priority is 3 but the folder name has p1- \(expected p3-\)/);
  const b = newIssue(root, { slug: "crash", kind: "bug" });
  writeFileSync(join(root, b.path), read(root, b.path).replace("kind: bug", "kind: task"));
  assert.match(messages(root), /bug- prefix but kind is not "bug"/);
  writeFileSync(join(root, b.path), read(root, b.path).replace("kind: task", "kind: bug"));
  assert.doesNotMatch(messages(root), /bug-/);
  rmSync(root, { recursive: true, force: true });
});

test("prefixes: a folder with a missing prefix for its kind or priority is reported", () => {
  const root = repo();
  const a = newIssue(root, { slug: "crash", kind: "bug", priority: "2" });
  const dir = join(root, "issues/backlog");
  renameSync(join(dir, "001-p2-bug-crash"), join(dir, "001-crash"));
  void a;
  const m = messages(root);
  assert.match(m, /kind is "bug" but the folder name has no bug- prefix/);
  assert.match(m, /priority is 2 but the folder name has no priority prefix/);
  rmSync(root, { recursive: true, force: true });
});

test("prefixes: a long folder name is a warning, not a failure", () => {
  const root = repo();
  newIssue(root, { slug: "add-a-very-long-descriptive-name-for-this-issue" });
  const problems = validate(root);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.warning, true);
  assert.match(problems[0]!.message, /longer than 40 characters/);
  rmSync(root, { recursive: true, force: true });
});

test("prefixes: CLI validate exits 0 on warnings only and 1 on a mismatch", () => {
  const bin = resolve("dist/cli.js");
  const root = mkdtempSync(join(tmpdir(), "yardhand-prefix-cli-"));
  const run = (...args: string[]) => spawnSync("node", [bin, ...args], { cwd: root, encoding: "utf8" });
  assert.equal(run("init", "--yes").status, 0);
  assert.equal(run("new", "add-a-very-long-descriptive-name-for-this-issue").status, 0);
  const warn = run("validate");
  assert.equal(warn.status, 0);
  assert.match(warn.stderr, /warning: Folder name after the ID is longer than 40/);
  assert.equal(warn.stdout.trim(), "OK");
  const r = run("new", "crash", "--kind", "bug", "--priority", "1");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /002-p1-bug-crash/);
  renameSync(join(root, "issues/backlog/002-p1-bug-crash"), join(root, "issues/backlog/002-crash"));
  assert.equal(run("validate").status, 1);
  rmSync(root, { recursive: true, force: true });
});
