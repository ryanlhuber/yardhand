import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { ConflictError, YardhandError } from "../errors.js";
import { findRoot, loadConfig, type Config } from "../config.js";
import { ISSUE_FILE, ISSUES_DIR, TOOL } from "../names.js";
import { scan } from "../scan.js";
import { hashText, readIssues, type Issue } from "../issues.js";
import { parseFrontMatter } from "../frontmatter.js";
import { KINDS, PRIORITIES, SIZES, isValidId } from "../ids.js";
import { check, moveIssue } from "../commands.js";
import { setIssue, type SetOptions } from "../set.js";
import { titleFromSlug } from "../template.js";
// Everything under ./client is loaded as text by the build (see tsup.config.ts), so the page
// ships inside the one bundled CLI file and needs no network and no extra install.
import indexHtml from "./client/index.html";
import appJs from "./client/app.js";
import uiCss from "./client/ui.css";

export const DEFAULT_PORT = 4747;
export const DEFAULT_BASE = "/issues";
/** How many ports after the default to try when it is busy. */
const PORT_TRIES = 20;
const MAX_BODY = 64 * 1024;
/** Reference files larger than this are not served (the viewer is for notes and screenshots). */
const MAX_FILE = 20 * 1024 * 1024;
const BASE_RE = /^(\/[a-z0-9][a-z0-9_-]*)+$/;

export interface UiOptions {
  /** Port to listen on. When set explicitly, a busy port is an error instead of falling back. */
  port?: number;
  base?: string;
  /** Host to bind. Loopback only; anything else is refused. */
  host?: "127.0.0.1";
}

export interface UiServer {
  url: string;
  port: number;
  base: string;
  server: Server;
  close: () => Promise<void>;
}

/** "/Issues/" -> "/issues". Throws on anything that is not a plain path. */
export function normalizeBase(input: string): string {
  let b = input.trim().toLowerCase();
  if (!b.startsWith("/")) b = "/" + b;
  b = b.replace(/\/+$/, "");
  if (!BASE_RE.test(b)) {
    throw new YardhandError(`--base "${input}" must be a path like /issues (lowercase letters, digits, dashes, underscores).`);
  }
  return b;
}

/** The board as the page sees it: config plus every issue, with its body and a hash of its file. */
export interface BoardIssue {
  id: string | null;
  folder: string;
  status: string;
  slug: string;
  bug: boolean;
  path: string;
  title: string;
  fields: Record<string, string> | null;
  body: string;
  hash: string | null;
  files: string[];
  problems: { message: string; level: "error" | "warning" }[];
}

export interface Board {
  project: string;
  statuses: string[];
  about: Record<string, string>;
  labels: string[];
  assignees: { handle: string; type: string }[];
  kinds: readonly string[];
  priorities: readonly string[];
  sizes: readonly string[];
  issues: BoardIssue[];
  /** Problems not tied to one issue (config, stray folders). */
  problems: { path: string; message: string; level: "error" | "warning" }[];
}

/** Split ISSUE.md into its H1 title and the rest of the body (front matter removed). */
export function splitBody(text: string): { title: string | null; body: string } {
  const lines = text.split(/\r?\n/);
  const fm = parseFrontMatter(text);
  let rest = fm ? lines.slice(fm.end + 1) : lines;
  while (rest.length && (rest[0] as string).trim() === "") rest = rest.slice(1);
  const m = rest.length ? /^#\s+(.+?)\s*#*\s*$/.exec(rest[0] as string) : null;
  if (m) return { title: m[1] as string, body: rest.slice(1).join("\n").replace(/^\s*\n/, "") };
  return { title: null, body: rest.join("\n") };
}

