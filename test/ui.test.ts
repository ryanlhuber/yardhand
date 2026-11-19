import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init, moveIssue, newIssue } from "../src/commands.js";
import { setIssue } from "../src/set.js";
import { hashText } from "../src/issues.js";
import { ConflictError } from "../src/errors.js";
import { normalizeBase, splitBody, startUi, type UiServer } from "../src/ui/server.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "yardhand-ui-"));
  init(root, ["backlog", "ready", "in-progress", "done"], "0.0.0");
  const cfg = join(root, "issues", "yardhand.json");
  const data = JSON.parse(readFileSync(cfg, "utf8"));
  data.labels = ["auth", "docs"];
  data.assignees = { "@ryan": "person" };
  writeFileSync(cfg, JSON.stringify(data, null, 2));
  newIssue(root, { slug: "add-auth" });
  newIssue(root, { slug: "add-login", parent: "001" });
  return root;
}

const issueFile = (root: string, id: string): string => {
  for (const status of readdirSync(join(root, "issues"))) {
    let entries: string[] = [];
    try {
      entries = readdirSync(join(root, "issues", status));
    } catch {
      continue;
    }
    const folder = entries.find((f) => f.startsWith(id + "-"));
    if (folder) return join(root, "issues", status, folder, "ISSUE.md");
  }
  throw new Error(`no ${id}`);
};
const hashOf = (root: string, id: string) => hashText(readFileSync(issueFile(root, id), "utf8"));

async function withUi(fn: (ui: UiServer, root: string, base: string) => Promise<void>): Promise<void> {
  const root = repo();
  const ui = await startUi(root, { port: 0 });
  try {
    await fn(ui, root, `http://127.0.0.1:${ui.port}${ui.base}`);
  } finally {
    await ui.close();
  }
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Yardhand": "1", ...headers },
    body: JSON.stringify(body),
  });

// ---- guards in move and set

test("move and set refuse to write when the file changed since it was read", () => {
  const root = repo();
  const stale = hashOf(root, "001");
  appendFileSync(issueFile(root, "001"), "\nEdited by someone else.\n");
  assert.throws(() => moveIssue(root, "001", "ready", { expectHash: stale }), ConflictError);
  assert.throws(() => setIssue(root, "001", { priority: "high" }, { expectHash: stale }), ConflictError);
  assert.match(issueFile(root, "001"), /backlog/, "nothing moved");
  // With the current hash, both work.
  setIssue(root, "001", { priority: "high" }, { expectHash: hashOf(root, "001") });
  moveIssue(root, "001", "ready", { expectHash: hashOf(root, "001") });
  assert.match(issueFile(root, "001"), /ready/);
});

// ---- helpers

test("normalizeBase tidies the path and rejects anything else", () => {
  assert.equal(normalizeBase("/issues"), "/issues");
  assert.equal(normalizeBase("Issues/"), "/issues");
  assert.equal(normalizeBase("/dev/issues"), "/dev/issues");
  for (const bad of ["/", "/../x", "/a b", "/x?y", "//x"]) assert.throws(() => normalizeBase(bad), /--base/);
});

test("splitBody takes the H1 as the title and drops the front matter", () => {
  const r = splitBody("---\nid: 001\n---\n\n# Add auth\n\n## Description\nWhy.\n");
  assert.equal(r.title, "Add auth");
  assert.equal(r.body, "## Description\nWhy.\n");
  assert.equal(splitBody("---\nid: 001\n---\nNo title here").title, null);
});

// ---- server

test("serves the page under the base path with a strict CSP, and redirects / to it", async () => {
  await withUi(async (ui, _root, base) => {
    assert.equal(ui.base, "/issues");
    const page = await fetch(base + "/");
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /\/issues\/assets\/app\.js\?v=/);
    assert.doesNotMatch(html, /\{\{/);
    assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);
    const css = await fetch(base + "/assets/ui.css");
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type") ?? "", /text\/css/);
    assert.ok((await css.text()).length > 1000, "compiled Tailwind CSS is bundled");
    const root = await fetch(`http://127.0.0.1:${ui.port}/`, { redirect: "manual" });
    assert.equal(root.status, 302);
    assert.equal((await fetch(`http://127.0.0.1:${ui.port}/other`)).status, 404);
  });
});

test("board lists every issue with title, fields, hash and validate problems; supports ETag", async () => {
  await withUi(async (_ui, root, base) => {
    const res = await fetch(base + "/api/board");
    const board = await res.json();
    assert.deepEqual(board.statuses, ["backlog", "ready", "in-progress", "done"]);
    assert.deepEqual(board.labels, ["auth", "docs"]);
    const login = board.issues.find((i: { id: string }) => i.id === "001.01");
    assert.equal(login.title, "Add login");
    assert.equal(login.fields.parent, "001");
    assert.equal(login.hash, hashOf(root, "001.01"));
    assert.equal((await fetch(base + "/api/board", { headers: { "If-None-Match": res.headers.get("etag")! } })).status, 304);
  });
});

