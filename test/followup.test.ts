import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { init, moveIssue, newIssue, validate } from "../src/commands.js";
import { reclaim } from "../src/lock.js";

const STATUSES = ["backlog", "in-progress", "done"];
const bin = resolve("dist/cli.js");
const LOCK = "issues/.yardhand-lock";
const C1 = String.fromCharCode(0x85);

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "yardhand-f-"));
  init(root, STATUSES, "0.0.0");
  return root;
}
const read = (root: string, p: string) => readFileSync(join(root, p), "utf8");
const write = (root: string, p: string, text: string) => writeFileSync(join(root, p), text);
const messages = (root: string) => validate(root).map((p) => `${p.path}: ${p.message}`).join("\n");
const cli = (root: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync("node", [bin, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, ...env }, timeout: 15_000 });
const deadPid = () =>
  Number(spawnSync("node", ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" }).stdout);

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

// ---- C1: reclaiming an abandoned lock can never remove a live holder's lock

test("reclaim: a lock that changed hands since it was observed is left alone", () => {
  const root = repo();
  const lock = join(root, LOCK);
  mkdirSync(lock);
  write(root, `${LOCK}/owner`, `${process.pid} newholder\n`); // a live holder took over
  const staleView = { pid: deadPid(), token: "oldholder" }; // what a slow contender saw earlier
  assert.equal(reclaim(lock, staleView), false);
  assert.match(read(root, `${LOCK}/owner`), /newholder/, "the live holder's lock is intact");
  assert.ok(!existsSync(`${lock}.reclaim`), "the reclaim mutex is released");
});

test("reclaim: the same abandoned lock is removed, and a vanished one counts as done", () => {
  const root = repo();
  const lock = join(root, LOCK);
  const dead = { pid: deadPid(), token: "gone" };
  mkdirSync(lock);
  write(root, `${LOCK}/owner`, `${dead.pid} ${dead.token}\n`);
  assert.equal(reclaim(lock, dead), true);
  assert.ok(!existsSync(lock));
  assert.equal(reclaim(lock, dead), true, "already gone");
});

test("reclaim: a held mutex defers, and one left by a dead reclaimer is cleared", () => {
  const root = repo();
  const lock = join(root, LOCK);
  const dead = { pid: deadPid(), token: "gone" };
  mkdirSync(lock);
  write(root, `${LOCK}/owner`, `${dead.pid} ${dead.token}\n`);
  mkdirSync(`${lock}.reclaim`);
  assert.equal(reclaim(lock, dead), false, "someone else is reclaiming");
  assert.ok(existsSync(lock));
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${lock}.reclaim`, old, old);
  assert.equal(reclaim(lock, dead), false, "clears the dead reclaimer's mutex");
  assert.ok(!existsSync(`${lock}.reclaim`));
  assert.equal(reclaim(lock, dead), true);
  assert.ok(!existsSync(lock));
});

// ---- C2: the temp file never aliases existing data

test("move: a hard link at the old temp name is never written through", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  const dir = "issues/backlog/001-add-auth";
  linkSync(join(root, dir, "ISSUE.md"), join(root, dir, ".ISSUE.md.tmp"));
  moveIssue(root, "001", "done");
  assert.match(read(root, "issues/done/001-add-auth/ISSUE.md"), /status: done/);
  assert.match(read(root, "issues/done/001-add-auth/.ISSUE.md.tmp"), /status: backlog/, "the other link is unchanged");
});

test("move: a symlink at the old temp name is never written through", (t) => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  write(root, "victim.txt", "precious");
  const dir = "issues/backlog/001-add-auth";
  if (!trySymlink(join(root, "victim.txt"), join(root, dir, ".ISSUE.md.tmp"))) return t.skip("symlinks need privileges");
  moveIssue(root, "001", "done");
  assert.equal(read(root, "victim.txt"), "precious");
  assert.match(read(root, "issues/done/001-add-auth/ISSUE.md"), /status: done/);
});

// ---- C11: an interrupted move is detectable

test("validate: a leftover temp file from an interrupted move is reported", () => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  write(root, "issues/backlog/001-add-auth/.ISSUE.md.a1b2c3.tmp", "x");
  assert.match(messages(root), /\.ISSUE\.md\.a1b2c3\.tmp: Leftover temp file from an interrupted move/);
});

// ---- C5: init takes the same lock

test("init --force waits for the lock and changes nothing without it", () => {
  const root = repo();
  mkdirSync(join(root, LOCK));
  write(root, `${LOCK}/owner`, `${process.pid} holder\n`);
  const before = read(root, "issues/yardhand.json");
  const r = cli(root, ["init", "--force", "--yes", "--statuses", "backlog,review,done"], { YARDHAND_LOCK_TIMEOUT_MS: "400" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Could not get the lock/);
  assert.equal(read(root, "issues/yardhand.json"), before);
});

// ---- C6: symlinks

test("a symlinked issues/ folder is refused everywhere", (t) => {
  const root = repo();
  renameSync(join(root, "issues"), join(root, "issues-real"));
  if (!trySymlink("issues-real", join(root, "issues"))) return t.skip("symlinks need privileges");
  const added = cli(root, ["new", "x-one"]);
  assert.equal(added.status, 1);
  assert.match(added.stderr, /symlink/);
  assert.equal(cli(root, ["validate"]).status, 1);
  assert.equal(cli(root, ["init", "--force", "--yes"]).status, 1);
  assert.deepEqual(readdirSync(join(root, "issues-real/backlog")).sort(), [".gitkeep", "000-maintain-repo"]);
});

test("init --force will not follow a symlinked catch-all folder", (t) => {
  const root = repo();
  mkdirSync(join(root, "elsewhere"));
  write(root, "elsewhere/ISSUE.md", "my description\n");
  rmSync(join(root, "issues/backlog/000-maintain-repo"), { recursive: true });
  if (!trySymlink(join(root, "elsewhere"), join(root, "issues/backlog/000-maintain-repo"))) return t.skip("symlinks need privileges");
  const r = cli(root, ["init", "--force", "--yes"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Symlinks/);
  assert.equal(read(root, "elsewhere/ISSUE.md"), "my description\n");
});

test("new refuses when an existing issue's ISSUE.md is a symlink", (t) => {
  const root = repo();
  newIssue(root, { slug: "add-auth" });
  write(root, "real.md", read(root, "issues/backlog/001-add-auth/ISSUE.md"));
  rmSync(join(root, "issues/backlog/001-add-auth/ISSUE.md"));
  if (!trySymlink(join(root, "real.md"), join(root, "issues/backlog/001-add-auth/ISSUE.md"))) return t.skip("symlinks need privileges");
  assert.throws(() => newIssue(root, { slug: "other" }), /Symlinks/);
});

// ---- C8: folders with no ID still get the checks that do not need one

test("validate: an ID-less folder reports a missing id and a missing parent", () => {
  const root = repo();
  mkdirSync(join(root, "issues/backlog/no-id-here"));
  write(root, "issues/backlog/no-id-here/ISSUE.md", "---\nkind: task\nstatus: backlog\nparent: 999\n---\n");
  const msgs = messages(root);
  assert.match(msgs, /no-id-here\/ISSUE\.md: id is required/);
  assert.match(msgs, /no-id-here\/ISSUE\.md: parent 999 does not exist/);
});

// ---- C9 and C10

test("CLI: help and version reject extra arguments", () => {
  const root = repo();
  assert.equal(cli(root, ["--help"]).status, 0);
  assert.equal(cli(root, ["--version"]).status, 0);
  for (const args of [["--help", "--typo"], ["help", "unexpected"], ["--version", "unexpected"]]) {
    assert.equal(cli(root, args).status, 1, args.join(" "));
  }
});

test("assignee: C1 control characters are rejected too", () => {
  const root = repo();
  assert.throws(() => newIssue(root, { slug: "a-one", assignee: `Alice${C1}Bob` }), /assignee/);
  assert.throws(() => newIssue(root, { slug: "a-two", assignee: String.fromCharCode(0x9f) }), /assignee/);
});

// ---- C3, C4, C7: permission failures, run as an unprivileged user (needs root to set up)

const nobody = 65534;
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

function asNobody(root: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync("node", [bin, ...args], {
    cwd: root,
    uid: nobody,
    gid: nobody,
    encoding: "utf8",
    env: { ...process.env, HOME: root, ...env },
    timeout: 15_000,
  });
}
function nobodyRepo(): string | null {
  if (!isRoot) return null;
  const root = repo();
  spawnSync("chown", ["-R", `${nobody}:${nobody}`, root]);
  chmodSync(root, 0o755);
  // Make sure the unprivileged user can run the CLI at all; otherwise skip rather than mislead.
  const probe = asNobody(root, ["--version"]);
  return probe.status === 0 ? root : null;
}

test("permissions: new refuses when a status folder's children cannot be inspected", (t) => {
  const root = nobodyRepo();
  if (!root) return t.skip("needs root to set up an unprivileged user");
  newIssue(root, { slug: "add-auth" });
  moveIssue(root, "001", "done");
  spawnSync("chown", ["-R", `${nobody}:${nobody}`, root]);
  chmodSync(join(root, "issues/done"), 0o444); // listable, but entries cannot be inspected
  const r = asNobody(root, ["new", "other"]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /Cannot inspect|Cannot read status folder/);
  assert.deepEqual(readdirSync(join(root, "issues/backlog")).sort(), [".gitkeep", "000-maintain-repo"]);
});

test("permissions: init --force will not create a second catch-all when a status cannot be read", (t) => {
  const root = nobodyRepo();
  if (!root) return t.skip("needs root to set up an unprivileged user");
  moveIssue(root, "000", "done");
  spawnSync("chown", ["-R", `${nobody}:${nobody}`, root]);
  chmodSync(join(root, "issues/done"), 0o111); // enter, but not list
  const r = asNobody(root, ["init", "--force", "--yes"]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /Cannot read status folder/);
  assert.ok(!existsSync(join(root, "issues/backlog/000-maintain-repo")), "no duplicate 000 was created");
});

test("permissions: an unreadable issues/ is reported by validate, not thrown", (t) => {
  const root = nobodyRepo();
  if (!root) return t.skip("needs root to set up an unprivileged user");
  chmodSync(join(root, "issues"), 0o000);
  const r = asNobody(root, ["validate"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Cannot read issues\/yardhand\.json/);
  assert.doesNotMatch(r.stderr, /at .*\.js:\d+/, "no stack trace");
});
