import { randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ISSUES_DIR, TOOL } from "./names.js";
import { YardhandError } from "./errors.js";

const LOCK_DIR = `.${TOOL}-lock`;
const OWNER_FILE = "owner";
/** How long a lock with no readable owner may exist before it counts as abandoned. */
const NO_OWNER_GRACE_MS = 2_000;
/** The reclaim mutex is held for a handful of syscalls; anything older than this is a dead reclaimer. */
const RECLAIM_STALE_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const timeoutMs = () =>
  Number(process.env[`${TOOL.toUpperCase()}_LOCK_TIMEOUT_MS`]) || DEFAULT_TIMEOUT_MS;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface Owner {
  pid: number;
  token: string;
}

export function readOwner(lock: string): Owner | null {
  try {
    const [pid, token] = readFileSync(join(lock, OWNER_FILE), "utf8").trim().split(" ");
    return pid && token && Number.isInteger(Number(pid)) ? { pid: Number(pid), token } : null;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function ageMs(path: string): number {
  return Date.now() - lstatSync(path).mtimeMs;
}

/** Does this lock look abandoned right now? A cheap first look; reclaim() re-checks under its mutex. */
function looksAbandoned(lock: string, owner: Owner | null): boolean {
  try {
    return owner ? !alive(owner.pid) : ageMs(lock) > NO_OWNER_GRACE_MS;
  } catch {
    return false; // It vanished; the next mkdir will tell.
  }
}

/**
 * Remove an abandoned lock, safely. `observed` is the owner the caller saw when it decided
 * the lock was abandoned.
 *
 * Reclaiming is serialized by a second, short-lived mutex. While a lock directory exists nobody
 * else can create one, so under the mutex "read the owner, decide, remove" cannot be
 * interleaved with another acquisition. The lock is removed only if it is still the same one
 * the caller saw (same token) and its owner is still gone. If a live holder has taken the lock
 * in the meantime, it is left alone. Returns true when the caller should retry at once.
 */
export function reclaim(lock: string, observed: Owner | null): boolean {
  const mutex = `${lock}.reclaim`;
  try {
    mkdirSync(mutex);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    try {
      // The mutex guards a few syscalls, so one this old belongs to a reclaimer that died.
      if (ageMs(mutex) > RECLAIM_STALE_MS) rmSync(mutex, { recursive: true, force: true });
    } catch {
      // ignored on purpose
    }
    return false;
  }
  try {
    try {
      lstatSync(lock);
    } catch {
      return true; // Already gone.
    }
    const current = readOwner(lock);
    if ((current?.token ?? null) !== (observed?.token ?? null)) return false; // Changed hands.
    if (!looksAbandoned(lock, current)) return false;
    rmSync(lock, { recursive: true, force: true });
    return true;
  } finally {
    rmSync(mutex, { recursive: true, force: true });
  }
}

/**
 * Run `fn` while holding an exclusive lock on the issues folder, so "scan, allocate, create"
 * is one step and concurrent runs cannot hand out the same ID.
 *
 * mkdir is atomic, so exactly one process creates the lock directory, and it writes its pid and a
 * random token inside. A lock is abandoned only when the process that wrote it is no longer
 * running (or, if it never wrote an owner, after a short grace period). A slow but live holder
 * is never evicted. See reclaim() for how an abandoned lock is removed.
 */
export function withLock<T>(root: string, fn: () => T): T {
  const lock = join(root, ISSUES_DIR, LOCK_DIR);
  const token = randomBytes(8).toString("hex");
  const started = Date.now();

  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try {
      mkdirSync(lock);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() - started > timeoutMs()) {
        throw new YardhandError(
          `Could not get the lock at ${ISSUES_DIR}/${LOCK_DIR}; another ${TOOL} command is still running. If none is, delete that folder.`,
        );
      }
      const owner = readOwner(lock);
      if (looksAbandoned(lock, owner) && reclaim(lock, owner)) continue;
      sleep(wait);
      continue;
    }
    try {
      writeFileSync(join(lock, OWNER_FILE), `${process.pid} ${token}\n`);
    } catch (err) {
      rmSync(lock, { recursive: true, force: true });
      throw err;
    }
    break;
  }

  try {
    return fn();
  } finally {
    // Best effort, and only if the lock is still ours. A failure here must not hide the
    // result of the work; an unremoved lock is reclaimed once this process exits.
    try {
      if (readOwner(lock)?.token === token) rmSync(lock, { recursive: true, force: true });
    } catch {
      // ignored on purpose
    }
  }
}
