import { emitKeypressEvents } from "node:readline";
import * as p from "@clack/prompts";
import { RELEASES_DIR, TOOL } from "./names.js";
import { STATUS_RE, normalizeName } from "./ids.js";
import { AGENTS, type Agent } from "./config.js";
import { AGENT_LABELS } from "./agents.js";

/** Statuses offered in the checklist, in their default workflow order. `backlog` and `done` are always included. */
export const OPTIONAL_STATUSES = ["triage", "ready", "in-progress", "review", "merge-ready", "blocked", "canceled"] as const;
/** Where each known status sits by default. Custom statuses go after all of these. */
export const DEFAULT_ORDER = ["triage", "backlog", "ready", "in-progress", "review", "merge-ready", "blocked", "done", "canceled"];
const CUSTOM = "__custom__";

/** Default order: known statuses in workflow order, then custom ones in the order typed. */
export function orderStatuses(chosen: string[], custom: string[]): string[] {
  const picked = new Set(["backlog", "done", ...chosen]);
  const known = DEFAULT_ORDER.filter((s) => picked.has(s));
  return [...known, ...custom.filter((s) => !known.includes(s))];
}

/**
 * Turn typed custom statuses into names. Separated by commas (semicolons also work),
 * normalized (`Review 1` becomes `review-1`). `taken` are statuses already selected.
 */
export function parseCustomStatuses(raw: string, taken: string[] = []): { names: string[]; error?: string } {
  const names: string[] = [];
  for (const part of raw.split(/[,;]/)) {
    if (part.trim() === "") continue;
    const name = normalizeName(part);
    if (!STATUS_RE.test(name)) {
      return { names, error: `"${part.trim()}" can only use letters, numbers and spaces or dashes, and must start with a letter.` };
    }
    if (name === "backlog" || name === "done") return { names, error: `"${name}" is always included.` };
    if (name === RELEASES_DIR) return { names, error: `"${RELEASES_DIR}" is reserved.` };
    if (taken.includes(name) || names.includes(name)) return { names, error: `"${name}" is listed more than once.` };
    names.push(name);
  }
  return { names };
}

export interface ReorderState {
  items: string[];
  cursor: number;
  grabbed: boolean;
}
export type ReorderKey = "up" | "down" | "space" | { digit: number };

const move = (items: string[], from: number, to: number): string[] => {
  const out = [...items];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x as string);
  return out;
};

/** One key press. Up/down moves the cursor, or the grabbed item; space grabs/drops; a digit jumps the grabbed item to that slot. */
export function reorderStep(s: ReorderState, key: ReorderKey): ReorderState {
  const last = s.items.length - 1;
  if (key === "space") return { ...s, grabbed: !s.grabbed };
  if (key === "up" || key === "down") {
    const to = key === "up" ? s.cursor - 1 : s.cursor + 1;
    if (to < 0 || to > last) return s;
    return { items: s.grabbed ? move(s.items, s.cursor, to) : s.items, cursor: to, grabbed: s.grabbed };
  }
  if (!s.grabbed) return s;
  const to = Math.min(Math.max(key.digit - 1, 0), last);
  return { items: move(s.items, s.cursor, to), cursor: to, grabbed: true };
}

const cyan = (t: string) => `\x1b[36m${t}\x1b[39m`;
const dim = (t: string) => `\x1b[2m${t}\x1b[22m`;

function renderReorder(s: ReorderState, final = false): string[] {
  if (final) return [`${cyan("◇")}  Order`, `│  ${s.items.join(" → ")}`];
  const lines = [`${cyan("◆")}  Order your statuses ${dim("(↑↓ move, space grab/drop, 1-9 jump, enter confirm)")}`];
  s.items.forEach((item, i) => {
    const here = i === s.cursor;
    const mark = here ? (s.grabbed ? "▶" : "❯") : " ";
    const tag = here && s.grabbed ? "   ◀ grabbed" : "";
    lines.push(`│ ${mark} ${i + 1}  ${here ? cyan(item) : item}${tag}`);
  });
  lines.push("└");
  return lines;
}

