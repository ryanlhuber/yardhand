import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init, moveIssue, newIssue, validate } from "../src/commands.js";
import { withLock } from "../src/lock.js";
import { parseFrontMatter } from "../src/frontmatter.js";

const STATUSES = ["backlog", "in-progress", "done"];
const bin = resolve("dist/cli.js");
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

function repo(statuses = STATUSES): string {
  const root = mkdtempSync(join(tmpdir(), "lolo-h-"));
  init(root, statuses, "0.0.0");
  return root;
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const write = (root: string, p: string, text: string) => writeFileSync(join(root, p), text);
const messages = (root: string) => validate(root).map((p) => `${p.path}: ${p.message}`).join("\n");
const cli = (root: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("node", [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15_000,
  });
const LOCK = "issues/.lolo-lock";

/** Symlinks need privileges on Windows. Returns false when they cannot be created. */
function trySymlink(target: string, path: string): boolean {
  try {
    symlinkSync(target, path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES" || code === "UNKNOWN") return false;
    throw err;
  }
}

// ---- lock: findings 2, 3, 6, 16

test("lock: a live holder is never evicted, however long it holds", () => {
  const root = repo();
  mkdirSync(join(root, LOCK));
  write(root, `${LOCK}/owner`, `${process.pid} livetoken\n`);
  const old = new Date(Date.now() - 10 * 60_000);
  utimesSync(join(root, LOCK), old, old); // ten minutes old, but its owner is still running
  const r = cli(root, ["new", "x-one"], { LOLO_LOCK_TIMEOUT_MS: "400" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Could not get the lock/);
  assert.match(read(root, `${LOCK}/owner`), /livetoken/, "the live holder's lock is untouched");
});

test("lock: a lock whose owner process has exited is reclaimed", () => {
  const root = repo();
  const dead = Number(spawnSync("node", ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);
  mkdirSync(join(root, LOCK));
  write(root, `${LOCK}/owner`, `${dead} oldtoken\n`);
  const r = cli(root, ["new", "x-one"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(root, LOCK)), "lock released");
  assert.ok(!existsSync(join(root, "issues/.lolo-lock.abandoned-oldtoken")));
});

test("lock: with no owner file, a fresh lock is respected and an old one is reclaimed", () => {
  const root = repo();
  mkdirSync(join(root, LOCK));
  const fresh = cli(root, ["new", "x-one"], { LOLO_LOCK_TIMEOUT_MS: "400" });
  assert.equal(fresh.status, 1);
  const old = new Date(Date.now() - 60_000);
  utimesSync(join(root, LOCK), old, old);
  const reclaimed = cli(root, ["new", "x-one"]);
  assert.equal(reclaimed.status, 0, reclaimed.stderr);
});

test("lock: a dangling symlink at the lock path ends in a clear error, not a spin", (t) => {
  const root = repo();
  if (!trySymlink(join(root, "does-not-exist"), join(root, LOCK))) return t.skip("symlinks need privileges");
  const r = cli(root, ["new", "x-one"], { LOLO_LOCK_TIMEOUT_MS: "400" });
  assert.equal(r.signal, null, "the command ended by itself");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Could not get the lock/);
});

test("lock: released when the work throws, and the result is returned when it succeeds", () => {
  const root = repo();
  assert.throws(() => withLock(root, () => { throw new Error("boom"); }), /boom/);
  assert.ok(!existsSync(join(root, LOCK)));
  assert.equal(withLock(root, () => 42), 42);
  assert.ok(!existsSync(join(root, LOCK)));
});

test("lock: only the owner removes the lock", () => {
  const root = repo();
  withLock(root, () => {
    // Simulate the lock being taken over while the work runs.
    write(root, `${LOCK}/owner`, `${process.pid} someone-else\n`);
  });
  assert.ok(existsSync(join(root, LOCK)), "another holder's lock was not deleted");
  assert.match(read(root, `${LOCK}/owner`), /someone-else/);
});

// ---- move atomicity: finding 1

test("move: a successful move leaves no temp file behind", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  moveIssue(root, "001", "done");
  const left = readdirSync(join(root, "issues/done/001-add-auth"));
  assert.deepEqual(left, ["ISSUE.md"], "no temp file left behind");
  assert.deepEqual(validate(root), []);
});

// ---- scan safety: findings 4, 5, 15

test("new and move refuse when part of the tree cannot be read", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  rmSync(join(root, "issues/done"), { recursive: true });
  write(root, "issues/done", "a file");
  assert.throws(() => newIssue(root, { slug: "other" }), /Cannot read status folder: done/);
  assert.throws(() => moveIssue(root, "001", "in-progress"), /Cannot read status folder/);
});

test("new refuses when a folder that is not a status holds issues", () => {
  const root = repo();
  mkdirSync(join(root, "issues/review/007-old-work"), { recursive: true });
  assert.throws(() => newIssue(root, { slug: "other" }), /review is not a status but holds issues/);
  assert.match(messages(root), /issues\/review: Folder is not a status/);
});

test("init --force refuses a status list that would hide existing issues", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  moveIssue(root, "001", "in-progress");
  const before = read(root, "issues/lolo.json");
  assert.throws(() => init(root, ["backlog", "done"], "0.0.0", true), /in-progress/);
  assert.equal(read(root, "issues/lolo.json"), before, "config unchanged");
  init(root, ["backlog", "in-progress", "review", "done"], "0.0.0", true);
  assert.equal(newIssue(root, { slug: "next" }).id, "002");
});

test("symlinks are reported and never followed", (t) => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const outside = mkdtempSync(join(tmpdir(), "lolo-outside-"));
  write(root, "outside.md", "---\nid: 001\nstatus: backlog\n---\n");
  rmSync(join(root, "issues/backlog/001-add-auth/ISSUE.md"));
  if (!trySymlink(join(root, "outside.md"), join(root, "issues/backlog/001-add-auth/ISSUE.md"))) {
    return t.skip("symlinks need privileges");
  }
  assert.throws(() => moveIssue(root, "001", "done"), /[Ss]ymlink/);
  assert.match(read(root, "outside.md"), /status: backlog/, "the file outside was not changed");
  assert.match(messages(root), /001-add-auth\/ISSUE\.md: Symlinks are not supported/);

  const root2 = repo();
  assert.ok(trySymlink(outside, join(root2, "issues/backlog/009-linked")));
  assert.throws(() => newIssue(root2, { slug: "other" }), /Symlinks/);
  assert.match(messages(root2), /009-linked: Symlinks are not supported/);
});

