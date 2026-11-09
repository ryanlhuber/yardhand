import { mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { ISSUES_DIR, TOOL } from "./names.js";
import { LoloError } from "./errors.js";

const LOCK_DIR = `.${TOOL}-lock`;
const TIMEOUT_MS = 10_000;
const STALE_MS = 60_000;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` while holding an exclusive lock on the issues folder. mkdir is atomic, so
 * exactly one process creates the lock directory. This makes "scan, allocate, create"
 * a single step, so concurrent `new` calls cannot hand out the same ID.
 */
export function withLock<T>(root: string, fn: () => T): T {
  const lock = join(root, ISSUES_DIR, LOCK_DIR);
  const started = Date.now();
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(lock).mtimeMs > STALE_MS) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // The holder released it between our checks.
      }
      if (Date.now() - started > TIMEOUT_MS) {
        throw new LoloError(
          `Could not get the lock at ${ISSUES_DIR}/${LOCK_DIR}. If no ${TOOL} command is running, delete that folder.`,
        );
      }
      sleep(wait);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}
