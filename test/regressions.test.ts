import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init, moveIssue, newIssue, validate } from "../src/commands.js";
import { SEMVER_RE } from "../src/ids.js";
import { parseFrontMatter } from "../src/frontmatter.js";
import { upsertBlock } from "../src/block.js";

const STATUSES = ["backlog", "in-progress", "done"];
const bin = resolve("dist/cli.js");

function repo(statuses = STATUSES): string {
  const root = mkdtempSync(join(tmpdir(), "lolo-r-"));
  init(root, statuses, "0.0.0");
  return root;
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const write = (root: string, p: string, text: string) => writeFileSync(join(root, p), text);
const messages = (root: string) => validate(root).map((p) => `${p.path}: ${p.message}`).join("\n");

// ---- finding 1: failed moves must not leave status and folder disagreeing

test("move: a missing destination status folder is created, and the result validates", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  rmDir(root, "issues/done");
  moveIssue(root, "001", "done");
  assert.match(read(root, "issues/done/001-add-auth/ISSUE.md"), /status: done/);
  assert.deepEqual(validate(root), []);
});

test("move: if the destination cannot be created, nothing changes", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  rmDir(root, "issues/done");
  write(root, "issues/done", "a file where the folder should be");
  assert.throws(() => moveIssue(root, "001", "done"));
  assert.match(read(root, "issues/backlog/001-add-auth/ISSUE.md"), /status: backlog/);
});

test("move: destination collision, unreadable ISSUE.md, and bad front matter change nothing", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  // A same-named folder at the destination is a duplicate ID, caught first.
  mkdirSync(join(root, "issues/done/001-add-auth"));
  assert.throws(() => moveIssue(root, "001", "done"), /more than one place/);
  rmDir(root, "issues/done/001-add-auth");
  // A plain file in the way is not an issue folder, so the destination check catches it.
  write(root, "issues/done/001-add-auth", "in the way");
  assert.throws(() => moveIssue(root, "001", "done"), /already exists/);
  rmDir(root, "issues/done/001-add-auth");

  write(root, "issues/backlog/001-add-auth/ISSUE.md", "no front matter here\n");
  assert.throws(() => moveIssue(root, "001", "done"), /front matter/);
  assert.ok(existsSync(join(root, "issues/backlog/001-add-auth")));

  rmDir(root, "issues/backlog/001-add-auth/ISSUE.md");
  mkdirSync(join(root, "issues/backlog/001-add-auth/ISSUE.md"));
  assert.throws(() => moveIssue(root, "001", "done"), /Cannot read .*ISSUE\.md/);
  assert.ok(existsSync(join(root, "issues/backlog/001-add-auth")));
});

// ---- finding 2 and 10: damaged markers and bytes outside the block

const START = "<!-- lolo:start -->";
const END = "<!-- lolo:end -->";
const BLOCK = `${START}\nnew\n${END}`;

test("block: damaged markers throw instead of deleting text", () => {
  const onlyStart = `notes\n${START}\nkeep this\nmore notes\n`;
  assert.throws(() => upsertBlock(onlyStart, BLOCK), /damaged/);
  assert.throws(() => upsertBlock(`${END}\nx\n${START}\n`, BLOCK), /damaged/);
  assert.throws(() => upsertBlock(`${BLOCK}\ntext\n${BLOCK}\n`, BLOCK), /damaged/);
  assert.throws(() => upsertBlock(`only end ${END}`, BLOCK), /damaged/);
});

test("block: text outside the markers is preserved exactly, and updates are idempotent", () => {
  for (const original of ["USER NOTES  \n\n\n", "  \n", "no trailing newline", "a\n"]) {
    const once = upsertBlock(original, BLOCK);
    assert.ok(once.startsWith(original), JSON.stringify(original));
    assert.equal(upsertBlock(once, BLOCK), once, "same block twice changes nothing");
  }
  const surrounded = `top  \n${BLOCK}\n\nbottom \n`;
  const changed = upsertBlock(surrounded, `${START}\nchanged\n${END}`);
  assert.equal(changed, `top  \n${START}\nchanged\n${END}\n\nbottom \n`);
});

test("init: damaged markers in AGENTS.md fail before anything is written", () => {
  const root = mkdtempSync(join(tmpdir(), "lolo-r-"));
  const damaged = `mine\n${START}\nhalf a block\n`;
  writeFileSync(join(root, "AGENTS.md"), damaged);
  assert.throws(() => init(root, STATUSES, "0.0.0"), /damaged/);
  assert.equal(read(root, "AGENTS.md"), damaged);
  assert.ok(!existsSync(join(root, "issues")), "no issues/ folder was created");
});

// ---- finding 3: concurrent allocation

