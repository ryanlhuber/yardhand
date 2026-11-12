import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init, moveIssue, newIssue, validate } from "../src/commands.js";
import { ID_RE, leadingId, nextChild, nextTopLevel, parseFolderName } from "../src/ids.js";
import { setField, parseFrontMatter } from "../src/frontmatter.js";
import { upsertBlock } from "../src/block.js";

function repo(statuses = ["backlog", "in-progress", "done"]): string {
  const root = mkdtempSync(join(tmpdir(), "yardhand-"));
  init(root, statuses, "0.0.0");
  return root;
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");

test("IDs: valid and invalid forms", () => {
  for (const ok of ["000", "017", "017.01", "017.01.01", "999.99.99"]) assert.ok(ID_RE.test(ok), ok);
  for (const bad of ["17", "0170.01", "017.00", "017.1", "017.01.01.01", "017.00.01", "abc"]) {
    assert.ok(!ID_RE.test(bad), bad);
  }
});

test("IDs: matching uses the separator, so 017 never matches 0170", () => {
  assert.equal(leadingId("017-add-auth"), "017");
  assert.equal(leadingId("0170-add-auth"), null);
  assert.equal(leadingId("017.01-add-thing"), "017.01");
  assert.equal(parseFolderName("017-Add"), null);
  assert.deepEqual(parseFolderName("017.01.01-fix-bug"), { id: "017.01.01", slug: "fix-bug", bug: false });
  assert.deepEqual(parseFolderName("017.01.01-bug-login-loop"), { id: "017.01.01", slug: "login-loop", bug: true });
  assert.equal(parseFolderName("017-bug-bug-x"), null);
});

test("IDs: allocation is highest plus one and ignores gaps", () => {
  assert.equal(nextTopLevel([]), "001");
  assert.equal(nextTopLevel(["000", "003", "017", "017.01"]), "018");
  assert.equal(nextChild("017", ["017", "017.01", "017.04", "017.04.01", "018.09"]), "017.05");
  assert.equal(nextChild("017.04", ["017.04.01", "017.04.02"]), "017.04.03");
  assert.throws(() => nextChild("017.01.01", []), /third level/);
  assert.throws(() => nextTopLevel(["999"]), /999/);
  assert.throws(() => nextChild("017", ["017.99"]), /99/);
});

test("front matter: setField keeps comments and other lines", () => {
  const text = "---\nid: 017\nstatus: backlog     # must match\nkind: task\n---\n\n## Description\n";
  const out = setField(text, "status", "done");
  assert.match(out, /status: done {5}# must match/);
  assert.equal(parseFrontMatter(out)?.fields["status"], "done");
  assert.equal(parseFrontMatter(out)?.fields["kind"], "task");
});

test("block: replaces only the marked block", () => {
  const first = upsertBlock("# Notes\n\nkeep me\n", "<!-- yardhand:start -->\nA\n<!-- yardhand:end -->");
  const second = upsertBlock(first, "<!-- yardhand:start -->\nB\n<!-- yardhand:end -->");
  assert.match(second, /keep me/);
  assert.match(second, /\nB\n/);
  assert.doesNotMatch(second, /\nA\n/);
  assert.equal(second.split("yardhand:start").length, 2);
});

test("init: creates statuses, config, 000, and the AGENTS.md block", () => {
  const root = repo(["backlog", "review-1", "merge-ready", "done"]);
  assert.deepEqual(JSON.parse(read(root, "issues/yardhand.json")), {
    statuses: ["backlog", "review-1", "merge-ready", "done"],
  });
  for (const s of ["backlog", "review-1", "merge-ready", "done"]) {
    assert.ok(existsSync(join(root, "issues", s)), s);
  }
  assert.ok(existsSync(join(root, "issues/backlog/000-maintain-repo/ISSUE.md")));
  assert.match(read(root, "AGENTS.md"), /backlog → review-1 → merge-ready → done/);
  assert.ok(!existsSync(join(root, "CLAUDE.md")), "CLAUDE.md is only updated if it exists");
  assert.deepEqual(validate(root), []);
});

test("init: updates CLAUDE.md when present, refuses to overwrite config, validates statuses", () => {
  const root = mkdtempSync(join(tmpdir(), "yardhand-"));
  writeFileSync(join(root, "CLAUDE.md"), "# Mine\n");
  init(root, ["backlog", "done"], "0.0.0");
  assert.match(read(root, "CLAUDE.md"), /# Mine[\s\S]*yardhand:start/);
  assert.throws(() => init(root, ["backlog", "done"], "0.0.0"), /Already initialized/);
  assert.doesNotThrow(() => init(root, ["backlog", "blocked", "done"], "0.0.0", true));
  assert.throws(() => init(mkdtempSync(join(tmpdir(), "yardhand-")), ["done", "review"], "0.0.0"), /must include "backlog"/);
  // backlog no longer has to be first and done no longer has to be last.
  assert.doesNotThrow(() => init(mkdtempSync(join(tmpdir(), "yardhand-")), ["triage", "backlog", "done", "canceled"], "0.0.0"));
  assert.throws(() => init(mkdtempSync(join(tmpdir(), "yardhand-")), ["backlog", "Bad Name", "done"], "0.0.0"), /kebab/);
  assert.throws(() => init(mkdtempSync(join(tmpdir(), "yardhand-")), ["backlog", "x", "x", "done"], "0.0.0"), /more than once/);
});

test("new: allocates IDs, counts done/, and never reuses", () => {
  const root = repo();
  assert.equal(newIssue(root, { slug: "add-auth" }).id, "001");
  assert.equal(newIssue(root, { slug: "add-login", parent: "001" }).id, "001.01");
  const unit = newIssue(root, { slug: "write-form", parent: "001.01" });
  assert.equal(unit.id, "001.01.01");
  assert.equal(unit.path, "issues/backlog/001.01.01-write-form/ISSUE.md");
  moveIssue(root, "001.01.01", "done");
  assert.equal(newIssue(root, { slug: "write-tests", parent: "001.01" }).id, "001.01.02");
  moveIssue(root, "001", "done");
  assert.equal(newIssue(root, { slug: "add-billing" }).id, "002");
  assert.equal(newIssue(root, { slug: "typo-in-readme", parent: "000", kind: "bug" }).id, "000.01");
  assert.match(read(root, "issues/backlog/000.01-bug-typo-in-readme/ISSUE.md"), /kind: bug/);
  assert.deepEqual(validate(root), []);
});

test("new: rejects bad slugs, missing parents, and a fourth level", () => {
  const root = repo();
  assert.throws(() => newIssue(root, { slug: "9 lives" }), /kebab-case/);
  assert.equal(newIssue(root, { slug: "Add Auth" }).path, "issues/backlog/001-add-auth/ISSUE.md");
  assert.throws(() => newIssue(root, { slug: "x-y", parent: "042" }), /does not exist/);
  newIssue(root, { slug: "two", parent: "001" });
  newIssue(root, { slug: "three", parent: "001.01" });
  assert.throws(() => newIssue(root, { slug: "four", parent: "001.01.01" }), /third level/);
});

test("new: a malformed folder name still reserves its ID", () => {
  const root = repo();
  mkdirSync(join(root, "issues/backlog/005-Bad_Slug"));
  assert.equal(newIssue(root, { slug: "next-one" }).id, "006");
});

test("move: moves the folder and rewrites status, leaving reference files", () => {
  const root = repo();
  const { id } = newIssue(root, { slug: "add-auth" });
  writeFileSync(join(root, "issues/backlog/001-add-auth/notes.md"), "n");
  moveIssue(root, id, "in-progress");
  assert.ok(!existsSync(join(root, "issues/backlog/001-add-auth")));
  assert.match(read(root, "issues/in-progress/001-add-auth/ISSUE.md"), /status: in-progress/);
  assert.equal(read(root, "issues/in-progress/001-add-auth/notes.md"), "n");
  assert.deepEqual(validate(root), []);
});

test("move: rejects unknown status, unknown ID, and same status", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  assert.throws(() => moveIssue(root, "001", "review"), /Unknown status/);
  assert.throws(() => moveIssue(root, "042", "done"), /not found/);
  const same = moveIssue(root, "001", "backlog");
  assert.equal(same.unchanged, true);
  assert.equal(moveIssue(root, "001", "Backlog").unchanged, true);
});

test("validate: reports each kind of problem", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  newIssue(root, { slug: "add-login", parent: "001" });
  // status does not match folder
  const login = "issues/backlog/001.01-add-login/ISSUE.md";
  writeFileSync(join(root, login), read(root, login).replace("status: backlog", "status: done"));
  // wrong id in file
  const auth = "issues/backlog/001-add-auth/ISSUE.md";
  writeFileSync(join(root, auth), read(root, auth).replace("id: 001", "id: 009"));
  // bad semver
  writeFileSync(join(root, auth), read(root, auth).replace("released-in:", "released-in: v1"));
  // missing parent and unknown folder and bad slug and no ISSUE.md and duplicate ID
  mkdirSync(join(root, "issues/backlog/002.01-orphan"), { recursive: true });
  mkdirSync(join(root, "issues/review"));
  mkdirSync(join(root, "issues/backlog/003-Bad_Slug"));
  mkdirSync(join(root, "issues/backlog/004-empty"));
  mkdirSync(join(root, "issues/done/001-add-auth"));
  const msgs = validate(root).map((p) => `${p.path}: ${p.message}`).join("\n");
  assert.match(msgs, /001\.01-add-login\/ISSUE\.md: status "done" does not match its folder \(backlog\)/);
  assert.match(msgs, /001-add-auth\/ISSUE\.md: id "009" does not match the folder ID 001/);
  assert.match(msgs, /released-in "v1" is not valid semver/);
  assert.match(msgs, /Folder is not a status/);
  assert.match(msgs, /003-Bad_Slug: Folder name must be/);
  assert.match(msgs, /004-empty: ISSUE\.md is missing/);
  assert.match(msgs, /ID 001 is used more than once/);
});

test("validate: parent rules, including work moved to a different parent", () => {
  const root = repo();
  newIssue(root, { slug: "one" });
  newIssue(root, { slug: "two" });
  newIssue(root, { slug: "piece", parent: "001" });
  const piece = "issues/backlog/001.01-piece/ISSUE.md";
  // Moving under another top-level issue keeps the folder and ID, and is valid.
  writeFileSync(join(root, piece), read(root, piece).replace("parent: 001", "parent: 002"));
  assert.deepEqual(validate(root), []);
  writeFileSync(join(root, piece), read(root, piece).replace("parent: 002", "parent: 077"));
  assert.match(validate(root)[0]!.message, /parent 077 does not exist/);
  writeFileSync(join(root, piece), read(root, piece).replace(/parent: 077\n/, ""));
  assert.match(validate(root)[0]!.message, /parent is required/);
  const top = "issues/backlog/001-one/ISSUE.md";
  writeFileSync(join(root, piece), read(root, piece).replace("kind: task", "kind: task\nparent: 001"));
  writeFileSync(join(root, top), read(root, top).replace("kind: feature", "kind: feature\nparent: 002"));
  assert.match(validate(root).map((p) => p.message).join("\n"), /must omit the parent field/);
});

test("commands find the repo root from a subfolder", () => {
  const root = repo();
  const sub = join(root, "issues", "backlog");
  assert.equal(newIssue(sub, { slug: "from-sub" }).id, "001");
});

test("CLI end to end", () => {
  const bin = resolve("dist/cli.js");
  const root = mkdtempSync(join(tmpdir(), "yardhand-cli-"));
  const run = (...args: string[]) =>
    spawnSync("node", [bin, ...args], { cwd: root, encoding: "utf8" });

  assert.equal(run("validate").status, 1, "no config yet");
  assert.match(run("validate").stderr, /Run "yardhand init" first/);
  assert.equal(run("init").status, 1, "no terminal and no --yes");
  const init1 = run("init", "--yes", "--statuses", "backlog,review-1,done");
  assert.equal(init1.status, 0, init1.stderr);
  assert.match(init1.stdout, /npx skills@latest add ryanlhuber\/depot/);
  assert.equal(run("new", "add-auth").stdout.split("\n")[0], "001  issues/backlog/001-add-auth/ISSUE.md");
  assert.equal(run("new", "add-login", "--parent", "001").stdout.split(/\s+/)[0], "001.01");
  assert.equal(run("move", "001.01", "review-1").status, 0);
  assert.equal(run("move", "001.01", "nope").status, 1);
  const v = run("validate");
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stdout.trim(), "OK");
  assert.equal(run("--version").stdout.trim(), JSON.parse(readFileSync("package.json", "utf8")).version);
  rmSync(root, { recursive: true, force: true });
  void execFileSync;
});