// ---- validate robustness: findings 8, 9

test("validate: a config that is a folder is reported, not thrown", () => {
  const root = repo();
  rmSync(join(root, "issues/lolo.json"));
  mkdirSync(join(root, "issues/lolo.json"));
  // findRoot looks for the file's existence, which a folder satisfies.
  assert.match(messages(root), /lolo\.json: lolo\.json cannot be read \(EISDIR\)/);
});

test("validate: a folder with no recognizable ID still gets every other check", () => {
  const root = repo();
  mkdirSync(join(root, "issues/backlog/not-an-id"));
  write(
    root,
    "issues/backlog/not-an-id/ISSUE.md",
    "---\nkind: waffle\nstatus: backlog\nstatus: backlog\nreleased-in: 01.2.3\n---\n",
  );
  const msgs = messages(root);
  assert.match(msgs, /not-an-id: Folder name must start with a valid ID/);
  assert.match(msgs, /kind must be "task" or "bug"/);
  assert.match(msgs, /Field "status" appears more than once/);
  assert.match(msgs, /released-in "01\.2\.3" is not valid semver/);
});

// ---- parser: findings 10, 11

test("assignee: separators, edge newlines, and control characters are rejected; ordinary text is kept", () => {
  const root = repo();
  for (const bad of [`Alice${LS}Bob`, `Alice${PS}Bob`, "\nAlice\n", "Alice\r", "A\tB", "#team", "x # y"]) {
    assert.throws(() => newIssue(root, { slug: "a-bad", assignee: bad }), /assignee/, JSON.stringify(bad));
  }
  const { path } = newIssue(root, { slug: "a-good", assignee: "  Zoë Müller  " });
  assert.equal(parseFrontMatter(read(root, path))?.fields["assignee"], "Zoë Müller");
  assert.deepEqual(validate(root), []);
});

test("front matter: keys named like Object.prototype members are ordinary keys", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const p = "issues/backlog/001-add-auth/ISSUE.md";
  write(root, p, read(root, p).replace("kind: task", "kind: task\nconstructor: agent\ntoString: x\nhasOwnProperty: y"));
  assert.deepEqual(validate(root), []);
  assert.match(messages(root) + "x", /^x$/);
  write(root, p, read(root, p).replace("constructor: agent", "constructor: agent\nconstructor: again"));
  assert.match(messages(root), /Field "constructor" appears more than once/);
});

// ---- CLI: findings 7, 12

test("CLI: stray arguments and an empty --statuses fail instead of being ignored", () => {
  const root = repo();
  assert.equal(cli(root, ["validate", "--typo"]).status, 1);
  assert.equal(cli(root, ["validate", "unexpected"]).status, 1);
  assert.equal(cli(root, ["validate"]).status, 0);
  const fresh = mkdtempSync(join(tmpdir(), "lolo-h-"));
  const r = cli(fresh, ["init", "--yes", "--statuses="]);
  assert.equal(r.status, 1);
  assert.ok(!existsSync(join(fresh, "issues")));
});

test("CLI: validate delivers every finding and the summary to a slow reader", async () => {
  const root = repo();
  for (let i = 0; i < 1500; i++) mkdirSync(join(root, "issues/backlog", `junk-${i}`));
  const output = await new Promise<{ code: number | null; text: string }>((done, fail) => {
    const child = spawn("node", [bin, "validate"], { cwd: root });
    let text = "";
    child.stderr.pause();
    child.stderr.on("data", (d) => (text += d));
    child.on("error", fail);
    child.on("close", (code) => done({ code, text }));
    setTimeout(() => child.stderr.resume(), 500); // a reader that starts late
  });
  assert.equal(output.code, 1);
  // Each junk folder has two problems: no valid ID, and no ISSUE.md.
  assert.equal(output.text.split("\n").filter((l) => l.includes("junk-")).length, 3000);
  assert.match(output.text, /3000 problems found\./);
});

// ---- byte preservation: finding 13

test("init keeps bytes outside the block exactly, even invalid UTF-8, and is idempotent", () => {
  const root = mkdtempSync(join(tmpdir(), "lolo-h-"));
  const original = Buffer.from([0x23, 0x20, 0xff, 0x0a, 0xc3, 0x28, 0x0a]);
  writeFileSync(join(root, "AGENTS.md"), original);
  init(root, STATUSES, "0.0.0");
  const once = readFileSync(join(root, "AGENTS.md"));
  assert.ok(once.subarray(0, original.length).equals(original), "original bytes untouched");
  assert.ok(once.includes(Buffer.from("backlog → in-progress → done")), "block is valid UTF-8");
  init(root, STATUSES, "0.0.0", true);
  assert.ok(readFileSync(join(root, "AGENTS.md")).equals(once), "a second run changes nothing");
});