test("new: 16 simultaneous runs get 16 different IDs", async () => {
  const root = repo();
  const run = (i: number) =>
    new Promise<string>((done, fail) => {
      const child = spawn("node", [bin, "new", `item-${i}`], { cwd: root });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.on("error", fail);
      child.on("close", (code) => (code === 0 ? done(out.split(" ")[0] as string) : fail(new Error(`exit ${code}`))));
    });
  const ids = await Promise.all(Array.from({ length: 16 }, (_, i) => run(i)));
  assert.equal(new Set(ids).size, 16, ids.join(","));
  assert.deepEqual(validate(root), []);
  assert.ok(!existsSync(join(root, "issues/.lolo-lock")), "lock is released");
});

// ---- finding 4: duplicate fields

test("duplicate front matter keys fail validation and block moves", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  write(root, p, read(root, p).replace("status: backlog", "status: backlog\nstatus: backlog"));
  assert.match(messages(root), /Field "status" appears more than once/);
  assert.throws(() => moveIssue(root, "001", "done"), /more than once/);
  assert.match(read(root, p), /status: backlog/);
});

// ---- finding 5: assignee

test("new: assignee is a single safe line", () => {
  const root = repo();
  assert.throws(() => newIssue(root, { slug: "a-one", assignee: "#team" }), /assignee/);
  assert.throws(() => newIssue(root, { slug: "a-two", assignee: "Alice\nstatus: done" }), /assignee/);
  const { path } = newIssue(root, { slug: "a-three", assignee: " Alice B " });
  assert.equal(parseFrontMatter(read(root, path))?.fields["assignee"], "Alice B");
  assert.deepEqual(validate(root), []);
});

// ---- finding 6: malformed folder names still take part in checks

test("validate: a bad slug still reports duplicates and missing files, and still counts as a parent", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  mkdirSync(join(root, "issues/done/001-Bad_Slug"));
  const msgs = messages(root);
  assert.match(msgs, /001-Bad_Slug: Folder name must be/);
  assert.match(msgs, /001-Bad_Slug: ISSUE\.md is missing/);
  assert.match(msgs, /ID 001 is used more than once/);

  const clean = repo();
  mkdirSync(join(clean, "issues/backlog/002-Bad_Parent"));
  write(clean, "issues/backlog/002-Bad_Parent/ISSUE.md", "---\nid: 002\nkind: task\nstatus: backlog\n---\n");
  mkdirSync(join(clean, "issues/backlog/002.01-child"));
  write(clean, "issues/backlog/002.01-child/ISSUE.md", "---\nid: 002.01\nkind: task\nparent: 002\nstatus: backlog\n---\n");
  const only = messages(clean);
  assert.doesNotMatch(only, /does not exist/);
  assert.match(only, /002-Bad_Parent: Folder name must be/);
});

// ---- finding 7: filesystem shape errors are reported, not thrown

test("validate: a file where a status folder belongs, or a folder named ISSUE.md, is reported", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  newIssue(root, { slug: "add-pay" });
  rmDir(root, "issues/done");
  write(root, "issues/done", "oops");
  rmDir(root, "issues/backlog/002-add-pay/ISSUE.md");
  mkdirSync(join(root, "issues/backlog/002-add-pay/ISSUE.md"));
  let msgs = "";
  assert.doesNotThrow(() => (msgs = messages(root)));
  assert.match(msgs, /issues\/done: Status folder is missing|issues\/done: Status path is not a readable folder/);
  assert.match(msgs, /002-add-pay: ISSUE\.md cannot be read \(EISDIR\)/);
});

// ---- finding 8: init finds the root

test("init: from a subfolder it uses the existing root and never creates a second issues/", () => {
  const root = repo();
  const sub = join(root, "src", "deep");
  mkdirSync(sub, { recursive: true });
  assert.throws(() => init(sub, STATUSES, "0.0.0"), /Already initialized at src\/deep|Already initialized at \.\.\/\.\./);
  assert.ok(!existsSync(join(sub, "issues")));
  assert.ok(!existsSync(join(sub, "AGENTS.md")));
  init(sub, ["backlog", "review", "done"], "0.0.0", true);
  assert.ok(!existsSync(join(sub, "issues")));
  assert.deepEqual(JSON.parse(read(root, "issues/lolo.json")).statuses, ["backlog", "review", "done"]);
});

// ---- finding 9: semver

test("semver: rejects leading zeros and empty identifiers, accepts valid versions", () => {
  for (const bad of ["01.2.3", "1.2.3-01", "1.2.3-alpha..beta", "1.2.3+..", "1.2", "v1.2.3", "1.2.3-", "1.2.3+"]) {
    assert.ok(!SEMVER_RE.test(bad), bad);
  }
  for (const ok of ["0.0.0", "1.2.3", "1.2.3-alpha.1", "1.2.3-0.3.7", "1.2.3+build.5", "1.0.0-rc.1+sha.5114f85"]) {
    assert.ok(SEMVER_RE.test(ok), ok);
  }
});