/** Reference files directly inside an issue folder (not ISSUE.md, not dot files, not folders or symlinks). */
function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f !== ISSUE_FILE && !f.startsWith("."))
      .filter((f) => {
        try {
          return lstatSync(join(dir, f)).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

function readText(issue: Issue): string | null {
  try {
    const file = join(issue.dir, ISSUE_FILE);
    if (lstatSync(file).isSymbolicLink()) return null;
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function buildBoard(root: string, config: Config): Board {
  const s = scan(root, config);
  const issues = readIssues(root, s);
  let result: ReturnType<typeof check>;
  try {
    result = check(root);
  } catch (err) {
    result = { errors: [{ path: ISSUES_DIR, rule: "check", message: (err as Error).message }], warnings: [] };
  }
  const all = [
    ...result.errors.map((p) => ({ ...p, level: "error" as const })),
    ...result.warnings.map((p) => ({ ...p, level: "warning" as const })),
  ];
  const claimed = new Set<number>();
  const out: BoardIssue[] = issues.map((i) => {
    const text = readText(i);
    const split = text === null ? { title: null, body: "" } : splitBody(text);
    const problems: BoardIssue["problems"] = [];
    all.forEach((p, n) => {
      if (p.path === i.path || p.path.startsWith(i.path + "/")) {
        claimed.add(n);
        problems.push({ message: p.message, level: p.level });
      }
    });
    return {
      id: i.id,
      folder: i.folder,
      status: i.status,
      slug: i.slug,
      bug: i.bug,
      path: i.path,
      title: split.title ?? titleFromSlug(i.slug),
      fields: i.fields ? { ...i.fields } : null,
      body: split.body,
      hash: text === null ? null : hashText(text),
      files: listFiles(i.dir),
      problems,
    };
  });
  return {
    project: basename(root),
    statuses: config.statuses,
    about: config.about ?? {},
    labels: config.labels,
    assignees: Object.entries(config.assignees).map(([handle, a]) => ({ handle, type: a.type })),
    kinds: KINDS,
    priorities: PRIORITIES,
    sizes: SIZES,
    issues: out,
    problems: all.filter((_, n) => !claimed.has(n)).map(({ path, message, level }) => ({ path, message, level })),
  };
}

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".json": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
};

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...extra,
  });
  res.end(body);
}

const json = (res: ServerResponse, status: number, data: unknown, extra: Record<string, string> = {}) =>
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8", { "Cache-Control": "no-store", ...extra });

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new YardhandError("Request too large."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new YardhandError("Request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

/** Front-matter fields the page may change, mapped to `set` options. id and status are not here: status is a move. */
const SETTABLE: Record<string, keyof SetOptions> = {
  kind: "kind",
  priority: "priority",
  size: "size",
  labels: "labels",
  parent: "parent",
  "depends-on": "dependsOn",
  related: "related",
  assignee: "assignee",
  effort: "effort",
  "released-in": "releasedIn",
};

const str = (v: unknown, name: string): string => {
  if (typeof v !== "string") throw new YardhandError(`"${name}" must be a string.`);
  return v;
};

/**
 * The request handler. Defenses, in order:
 * - The Host header must be this server on loopback, so a DNS-rebinding page cannot reach it.
 * - Writes must be POST with a JSON body, an `X-Yardhand` header and, when the browser sends one,
 *   an Origin of this server. A page in another tab cannot set that header without a CORS
 *   preflight, which this server never approves, so it cannot move or edit issues.
 * - The page never sends paths. Issues are found by ID; reference files are looked up inside
 *   that issue's folder, with symlinks and anything outside it refused.
 */
export function createHandler(root: string, base: string, getPort: () => number) {
  const version = createHash("sha256").update(appJs + uiCss).digest("hex").slice(0, 10);
  const page = indexHtml
    .replaceAll("{{BASE}}", base)
    .replaceAll("{{VERSION}}", version)
    .replaceAll("{{TITLE}}", escapeHtml(`${basename(root)} · issues`));

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const port = getPort();
    const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
    if (!allowedHosts.includes((req.headers.host ?? "").toLowerCase())) {
      send(res, 421, "Wrong host.", "text/plain; charset=utf-8");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;

    if (path === "/" ) {
      res.writeHead(302, { Location: `${base}/` });
      res.end();
      return;
    }
    if (path !== base && !path.startsWith(base + "/")) {
      send(res, 404, `Not found. The issues viewer is at ${base}/`, "text/plain; charset=utf-8");
      return;
    }
    const sub = path.slice(base.length) || "/";

    try {
      if (req.method === "GET" || req.method === "HEAD") {
        if (sub === "/" || sub === "") {
          send(res, 200, page, "text/html; charset=utf-8", { "Content-Security-Policy": PAGE_CSP, "Cache-Control": "no-store" });
          return;
        }
        if (sub === "/assets/app.js") {
          send(res, 200, appJs, "text/javascript; charset=utf-8", { "Cache-Control": "public, max-age=31536000, immutable" });
          return;
        }
        if (sub === "/assets/ui.css") {
          send(res, 200, uiCss, "text/css; charset=utf-8", { "Cache-Control": "public, max-age=31536000, immutable" });
          return;
        }
        if (sub === "/api/board") {
          const board = buildBoard(root, loadConfig(root));
          const body = JSON.stringify(board);
          const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
          if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
            res.end();
            return;
          }
          send(res, 200, body, "application/json; charset=utf-8", { ETag: etag, "Cache-Control": "no-store" });
          return;
        }
        const fileMatch = /^\/api\/files\/([^/]+)\/(.+)$/.exec(sub);
        if (fileMatch) {
          serveFile(res, root, decodeURIComponent(fileMatch[1] as string), decodeURIComponent(fileMatch[2] as string));
          return;
        }
        send(res, 404, "Not found.", "text/plain; charset=utf-8");
        return;
      }

      if (req.method === "POST" && (sub === "/api/move" || sub === "/api/set")) {
        const origin = req.headers.origin;
        if (origin !== undefined && !allowedHosts.some((h) => origin === `http://${h}`)) {
          json(res, 403, { error: "Requests from other sites are not allowed." });
          return;
        }
        if (req.headers["x-yardhand"] !== "1" || !(req.headers["content-type"] ?? "").startsWith("application/json")) {
          json(res, 403, { error: "Missing the X-Yardhand header or a JSON body." });
          return;
        }
        const data = (await readBody(req)) as Record<string, unknown>;
        const id = str(data["id"], "id");
        if (!isValidId(id)) throw new YardhandError(`"${id}" is not a valid ID.`);
        const expectHash = data["hash"] === undefined ? undefined : str(data["hash"], "hash");
        if (sub === "/api/move") {
          const r = moveIssue(root, id, str(data["to"], "to"), { expectHash });
          json(res, 200, { ok: true, result: r });
          return;
        }
        const fields = data["fields"];
        if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
          throw new YardhandError(`"fields" must be an object.`);
        }
        const opts: SetOptions = {};
        for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
          const opt = SETTABLE[key];
          if (!opt) throw new YardhandError(`"${key}" cannot be changed here.`);
          const v = str(value, key);
          // The page sends "" for "cleared"; set spells that "none". Parent and kind cannot be cleared.
          opts[opt] = v.trim() === "" && key !== "parent" && key !== "kind" ? "none" : v;
        }
        const r = setIssue(root, id, opts, { expectHash });
        json(res, 200, { ok: true, result: r });
        return;
      }

      send(res, 405, "Method not allowed.", "text/plain; charset=utf-8", { Allow: "GET, HEAD, POST" });
    } catch (err) {
      if (err instanceof ConflictError) json(res, 409, { error: err.message, conflict: true });
      // Messages come from the CLI code; drop the "--" of flag names, which mean nothing in a browser.
      else if (err instanceof YardhandError) json(res, 400, { error: err.message.replace(/(^|\s)--([a-z][a-z-]*)/g, "$1$2") });
      else {
        process.stderr.write(`${TOOL} ui: ${(err as Error).stack ?? String(err)}\n`);
        json(res, 500, { error: "Something went wrong. See the terminal running the viewer." });
      }
    }
  };
}