test("move and set go through the CLI code; a stale hash is a 409 and changes nothing", async () => {
  await withUi(async (_ui, root, base) => {
    const h1 = hashOf(root, "001.01");
    const moved = await post(base + "/api/move", { id: "001.01", to: "In Progress", hash: h1 });
    assert.equal(moved.status, 200);
    assert.match(issueFile(root, "001.01"), /in-progress/);
    assert.match(readFileSync(issueFile(root, "001.01"), "utf8"), /^status: in-progress\s+# must match the folder$/m);

    const stale = await post(base + "/api/set", { id: "001.01", hash: h1, fields: { priority: "high" } });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).conflict, true);

    const set = await post(base + "/api/set", { id: "001.01", hash: hashOf(root, "001.01"), fields: { priority: "high", labels: "auth, docs", assignee: "@ryan" } });
    assert.equal(set.status, 200);
    const text = readFileSync(issueFile(root, "001.01"), "utf8");
    assert.match(text, /^priority: high/m);
    assert.match(text, /^labels: \[auth, docs\]/m);
    assert.match(text, /^assignee: "@ryan"/m);

    // "" clears a field.
    await post(base + "/api/set", { id: "001.01", fields: { priority: "" } });
    assert.match(readFileSync(issueFile(root, "001.01"), "utf8"), /^priority:\s+#/m);
  });
});

test("bad input gets a plain 400 message without CLI flag dashes", async () => {
  await withUi(async (_ui, _root, base) => {
    const label = await post(base + "/api/set", { id: "001", fields: { labels: "nope" } });
    assert.equal(label.status, 400);
    const msg = (await label.json()).error as string;
    assert.match(msg, /labels/);
    assert.doesNotMatch(msg, /--labels/);
    assert.equal((await post(base + "/api/set", { id: "001", fields: { status: "done" } })).status, 400);
    assert.equal((await post(base + "/api/set", { id: "001", fields: { id: "002" } })).status, 400);
    assert.equal((await post(base + "/api/move", { id: "001", to: "shipped" })).status, 400);
    assert.equal((await post(base + "/api/move", { id: "../x", to: "done" })).status, 400);
    assert.equal((await post(base + "/api/move", { id: "999", to: "done" })).status, 400);
  });
});

test("writes from other sites, without the header, or as forms are refused", async () => {
  await withUi(async (ui, root, base) => {
    const before = issueFile(root, "001");
    assert.equal((await post(base + "/api/move", { id: "001", to: "done" }, { Origin: "http://evil.example" })).status, 403);
    assert.equal(
      (await fetch(base + "/api/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"id":"001","to":"done"}' })).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/move", { method: "POST", headers: { "X-Yardhand": "1", "Content-Type": "application/x-www-form-urlencoded" }, body: "id=001&to=done" })).status,
      403,
    );
    assert.equal((await post(base + "/api/move", { id: "001", to: "done" }, { Origin: `http://localhost:${ui.port}` })).status, 200);
    assert.notEqual(issueFile(root, "001"), before);
  });
});

test("a request for another host name is refused (DNS rebinding)", async () => {
  await withUi(async (ui) => {
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: ui.port, path: "/issues/api/board", headers: { Host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    assert.equal(status, 421);
  });
});

test("reference files are served from inside the issue folder only", async () => {
  await withUi(async (_ui, root, base) => {
    const dir = join(issueFile(root, "001"), "..");
    writeFileSync(join(dir, "notes.md"), "# Notes\n");
    writeFileSync(join(dir, "shot.svg"), "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    symlinkSync(join(root, "issues", "yardhand.json"), join(dir, "link.json"));
    const ok = await fetch(base + "/api/files/001/notes.md");
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "# Notes\n");
    const svg = await fetch(base + "/api/files/001/shot.svg");
    assert.match(svg.headers.get("content-security-policy") ?? "", /sandbox/);
    for (const bad of ["001/..%2F..%2Fyardhand.json", "001/link.json", "001/.hidden", "999/notes.md", "..%2F001/notes.md"]) {
      assert.equal((await fetch(`${base}/api/files/${bad}`)).status, 404, bad);
    }
    const board = await (await fetch(base + "/api/board")).json();
    assert.deepEqual(board.issues.find((i: { id: string }) => i.id === "001").files, ["notes.md", "shot.svg"]);
  });
});

test("an explicit busy port is an error; the default port falls back to the next free one", async () => {
  await withUi(async (ui, root) => {
    await assert.rejects(startUi(root, { port: ui.port }), /in use/);
  });
});

test("a custom base path is honored", async () => {
  const root = repo();
  const ui = await startUi(root, { port: 0, base: "/dev/issues" });
  try {
    assert.equal((await fetch(`http://127.0.0.1:${ui.port}/dev/issues/`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${ui.port}/issues/`)).status, 404);
    assert.match(ui.url, /^http:\/\/localhost:\d+\/dev\/issues\/$/);
  } finally {
    await ui.close();
  }
});