// ---- finding 11: empty parent

test("validate: an empty parent field on a level-1 issue is an error", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  write(root, p, read(root, p).replace("kind: task", "kind: task\nparent:"));
  assert.match(messages(root), /level-1 issue must omit the parent field/);
});

// ---- finding 13: coverage the review listed

test("front matter: CRLF files validate, move, and keep their line endings", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  write(root, p, read(root, p).replace(/\n/g, "\r\n"));
  assert.deepEqual(validate(root), []);
  moveIssue(root, "001", "in-progress");
  const moved = read(root, "issues/in-progress/001-add-auth/ISSUE.md");
  assert.match(moved, /status: in-progress\r\n/);
  assert.ok(!/[^\r]\n/.test(moved), "every newline is still CRLF");
  assert.deepEqual(validate(root), []);
});

test("front matter: a hash inside a value is kept, a spaced hash starts a comment", () => {
  const fm = parseFrontMatter("---\nassignee: foo#bar\nreleased-in: 1.0.0 # note\nkind: task\n---\n");
  assert.equal(fm?.fields["assignee"], "foo#bar");
  assert.equal(fm?.fields["released-in"], "1.0.0");
});

test("validate: missing or empty id, kind, and status are reported", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  write(root, "issues/backlog/001-add-auth/ISSUE.md", "---\nid:\nassignee:\n---\n");
  const msgs = messages(root);
  assert.match(msgs, /id "" does not match the folder ID 001/);
  assert.match(msgs, /kind must be/);
  assert.match(msgs, /status "" does not match its folder/);
});

test("validate: an invalid config is a reported problem, and the CLI exits 1", () => {
  const root = repo();
  write(root, "issues/lolo.json", '{ "statuses": ["done", "backlog"] }');
  const problems = validate(root);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!.message, /first status/);
  write(root, "issues/lolo.json", "not json");
  assert.match(messages(root), /not valid JSON/);
  const r = spawnSync("node", [bin, "validate"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 1);
});

test("validate: a missing status folder is reported, and move recreates it", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  rmDir(root, "issues/in-progress");
  assert.match(messages(root), /issues\/in-progress: Status folder is missing/);
  moveIssue(root, "001", "in-progress");
  assert.deepEqual(validate(root), []);
});

test("validate: same-depth and deeper parents are rejected; level 3 can move to another parent", () => {
  const root = repo();
  newIssue(root, { slug: "one" });
  newIssue(root, { slug: "two" });
  newIssue(root, { slug: "a", parent: "001" });
  newIssue(root, { slug: "b", parent: "001" });
  newIssue(root, { slug: "unit", parent: "001.01" });
  const a = "issues/backlog/001.01-a/ISSUE.md";
  write(root, a, read(root, a).replace("parent: 001", "parent: 001.02"));
  assert.match(messages(root), /parent 001\.02 must be at a shallower level than 001\.01/);
  write(root, a, read(root, a).replace("parent: 001.02", "parent: 001"));

  const unit = "issues/backlog/001.01.01-unit/ISSUE.md";
  write(root, unit, read(root, unit).replace("parent: 001.01", "parent: 001.02"));
  assert.deepEqual(validate(root), []);
  write(root, unit, read(root, unit).replace("parent: 001.02", "parent: 001.01.01"));
  assert.match(messages(root), /must be at a shallower level/);
});

test("new: exhausted ranges fail cleanly, and a malformed child folder reserves its ID", () => {
  const root = repo();
  mkdirSync(join(root, "issues/backlog/000.99-last"));
  const r = spawnSync("node", [bin, "new", "too-many", "--parent", "000"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /99/);

  mkdirSync(join(root, "issues/backlog/999-last"));
  const top = spawnSync("node", [bin, "new", "too-many"], { cwd: root, encoding: "utf8" });
  assert.equal(top.status, 1);
  assert.match(top.stderr, /999/);

  const other = repo();
  newIssue(other, { slug: "one" });
  mkdirSync(join(other, "issues/backlog/001.05-Bad_Slug"));
  assert.equal(newIssue(other, { slug: "next", parent: "001" }).id, "001.06");
});

test("CLI: validate exits 1 and names the file when an issue is invalid", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  write(root, p, read(root, p).replace("kind: task", "kind: story"));
  const r = spawnSync("node", [bin, "validate"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /001-add-auth\/ISSUE\.md: kind must be/);
  assert.match(r.stderr, /1 problem found/);
});

function rmDir(root: string, p: string): void {
  spawnSync("rm", ["-rf", join(root, p)]);
}