/** Interactive reorder list. Returns the new order, or null if cancelled. Needs a terminal. */
export function reorderPrompt(items: string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    const input = process.stdin;
    const out = process.stdout;
    let state: ReorderState = { items, cursor: 0, grabbed: false };
    let shown = 0;
    const draw = (final = false) => {
      if (shown) out.write(`\x1b[${shown}A\x1b[0J`);
      const lines = renderReorder(state, final);
      out.write(lines.join("\n") + "\n");
      shown = lines.length;
    };
    const finish = (result: string[] | null) => {
      input.off("keypress", onKey);
      input.setRawMode(false);
      input.pause();
      resolve(result);
    };
    const onKey = (str: string | undefined, key: { name?: string; ctrl?: boolean } | undefined) => {
      if (key?.ctrl && key.name === "c") return finish(null);
      if (key?.name === "escape") return finish(null);
      if (key?.name === "return") {
        draw(true);
        return finish(state.items);
      }
      if (key?.name === "up" || key?.name === "down") state = reorderStep(state, key.name);
      else if (key?.name === "space") state = reorderStep(state, "space");
      else if (str && /^[1-9]$/.test(str)) state = reorderStep(state, { digit: Number(str) });
      draw();
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKey);
    draw();
  });
}

function cancel(): never {
  p.cancel("Cancelled. Nothing was changed.");
  process.exit(1);
}

/** The interactive `init` flow: pick statuses, add custom ones, and order them. */
export async function promptStatuses(): Promise<string[]> {
  p.intro(`${TOOL} init`);
  const chosen = await p.multiselect({
    message: "Which statuses do you want? (backlog and done are always included)",
    options: [
      ...OPTIONAL_STATUSES.map((s) => ({ value: s as string, label: s })),
      { value: CUSTOM, label: "Add custom statuses…" },
    ],
    initialValues: ["ready", "in-progress"],
    required: false,
  });
  if (p.isCancel(chosen)) return cancel();
  const picked = (chosen as string[]).filter((s) => s !== CUSTOM);

  let custom: string[] = [];
  if ((chosen as string[]).includes(CUSTOM)) {
    const raw = await p.text({
      message: "Custom statuses? Separate with commas. Spaces are fine, like: review 1, review 2",
      placeholder: "review 1, review 2",
      validate: (v) => {
        const r = parseCustomStatuses(v ?? "", picked);
        if (r.error) return r.error;
        return r.names.length === 0 ? "Type at least one status, or go back and leave the option unchecked." : undefined;
      },
    });
    if (p.isCancel(raw)) return cancel();
    custom = parseCustomStatuses(raw as string, picked).names;
    p.log.info(`Creating: ${custom.join(", ")}`);
  }

  // Always shown: the right order is the team's decision, not the tool's. Enter accepts it as is.
  const order = await reorderPrompt(orderStatuses(picked, custom));
  if (order === null) return cancel();
  return order;
}

/** Ask a yes/no question that defaults to yes. Cancelling stops init with nothing changed. */
export async function confirmYes(message: string): Promise<boolean> {
  const answer = await p.confirm({ message, initialValue: true });
  if (p.isCancel(answer)) return cancel();
  return answer as boolean;
}

/** Ask which AI tools will work in the repo. `checked` are pre-selected. Nothing picked turns AI off. */
export async function promptAgents(checked: Agent[]): Promise<Agent[]> {
  const answer = await p.multiselect({
    message: "Which AI tools will work in this repo? (pick none to leave AI out)",
    options: AGENTS.map((a) => ({ value: a as string, label: AGENT_LABELS[a] })),
    initialValues: checked,
    required: false,
  });
  if (p.isCancel(answer)) return cancel();
  return answer as Agent[];
}