function serveFile(res: ServerResponse, root: string, id: string, name: string): void {
  const notFound = () => send(res, 404, "Not found.", "text/plain; charset=utf-8");
  if (!isValidId(id)) return notFound();
  const issue = scan(root, loadConfig(root)).issues.find((i) => i.id === id);
  if (!issue) return notFound();
  // Only plain relative names inside the issue folder: no "..", no absolute paths, no dot files.
  const parts = name.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.startsWith(".") || p.includes("\\") || p.includes("\0"))) {
    return notFound();
  }
  const file = join(issue.dir, ...parts);
  try {
    // Refuse symlinks anywhere on the way, and anything that resolves outside the issue folder.
    let at = issue.dir;
    for (const p of parts) {
      at = join(at, p);
      if (lstatSync(at).isSymbolicLink()) return notFound();
    }
    const real = realpathSync(file);
    const inside = relative(realpathSync(issue.dir), real);
    if (inside.startsWith("..") || inside.split(sep)[0] === "..") return notFound();
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_FILE) return notFound();
    const ext = extname(file).toLowerCase();
    const type = MIME[ext];
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    // SVG can carry script; serve it sandboxed. Unknown types download instead of rendering.
    if (ext === ".svg") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
    if (!type) headers["Content-Disposition"] = `attachment; filename="${basename(file).replace(/[^\w.-]/g, "_")}"`;
    send(res, 200, readFileSync(file), type ?? "application/octet-stream", headers);
  } catch {
    notFound();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/** Start the viewer for the repo that holds `cwd`. Resolves once it is listening. */
export async function startUi(cwd: string, opts: UiOptions = {}): Promise<UiServer> {
  const root = findRoot(cwd);
  loadConfig(root); // Fail now, in the terminal, if the config is broken.
  const base = normalizeBase(opts.base ?? DEFAULT_BASE);
  const host = "127.0.0.1";
  if (opts.host !== undefined && opts.host !== host) throw new YardhandError("The viewer only listens on 127.0.0.1.");
  let port = 0;
  const handler = createHandler(root, base, () => port);
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, "Error.", "text/plain; charset=utf-8");
    });
  });

  const explicit = opts.port !== undefined;
  const first = opts.port ?? DEFAULT_PORT;
  const tries = explicit || first === 0 ? 1 : PORT_TRIES;
  for (let n = 0; ; n++) {
    try {
      port = await listen(server, first + n, host);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" && n + 1 < tries) continue;
      if (code === "EADDRINUSE") {
        throw new YardhandError(
          explicit ? `Port ${first} is in use. Pick another with --port.` : `Ports ${first}-${first + tries - 1} are all in use. Pick one with --port.`,
        );
      }
      throw err;
    }
  }
  return {
    url: `http://localhost:${port}${base}/`,
    port,
    base,
    server,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Open a URL in the default browser. Best effort: failure only means the person clicks the printed link. */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // ignored on purpose
  }
}
