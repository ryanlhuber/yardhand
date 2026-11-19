// yardhand issues viewer. Plain JavaScript, no dependencies, works offline.
// The server (src/ui/server.ts) serves this file and the board data; every change goes through
// the same move and set code as the CLI. Icons are from Lucide (https://lucide.dev, ISC license).
(() => {
  "use strict";

  // ---------- small helpers

  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* storage can be off; the viewer works without it */
      }
    },
  };

  // ---------- theme (runs before first paint)

  const THEME_KEY = "yardhand-theme";
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const themePref = () => store.get(THEME_KEY) || "system";
  function applyTheme() {
    const pref = themePref();
    const dark = pref === "dark" || (pref === "system" && darkQuery.matches);
    document.documentElement.classList.toggle("dark", dark);
  }
  applyTheme();
  darkQuery.addEventListener("change", applyTheme);

  const BASE = document.querySelector('meta[name="yardhand-base"]').content;

  /** Build an element. attrs: class, text, on<event>, dataset via data-*, everything else as attributes. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v; // only ever given output of md() or icon(), both escaped
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const ICONS = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    paperclip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    corner: '<polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
    unplug: '<path d="m19 5 3-3"/><path d="m2 22 3-3"/><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"/><path d="M7.5 13.5 10 11"/><path d="M10.5 16.5 13 14"/><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"/>',
  };
  const icon = (name, cls = "size-4") =>
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const iconEl = (name, cls) => h("span", { class: "inline-flex shrink-0", html: icon(name, cls) });

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const ID_RE = /^\d{3}(?:\.\d{2}){0,2}$/;
  const depth = (id) => id.split(".").length;
  const idMatches = (id, prefix) => !!id && (id === prefix || id.startsWith(prefix + "."));
  const splitList = (v) =>
    String(v || "")
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  const prettyStatus = (s) => {
    const t = s.replace(/-/g, " ");
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const keyOf = (issue) => issue.id || issue.path;

  // ---------- state

  const state = {
    board: null,
    etag: null,
    selected: null,
    query: "",
    collapsed: null,
    dragging: null,
    connected: true,
    detailDirty: false,
    busy: 0,
  };

  const $ = (id) => document.getElementById(id);

  // ---------- markdown (escapes everything; only http(s), mailto, #anchors and files in the issue folder are linked)

  function safeUrl(raw, issueId) {
    const url = raw.trim();
    if (/^(https?:|mailto:)/i.test(url)) return { href: url, external: true };
    if (url.startsWith("#")) return { href: url };
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/") || url.startsWith("\\")) return null;
    const path = url.replace(/^\.\//, "").split(/[?#]/)[0];
    if (!issueId || !path || path.split("/").some((p) => p === "" || p === "." || p === ".." || p.startsWith("."))) return null;
    return { href: `${BASE}/api/files/${encodeURIComponent(issueId)}/${path.split("/").map(encodeURIComponent).join("/")}` };
  }

  const linkHtml = (href, text, external) =>
    `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${text}</a>`;

  function emphasis(s) {
    return s
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
      .replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>")
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, "$1<em>$2</em>");
  }

  /** Inline markdown to HTML. Code spans, links and images become placeholders first, so nothing inside them is touched. */
  function inline(text, issueId) {
    const slots = [];
    const put = (html) => `\u0000${slots.push(html) - 1}\u0000`;
    let s = text.replace(/\u0000/g, "").replace(/<!--[\s\S]*?-->/g, "");
    s = s.replace(/`([^`]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`));
    s = s.replace(/!\[([^\]]*)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))+)>?(?:\s+"[^"]*")?\s*\)/g, (m, alt, url) => {
      const u = safeUrl(url, issueId);
      if (!u) return put(esc(alt || m));
      if (u.external) return put(linkHtml(u.href, esc(alt || "image"), true));
      return put(`<img src="${esc(u.href)}" alt="${esc(alt)}" loading="lazy">`);
    });
    s = s.replace(/\[([^\]]+)\]\(\s*<?((?:[^()\s<>]|\([^()\s]*\))+)>?(?:\s+"[^"]*")?\s*\)/g, (m, label, url) => {
      const u = safeUrl(url, issueId);
      const inner = emphasis(esc(label));
      return put(u ? linkHtml(u.href, inner, u.external) : inner);
    });
    s = s.replace(/<(https?:\/\/[^\s>]+)>|\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g, (m, bracketed) => {
      const href = bracketed || m;
      return put(linkHtml(href, esc(href), true));
    });
    s = emphasis(esc(s)).replace(/ {2,}\n|\\\n/g, "<br>").replace(/\n/g, " ");
    return s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)]);
  }

  const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;

  function mdList(lines, issueId) {
    const first = LIST_RE.exec(lines[0]);
    const base = indentOf(lines[0]);
    const ordered = /\d/.test(first[2]);
    const items = [];
    for (const line of lines) {
      const m = LIST_RE.exec(line);
      if (m && indentOf(line) <= base + 1) items.push({ head: m[3], rest: [] });
      else if (items.length) {
        const last = items[items.length - 1];
        if (!last.rest.length && line.trim() && indentOf(line) <= base + 1) last.head += "\n" + line.trim();
        else last.rest.push(line);
      }
    }
    const start = ordered && parseInt(first[2], 10) !== 1 ? ` start="${parseInt(first[2], 10)}"` : "";
    const lis = items.map((it) => {
      const task = /^\[( |x|X)\](?:\s+([\s\S]*))?$/.exec(it.head);
      const nested = it.rest.length ? md(dedent(it.rest), issueId) : "";
      if (task) {
        const done = task[1] !== " ";
        return `<li class="task${done ? " done" : ""}"><input type="checkbox" disabled${done ? " checked" : ""}><span>${inline(task[2] || "", issueId)}${nested}</span></li>`;
      }
      return `<li>${inline(it.head, issueId)}${nested}</li>`;
    });
    return ordered ? `<ol${start}>${lis.join("")}</ol>` : `<ul>${lis.join("")}</ul>`;
  }

  function dedent(lines) {
    const ind = Math.min(...lines.filter((l) => l.trim()).map(indentOf));
    return lines.map((l) => l.replace(/\t/g, "    ").slice(Number.isFinite(ind) ? ind : 0)).join("\n");
  }

  const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));

  function md(src, issueId) {
    const lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    const isBlockStart = (l, next) =>
      /^\s*(```|~~~)/.test(l) ||
      /^#{1,6}\s/.test(l) ||
      /^\s*>/.test(l) ||
      LIST_RE.test(l) ||
      /^\s*(\*\s*){3,}$|^\s*(-\s*){3,}$|^\s*(_\s*){3,}$/.test(l) ||
      /^\s*<!--/.test(l) ||
      (l.includes("|") && next !== undefined && TABLE_SEP.test(next));
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i++;
        continue;
      }
      const fence = /^\s*(```|~~~)/.exec(line);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }
      if (/^\s*<!--/.test(line)) {
        while (i < lines.length && !lines[i].includes("-->")) i++;
        i++;
        continue;
      }
      const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
      if (heading) {
        const n = heading[1].length;
        out.push(`<h${n}>${inline(heading[2], issueId)}</h${n}>`);
        i++;
        continue;
      }
      if (/^\s*(\*\s*){3,}$|^\s*(-\s*){3,}$|^\s*(_\s*){3,}$/.test(line)) {
        out.push("<hr>");
        i++;
        continue;
      }
      if (/^\s*>/.test(line)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*> ?/, ""));
        out.push(`<blockquote>${md(body.join("\n"), issueId)}</blockquote>`);
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(
          `<table><thead><tr>${head.map((c) => `<th>${inline(c, issueId)}</th>`).join("")}</tr></thead><tbody>${rows
            .map((r) => `<tr>${head.map((_, n) => `<td>${inline(r[n] || "", issueId)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`,
        );
        continue;
      }
      if (LIST_RE.test(line)) {
        const base = indentOf(line);
        const ordered = /\d/.test(LIST_RE.exec(line)[2]);
        const sameLevel = (l) => LIST_RE.test(l) && indentOf(l) <= base + 1;
        const otherType = (l) => sameLevel(l) && /\d/.test(LIST_RE.exec(l)[2]) !== ordered;
        const body = [line];
        i++;
        while (i < lines.length) {
          const l = lines[i];
          if (otherType(l)) break;
          if (!l.trim()) {
            // A blank line ends the list unless the next line continues it.
            const next = lines[i + 1];
            if (next !== undefined && (indentOf(next) > base || (sameLevel(next) && !otherType(next)))) {
              body.push(l);
              i++;
              continue;
            }
            break;
          }
          // Lazy continuation: a plain line right under an item belongs to it, as on GitHub.
          if (LIST_RE.test(l) || indentOf(l) > base || !isBlockStart(l, lines[i + 1])) body.push(lines[i++]);
          else break;
        }
        out.push(mdList(body, issueId));
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !(para.length && isBlockStart(lines[i], lines[i + 1]))) para.push(lines[i++]);
      out.push(`<p>${inline(para.join("\n"), issueId)}</p>`);
    }
    return out.join("");
  }

  /**
   * Acceptance criteria progress: [done, total]. Same rule as the CLI's validate: only boxes under
   * "## Acceptance criteria", outside code fences, with text after them (an empty box is the template's placeholder).
   */
  function criteria(body) {
    let done = 0;
    let total = 0;
    let fenced = false;
    let inside = false;
    for (const line of String(body || "").split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) continue;
      if (/^#{1,2}\s/.test(line)) {
        inside = /^##\s+Acceptance criteria\s*$/i.test(line);
        continue;
      }
      const m = inside && /^\s*[-*+]\s+\[( |x|X)\]\s+\S/.exec(line);
      if (m) {
        total++;
        if (m[1] !== " ") done++;
      }
    }
    return [done, total];
  }

  // ---------- search

  const FILTER_KEYS = ["status", "kind", "priority", "size", "label", "assignee", "parent", "depends-on"];

  function parseQuery(q) {
    const words = [];
    const filters = [];
    for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
      const m = /^([a-z-]+):(.+)$/i.exec(tok);
      if (m && FILTER_KEYS.includes(m[1].toLowerCase())) filters.push([m[1].toLowerCase(), m[2].toLowerCase()]);
      else words.push(tok.toLowerCase());
    }
    return { words, filters };
  }

  function ancestors(issue, byId) {
    const out = [];
    let p = issue.fields && issue.fields.parent;
    const seen = new Set();
    while (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
      const up = byId.get(p);
      p = up && up.fields ? up.fields.parent : null;
    }
    return out;
  }

  function matches(issue, query, byId) {
    const f = issue.fields || {};
    for (const [key, value] of query.filters) {
      if (key === "status" && issue.status !== value) return false;
      if ((key === "kind" || key === "priority" || key === "size") && (f[key] || "").toLowerCase() !== value) return false;
      if (key === "label" && !splitList(f.labels).includes(value)) return false;
      if (key === "assignee") {
        const want = value.startsWith("@") ? value : "@" + value;
        if ((f.assignee || "").toLowerCase() !== want) return false;
      }
      if (key === "parent" && !ancestors(issue, byId).some((a) => a === value)) return false;
      if (key === "depends-on" && !splitList(f["depends-on"]).includes(value)) return false;
    }
    if (!query.words.length) return true;
    const hay = [issue.id, issue.slug, issue.title, issue.body, f.labels, f.assignee].join(" ").toLowerCase();
    return query.words.every((w) => (ID_RE.test(w) ? idMatches(issue.id, w) : hay.includes(w)));
  }

  /** Text with the search words wrapped in <mark>. */
  function highlight(text, words) {
    const terms = words.filter((w) => !ID_RE.test(w) && w.length > 0);
    if (!terms.length) return document.createTextNode(text);
    const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(re)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      frag.append(h("mark", { text: m[0] }));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  // ---------- data

  async function api(path, body) {
    const res = await fetch(`${BASE}/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Yardhand": "1" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status}).`);
      err.conflict = !!data.conflict;
      throw err;
    }
    return data.result;
  }

  async function loadBoard(force) {
    try {
      const res = await fetch(`${BASE}/api/board`, {
        headers: !force && state.etag ? { "If-None-Match": state.etag } : {},
        cache: "no-store",
      });
      setConnected(true);
      if (res.status === 304) return;
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Could not load issues (${res.status}).`);
      state.etag = res.headers.get("ETag");
      state.board = await res.json();
      if (state.collapsed === null) initCollapsed();
      if (state.selected && !state.board.issues.some((i) => keyOf(i) === state.selected)) state.selected = null;
      render();
    } catch (err) {
      if (err instanceof TypeError) setConnected(false);
      else toast(err.message, { tone: "error" });
    }
  }

  const collapsedKey = () => `yardhand-collapsed:${state.board.project}`;
  function initCollapsed() {
    const saved = store.get(collapsedKey());
    let list = null;
    try {
      list = saved ? JSON.parse(saved) : null;
    } catch {
      list = null;
    }
    // Done starts collapsed: it grows forever and is rarely what you open the viewer for.
    state.collapsed = new Set(Array.isArray(list) ? list : ["done"]);
  }
  function toggleCollapsed(status) {
    if (state.collapsed.has(status)) state.collapsed.delete(status);
    else state.collapsed.add(status);
    store.set(collapsedKey(), JSON.stringify([...state.collapsed]));
    renderList();
  }

  function setConnected(ok) {
    if (state.connected === ok) return;
    state.connected = ok;
    const el = $("connection");
    el.replaceChildren();
    el.className = ok ? "hidden" : "ui-badge mr-1 border-destructive/30 bg-destructive/10 text-destructive";
    if (!ok) {
      el.title = "The viewer stopped. Run yardhand ui again in your terminal.";
      el.append(iconEl("unplug", "size-3"), "Disconnected");
    }
  }

  // ---------- rendering

  const PRIORITY_DOT = {
    urgent: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-amber-400",
    low: "bg-sky-500",
  };
  const PRIORITY_BADGE = {
    urgent: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    high: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    medium: "border-amber-500/30 bg-amber-400/10 text-amber-700 dark:text-amber-300",
    low: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };

  function render() {
    renderHeader();
    renderList();
    if (detailBusy()) state.detailDirty = true;
    else renderDetail();
  }

  /** True while the person is typing in a field in the detail pane, so a background refresh does not wipe it. */
  function detailBusy() {
    const a = document.activeElement;
    return !!a && $("detail").contains(a) && a.matches("input[type=text], textarea");
  }

  function renderHeader() {
    const b = state.board;
    $("project").textContent = b.project;
    document.title = `${b.project} · issues`;
    const errors = b.problems.filter((p) => p.level === "error").length + b.issues.reduce((n, i) => n + i.problems.filter((p) => p.level === "error").length, 0);
    const el = $("problems");
    el.replaceChildren();
    if (errors) {
      el.className = "ui-badge mr-1 border-destructive/30 bg-destructive/10 text-destructive";
      el.title = [
        "yardhand validate finds problems:",
        ...b.problems.map((p) => `${p.path}: ${p.message}`),
        ...b.issues.flatMap((i) => i.problems.filter((p) => p.level === "error").map((p) => `${i.id || i.path}: ${p.message}`)),
      ].join("\n");
      el.append(iconEl("alert", "size-3"), `${errors} problem${errors === 1 ? "" : "s"}`);
    } else el.className = "hidden";
    const pref = themePref();
    const btn = $("theme");
    btn.innerHTML = icon(pref === "dark" ? "moon" : pref === "light" ? "sun" : "monitor");
    btn.title = `Theme: ${pref} (click to change)`;
  }

  function visibleIssues() {
    const b = state.board;
    const byId = new Map(b.issues.filter((i) => i.id).map((i) => [i.id, i]));
    const query = parseQuery(state.query);
    const searching = query.words.length > 0 || query.filters.length > 0;
    const sortById = (a, z) => (a.id || "~" + a.folder).localeCompare(z.id || "~" + z.folder, "en", { numeric: true });
    const groups = b.statuses.map((status) => ({
      status,
      issues: b.issues.filter((i) => i.status === status && (!searching || matches(i, query, byId))).sort(sortById),
    }));
    return { groups, query, searching };
  }

  function renderList() {
    const list = $("list");
    const { groups, query, searching } = visibleIssues();
    const total = groups.reduce((n, g) => n + g.issues.length, 0);
    const summary = $("search-summary");
    summary.classList.toggle("hidden", !searching);
    summary.textContent = searching ? `${total} result${total === 1 ? "" : "s"}` : "";
    const scroll = list.scrollTop;
    list.replaceChildren();

    if (!state.board.issues.length) {
      list.append(
        h(
          "div",
          { class: "flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground" },
          iconEl("inbox", "size-8 text-muted-foreground/60"),
          h("p", { class: "font-medium text-foreground", text: "No issues yet" }),
          h("p", {}, "Create one with ", h("code", { class: "rounded bg-muted px-1 font-mono text-xs", text: "npx yardhand new <slug>" })),
        ),
      );
      return;
    }
    if (searching && total === 0) {
      list.append(h("p", { class: "px-3 py-10 text-center text-sm text-muted-foreground", text: "No issues match your search." }));
      return;
    }

    for (const g of groups) {
      if (searching && !g.issues.length) continue;
      const open = searching || !state.collapsed.has(g.status);
      const section = h("section", {
        class: "mb-1 rounded-lg transition-shadow",
        "data-status": g.status,
        ondragover: (e) => {
          if (!state.dragging || state.dragging.status === g.status) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          section.classList.add("ring-2", "ring-ring", "bg-accent/40");
        },
        ondragleave: (e) => {
          if (!section.contains(e.relatedTarget)) section.classList.remove("ring-2", "ring-ring", "bg-accent/40");
        },
        ondrop: (e) => {
          e.preventDefault();
          section.classList.remove("ring-2", "ring-ring", "bg-accent/40");
          const issue = state.dragging;
          state.dragging = null;
          if (issue && issue.status !== g.status) moveTo(issue, g.status);
        },
      });
      const about = state.board.about[g.status];
      section.append(
        h(
          "button",
          {
            type: "button",
            class:
              "sticky top-0 z-10 flex w-full items-center gap-1.5 rounded-md bg-sidebar px-2 py-1.5 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground",
            "aria-expanded": open ? "true" : "false",
            title: about || undefined,
            onclick: () => !searching && toggleCollapsed(g.status),
          },
          h("span", { class: `inline-flex transition-transform ${open ? "rotate-90" : ""}`, html: icon("chevron", "size-3.5") }),
          h("span", { class: "truncate", text: prettyStatus(g.status) }),
          h("span", { class: "ml-auto rounded-full bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums", text: g.issues.length }),
        ),
      );
      if (open) {
        const ul = h("ul", { class: "space-y-px pb-1" });
        if (!g.issues.length) {
          ul.append(h("li", { class: "mx-1 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground/80", text: "Drop issues here" }));
        }
        for (const issue of g.issues) ul.append(h("li", {}, row(issue, query.words)));
        section.append(ul);
      }
      list.append(section);
    }
    list.scrollTop = scroll;
  }

  function row(issue, words) {
    const f = issue.fields || {};
    const selected = keyOf(issue) === state.selected;
    const [done, total] = criteria(issue.body);
    const hasError = issue.problems.some((p) => p.level === "error");
    const movable = !!(issue.id && issue.hash && issue.fields);
    const meta = [f.assignee, ...splitList(f.labels)].filter(Boolean).join(" · ");
    const el = h(
      "button",
      {
        type: "button",
        class: `group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
          selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
        }`,
        draggable: movable ? "true" : undefined,
        "data-key": keyOf(issue),
        "aria-current": selected ? "true" : undefined,
        onclick: () => select(keyOf(issue)),
        ondragstart: (e) => {
          state.dragging = issue;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", issue.id);
          requestAnimationFrame(() => el.classList.add("opacity-40"));
        },
        ondragend: () => {
          state.dragging = null;
          el.classList.remove("opacity-40");
          document.querySelectorAll("#list section").forEach((s) => s.classList.remove("ring-2", "ring-ring", "bg-accent/40"));
        },
      },
      h("span", {
        class: `mt-[7px] size-2 shrink-0 rounded-full ${PRIORITY_DOT[f.priority] || "border border-muted-foreground/40"}`,
        title: f.priority ? `Priority: ${f.priority}` : "No priority",
      }),
      h(
        "span",
        { class: "min-w-0 flex-1" },
        h("span", { class: "block truncate text-sm font-medium" }, highlight(issue.title, words)),
        h(
          "span",
          { class: "mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground" },
          h("span", { class: "font-mono", text: issue.id || "no id" }),
          f.parent ? h("span", { class: "inline-flex items-center gap-0.5 font-mono text-muted-foreground/80", title: `Part of ${f.parent}` }, iconEl("corner", "size-3"), f.parent) : null,
          (f.kind || (issue.bug ? "bug" : "")) === "bug" ? h("span", { class: "ui-badge border-red-500/30 py-0 text-[10px] text-red-600 dark:text-red-400", text: "bug" }) : null,
          total ? h("span", { class: `tabular-nums ${done === total ? "text-emerald-600 dark:text-emerald-400" : ""}`, title: "Acceptance criteria done", text: `${done}/${total}` }) : null,
          hasError ? h("span", { class: "text-destructive", title: issue.problems.map((p) => p.message).join("\n"), html: icon("alert", "size-3.5") }) : null,
        ),
        meta ? h("span", { class: "mt-0.5 block truncate text-xs text-muted-foreground/80", text: meta }) : null,
      ),
    );
    return el;
  }

  function select(key) {
    state.selected = key;
    const issue = state.board.issues.find((i) => keyOf(i) === key);
    history.replaceState(null, "", urlFor(state.query, issue && issue.id));
    renderList();
    renderDetail();
    const rowEl = document.querySelector(`#list [data-key="${CSS.escape(key)}"]`);
    if (rowEl) rowEl.scrollIntoView({ block: "nearest" });
  }

  function urlFor(q, id) {
    const u = new URL(location.href);
    if (q) u.searchParams.set("q", q);
    else u.searchParams.delete("q");
    u.hash = id ? id : "";
    return u.pathname + u.search + u.hash;
  }

  function renderDetail() {
    state.detailDirty = false;
    const detail = $("detail");
    const issue = state.board.issues.find((i) => keyOf(i) === state.selected);
    detail.replaceChildren();
    if (!issue) {
      detail.classList.remove("lg:grid");
      detail.append(
        h(
          "div",
          { class: "flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground" },
          iconEl("inbox", "size-10 text-muted-foreground/50"),
          h("p", { class: "font-medium text-foreground", text: "Select an issue" }),
          h("p", { text: "Drag an issue onto a status to move it." }),
        ),
      );
      return;
    }
    detail.classList.add("lg:grid");
    detail.append(article(issue), sidebar(issue));
  }

  function article(issue) {
    const f = issue.fields || {};
    const [done, total] = criteria(issue.body);
    const body = h("div", { class: "md mt-6", html: md(issue.body, issue.id) });
    const art = h(
      "article",
      { class: "min-h-0 lg:overflow-y-auto" },
      h(
        "div",
        { class: "mx-auto max-w-3xl px-6 py-8 lg:px-10" },
        h("p", { class: "truncate font-mono text-xs text-muted-foreground", title: "File in the repo", text: `${issue.path}/ISSUE.md` }),
        h("h1", { class: "mt-2 text-2xl font-semibold tracking-tight text-balance", text: issue.title }),
        h(
          "div",
          { class: "mt-3 flex flex-wrap items-center gap-1.5" },
          h("span", { class: "ui-badge font-mono", text: issue.id || "no id" }),
          h("span", { class: "ui-badge bg-secondary text-secondary-foreground", text: prettyStatus(issue.status) }),
          f.kind ? h("span", { class: `ui-badge ${f.kind === "bug" ? "border-red-500/30 text-red-600 dark:text-red-400" : "text-muted-foreground"}`, text: f.kind }) : null,
          f.priority ? h("span", { class: `ui-badge ${PRIORITY_BADGE[f.priority] || ""}`, text: f.priority }) : null,
          total
            ? h(
                "span",
                { class: "ml-1 inline-flex items-center gap-2 text-xs text-muted-foreground" },
                h("span", { class: "h-1.5 w-20 overflow-hidden rounded-full bg-muted" }, progressBar(done, total)),
                `${done} of ${total} criteria`,
              )
            : null,
        ),
        issue.body.trim() ? body : h("p", { class: "mt-6 text-sm text-muted-foreground italic", text: "This issue has no description yet." }),
        issue.files.length
          ? h(
              "div",
              { class: "mt-10 border-t pt-4" },
              h("h2", { class: "ui-label mb-2", text: "Files" }),
              h(
                "ul",
                { class: "flex flex-wrap gap-2" },
                issue.files.map((name) => {
                  const u = safeUrl(name, issue.id);
                  return h(
                    "li",
                    {},
                    u
                      ? h("a", { class: "ui-btn-outline h-7 px-2.5 text-xs font-normal", href: u.href, target: "_blank", rel: "noopener" }, iconEl("paperclip", "size-3.5"), name)
                      : h("span", { class: "ui-badge", text: name }),
                  );
                }),
              ),
            )
          : null,
      ),
    );
    return art;
  }

  function progressBar(done, total) {
    const bar = h("span", { class: `block h-full rounded-full ${done === total ? "bg-emerald-500" : "bg-foreground/70"}` });
    bar.style.width = `${Math.round((done / total) * 100)}%`; // CSSOM, allowed by the page's CSP
    return bar;
  }

  // ---------- sidebar: front matter as fields

  function sidebar(issue) {
    const f = issue.fields;
    const b = state.board;
    const editable = !!(issue.id && issue.hash && f);
    const aside = h("aside", { class: "min-h-0 border-t bg-sidebar/50 lg:overflow-y-auto lg:border-t-0 lg:border-l" });
    const inner = h("div", { class: "space-y-5 p-5" });
    aside.append(inner);

    if (issue.problems.length) {
      const anyError = issue.problems.some((p) => p.level === "error");
      inner.append(
        h(
          "div",
          { class: `rounded-lg border p-3 text-sm ${anyError ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5"}` },
          h("p", { class: `mb-1 flex items-center gap-1.5 font-medium ${anyError ? "text-destructive" : "text-amber-700 dark:text-amber-300"}` }, iconEl("alert", "size-4"), "From yardhand validate"),
          h(
            "ul",
            { class: "space-y-1 text-xs text-muted-foreground" },
            issue.problems.map((p) => h("li", {}, h("span", { class: p.level === "error" ? "text-destructive" : "text-warning", text: p.level === "error" ? "Error: " : "Warning: " }), p.message)),
          ),
        ),
      );
    }
    if (!editable) {
      inner.append(h("p", { class: "text-xs text-muted-foreground", text: "This issue can't be edited here until its problems are fixed in the file." }));
    }

    const fields = f || {};
    const field = (label, control, hint) =>
      h("div", { class: "space-y-1.5" }, h("div", { class: "ui-label" }, label), control, hint ? h("p", { class: "text-[11px] text-muted-foreground", text: hint }) : null);

    const selectBox = (key, options, value, onChange) => {
      const el = h("select", { class: "ui-select", disabled: !editable, "aria-label": key, onchange: () => onChange(el.value) });
      for (const o of options) el.append(h("option", { value: o.value, selected: o.value === value }, o.label));
      if (value && !options.some((o) => o.value === value)) el.append(h("option", { value, selected: true }, `${value} (not allowed)`));
      return el;
    };
    const save = (key) => (value) => saveField(issue, key, value);
    const none = { value: "", label: "None" };

    // Status is a move, not a field edit.
    inner.append(field("Status", selectBox("status", b.statuses.map((s) => ({ value: s, label: prettyStatus(s) })), issue.status, (v) => moveTo(issue, v))));

    const grid = h("div", { class: "grid grid-cols-2 gap-3" });
    grid.append(
      field("Kind", selectBox("kind", b.kinds.map((k) => ({ value: k, label: k })), fields.kind || "", save("kind"))),
      field("Priority", selectBox("priority", [none, ...b.priorities.map((p) => ({ value: p, label: p }))], fields.priority || "", save("priority"))),
      field("Size", selectBox("size", [none, ...b.sizes.map((s) => ({ value: s, label: s }))], fields.size || "", save("size"))),
      field("Effort", textInput(issue, "effort", fields.effort || "", editable, "e.g. high")),
    );
    inner.append(grid);

    const people = b.assignees.filter((a) => a.type === "person");
    const models = b.assignees.filter((a) => a.type === "model");
    const assignee = h("select", { class: "ui-select", disabled: !editable, "aria-label": "assignee", onchange: () => saveField(issue, "assignee", assignee.value) });
    assignee.append(h("option", { value: "", selected: !fields.assignee }, "Unassigned"));
    for (const [label, group] of [
      ["People", people],
      ["Models", models],
    ]) {
      if (!group.length) continue;
      const og = h("optgroup", { label });
      for (const a of group) og.append(h("option", { value: a.handle, selected: a.handle === fields.assignee }, a.handle));
      assignee.append(og);
    }
    if (fields.assignee && !b.assignees.some((a) => a.handle === fields.assignee)) {
      assignee.append(h("option", { value: fields.assignee, selected: true }, `${fields.assignee} (not listed)`));
    }
    inner.append(field("Assignee", assignee, b.assignees.length ? null : "Add people and models to issues/yardhand.json."));

    // Labels: toggle chips for every allowed label.
    const current = splitList(fields.labels);
    const chips = h("div", { class: "flex flex-wrap gap-1.5" });
    for (const l of b.labels) {
      const on = current.includes(l);
      chips.append(
        h("button", {
          type: "button",
          class: "ui-chip",
          "aria-pressed": on ? "true" : "false",
          disabled: !editable,
          text: l,
          onclick: () => {
            const next = on ? current.filter((x) => x !== l) : [...current, l];
            saveField(issue, "labels", next.join(", "));
          },
        }),
      );
    }
    for (const l of current.filter((x) => !b.labels.includes(x))) {
      chips.append(h("span", { class: "ui-chip cursor-default border-destructive/40 text-destructive", title: "Not in issues/yardhand.json", text: l }));
    }
    if (!b.labels.length && !current.length) chips.append(h("p", { class: "text-xs text-muted-foreground", text: "No labels in issues/yardhand.json." }));
    inner.append(field("Labels", chips));

    // Parent: any issue at a shallower level.
    if (issue.id && depth(issue.id) > 1) {
      const candidates = b.issues
        .filter((i) => i.id && depth(i.id) < depth(issue.id))
        .sort((a, z) => a.id.localeCompare(z.id, "en", { numeric: true }))
        .map((i) => ({ value: i.id, label: `${i.id} · ${i.title}` }));
      inner.append(field("Parent", selectBox("parent", candidates, fields.parent || "", save("parent"))));
    }

    inner.append(
      ...[
        field("Depends on", textInput(issue, "depends-on", splitList(fields["depends-on"]).join(", "), editable, "e.g. 017.01, 017.02")),
        linkChips(splitList(fields["depends-on"]), true),
        field("Related", textInput(issue, "related", splitList(fields.related).join(", "), editable, "Issue IDs")),
        linkChips(splitList(fields.related), false),
      ].filter(Boolean),
    );

    const children = b.issues
      .filter((i) => i.fields && i.fields.parent && i.fields.parent === issue.id)
      .sort((a, z) => a.id.localeCompare(z.id, "en", { numeric: true }));
    if (children.length) {
      inner.append(
        field(
          `Children (${children.filter((c) => c.status === "done").length}/${children.length} done)`,
          h(
            "ul",
            { class: "space-y-0.5" },
            children.map((c) =>
              h(
                "li",
                {},
                h(
                  "button",
                  { type: "button", class: "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent", onclick: () => select(keyOf(c)) },
                  h("span", { class: "font-mono text-muted-foreground", text: c.id }),
                  h("span", { class: `truncate ${c.status === "done" ? "text-muted-foreground line-through" : ""}`, text: c.title }),
                  h("span", { class: "ml-auto shrink-0 text-muted-foreground", text: prettyStatus(c.status) }),
                ),
              ),
            ),
          ),
        ),
      );
    }

    inner.append(
      h(
        "div",
        { class: "grid grid-cols-2 gap-3 border-t pt-4" },
        field("Released in", textInput(issue, "released-in", fields["released-in"] || "", editable, "e.g. 1.4.0")),
        field("ID", h("p", { class: "flex h-8 items-center font-mono text-sm", text: issue.id || "—" })),
      ),
    );
    return aside;
  }

  /** Links to other issues, with their status. Open dependencies are called out. */
  function linkChips(ids, isDependency) {
    if (!ids.length) return null;
    const byId = new Map(state.board.issues.filter((i) => i.id).map((i) => [i.id, i]));
    return h(
      "div",
      { class: "-mt-3 flex flex-wrap gap-1" },
      ids.map((id) => {
        const target = byId.get(id);
        const waiting = isDependency && target && target.status !== "done";
        return h(
          "button",
          {
            type: "button",
            class: `ui-badge font-mono hover:bg-accent ${!target ? "border-destructive/40 text-destructive" : waiting ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`,
            title: !target ? "No such issue" : `${target.title} (${prettyStatus(target.status)})`,
            disabled: !target,
            onclick: () => target && select(keyOf(target)),
          },
          id,
          target ? h("span", { class: "font-sans font-normal", text: target.status === "done" ? "✓" : waiting ? "waiting" : "" }) : null,
        );
      }),
    );
  }

  function textInput(issue, key, value, editable, placeholder) {
    const el = h("input", { type: "text", class: "ui-input", value, placeholder, disabled: !editable, "aria-label": key, spellcheck: "false" });
    let committed = value;
    const commit = () => {
      if (el.value.trim() === committed.trim()) return;
      committed = el.value;
      saveField(issue, key, el.value.trim());
    };
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        el.blur();
      }
      if (e.key === "Escape") {
        el.value = committed;
        el.blur();
      }
    });
    el.addEventListener("blur", () => {
      commit();
      if (state.detailDirty) setTimeout(() => !detailBusy() && renderDetail(), 0);
    });
    return el;
  }

  // ---------- writes

  async function saveField(issue, key, value) {
    try {
      state.busy++;
      const r = await api("set", { id: issue.id, hash: issue.hash, fields: { [key]: value } });
      toast(r.unchanged ? "Nothing changed." : r.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join(" · "), {
        tone: "success",
        detail: r.warnings && r.warnings.length ? r.warnings.join(" ") : undefined,
      });
    } catch (err) {
      failed(err);
    } finally {
      state.busy--;
      await loadBoard(true);
    }
  }

  async function moveTo(issue, status) {
    if (!issue.id || !issue.hash) return;
    const before = issue.status;
    issue.status = status; // optimistic: the row moves at once, and snaps back if the server says no
    renderList();
    if (keyOf(issue) === state.selected) renderDetail();
    try {
      state.busy++;
      const r = await api("move", { id: issue.id, to: status, hash: issue.hash });
      const kids = r.children && r.children.length ? `${r.children.length} child issue${r.children.length === 1 ? "" : "s"} stayed where ${r.children.length === 1 ? "it was" : "they were"}.` : undefined;
      toast(`${issue.id} moved to ${prettyStatus(status)}`, { tone: "success", detail: kids });
    } catch (err) {
      issue.status = before;
      failed(err);
    } finally {
      state.busy--;
      await loadBoard(true);
    }
  }

  function failed(err) {
    if (err instanceof TypeError) {
      setConnected(false);
      toast("The viewer isn't running. Start it again with yardhand ui.", { tone: "error" });
    } else if (err.conflict) {
      // The board reloads right after (see saveField and moveTo), so the latest version is already on screen.
      toast("This issue changed while you had it open, so nothing was saved.", {
        tone: "error",
        detail: "Someone or something else edited the file. The latest version is now shown; make your change again.",
      });
    } else toast(err.message, { tone: "error" });
  }

  // ---------- toasts

  function toast(message, { tone = "info", detail, action } = {}) {
    const box = $("toasts");
    const el = h(
      "div",
      {
        role: tone === "error" ? "alert" : "status",
        class: "pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-lg transition-all duration-200 translate-y-2 opacity-0",
      },
      h("span", {
        class: `mt-0.5 inline-flex ${tone === "error" ? "text-destructive" : tone === "success" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`,
        html: icon(tone === "error" ? "alert" : "check", "size-4"),
      }),
      h("div", { class: "min-w-0 flex-1" }, h("p", { class: "font-medium break-words", text: message }), detail ? h("p", { class: "mt-0.5 text-xs text-muted-foreground", text: detail }) : null),
      action
        ? h("button", { type: "button", class: "ui-btn-outline h-7 px-2 text-xs", onclick: () => { action.run(); dismiss(); } }, iconEl("reload", "size-3.5"), action.label)
        : null,
      h("button", { type: "button", class: "ui-icon-btn -m-1 size-6", "aria-label": "Dismiss", html: icon("x", "size-3.5"), onclick: () => dismiss() }),
    );
    const dismiss = () => {
      el.classList.add("opacity-0", "translate-y-2");
      setTimeout(() => el.remove(), 200);
    };
    box.append(el);
    requestAnimationFrame(() => el.classList.remove("opacity-0", "translate-y-2"));
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(dismiss, tone === "error" ? 9000 : 3500);
  }

  // ---------- keyboard and wiring

  function visibleKeys() {
    return [...document.querySelectorAll("#list [data-key]")].map((el) => el.dataset.key);
  }

  function onKey(e) {
    const t = e.target;
    const typing = t.matches && t.matches("input, textarea, select");
    const search = $("search");
    if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      search.focus();
      search.select();
      return;
    }
    if (e.key === "Escape" && t === search) {
      search.value = "";
      setQuery("");
      search.blur();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    const down = e.key === "j" || e.key === "ArrowDown";
    const up = e.key === "k" || e.key === "ArrowUp";
    if (!down && !up) return;
    const keys = visibleKeys();
    if (!keys.length) return;
    e.preventDefault();
    const at = keys.indexOf(state.selected);
    const next = at === -1 ? (down ? 0 : keys.length - 1) : Math.max(0, Math.min(keys.length - 1, at + (down ? 1 : -1)));
    select(keys[next]);
    const rowEl = document.querySelector(`#list [data-key="${CSS.escape(keys[next])}"]`);
    if (rowEl) rowEl.focus({ preventScroll: true });
  }

  let searchTimer = 0;
  function setQuery(q) {
    state.query = q;
    const issue = state.board && state.board.issues.find((i) => keyOf(i) === state.selected);
    history.replaceState(null, "", urlFor(q, issue && issue.id));
    if (state.board) renderList();
  }

  function start() {
    $("search-icon").innerHTML = icon("search", "size-4");
    const params = new URL(location.href).searchParams;
    state.query = params.get("q") || "";
    const search = $("search");
    search.value = state.query;
    search.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => setQuery(search.value), 60);
    });
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) state.selected = fromHash;
    $("theme").addEventListener("click", () => {
      const order = ["system", "light", "dark"];
      store.set(THEME_KEY, order[(order.indexOf(themePref()) + 1) % order.length]);
      applyTheme();
      if (state.board) renderHeader();
    });
    document.addEventListener("keydown", onKey);
    // Back/forward or an edited #id in the address bar opens that issue.
    window.addEventListener("hashchange", () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (state.board && id && id !== state.selected && state.board.issues.some((i) => keyOf(i) === id)) select(id);
    });
    // Keep up with edits made by people and models outside the viewer.
    window.addEventListener("focus", () => loadBoard(false));
    setInterval(() => {
      if (!document.hidden && !state.dragging && !state.busy) loadBoard(false);
    }, 5000);
    loadBoard(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
