import { randomBytes } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ISSUES_DIR, TOOL } from "./names.js";
import { LoloError } from "./errors.js";

const LOCK_DIR = `.${TOOL}-lock`;
const OWNER_FILE = "owner";
/** How long a lock with no readable owner may exist before it counts as abandoned. */
const NO_OWNER_GRACE_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10_000;

const timeoutMs = () =>
  Number(process.env[`${TOOL.toUpperCase()}_LOCK_TIMEOUT_MS`]) || DEFAULT_TIMEOUT_MS;

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

interface Owner {
  pid: number;
  token: string;
}

function readOwner(lock: string): Owner | null {
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

/**
 * Run `fn` while holding an exclusive lock on the issues folder, so "scan, allocate, create"
 * is one step and concurrent runs cannot hand out the same ID.
 *
 * mkdir is atomic, so exactly one process creates the lock directory, and it writes its pid and a
 * random token inside. A lock is abandoned only when the process that wrote it is no longer
 * running (or, if it never wrote an owner, after a short grace period). A slow but live holder
 * is never evicted. Reclaiming renames the lock away and checks that what was taken is the same
 * lock that was seen, so a lock that changed hands in between is put back.
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
        throw new LoloError(
          `Could not get the lock at ${ISSUES_DIR}/${LOCK_DIR}; another ${TOOL} command is still running. If none is, delete that folder.`,
        );
      }
      if (reclaimIfAbandoned(lock, token)) continue;
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

/** Returns true if an abandoned lock was removed (or someone else just did), so the caller should retry at once. */
function reclaimIfAbandoned(lock: string, token: string): boolean {
  const owner = readOwner(lock);
  let abandoned: boolean;
  if (owner) {
    abandoned = !alive(owner.pid);
  } else {
    try {
      abandoned = Date.now() - lstatSync(lock).mtimeMs > NO_OWNER_GRACE_MS;
    } catch {
      return true; // It vanished; try again.
    }
  }
  if (!abandoned) return false;

  const grave = `${lock}.abandoned-${token}`;
  try {
    renameSync(lock, grave);
  } catch {
    return true; // Someone else reclaimed it first.
  }
  const taken = readOwner(grave);
  if (taken && taken.token !== owner?.token) {
    // We took a lock that changed hands after we looked. Put it back.
    try {
      renameSync(grave, lock);
    } catch {
      throw new LoloError(
        `The lock changed hands while it was being cleaned up and could not be restored. Delete ${grave} and ${lock}, then run again.`,
      );
    }
    return false;
  }
  rmSync(grave, { recursive: true, force: true });
  return true;
}
