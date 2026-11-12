import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { YardhandError } from "./errors.js";
import { ISSUE_FILE } from "./names.js";
import { rel } from "./scan.js";

const errCode = (err: unknown) => (err as NodeJS.ErrnoException).code ?? "error";
// Temp files: a random name, created exclusively, so an existing file, hard link, or symlink at a
// guessable path can never be written through.
export const tmpName = () => `.${ISSUE_FILE}.${randomBytes(6).toString("hex")}.tmp`;
export const TMP_RE = new RegExp(`^\\.${ISSUE_FILE.replace(/\./g, "\\.")}\\..+\\.tmp$`);

/** Cleanup must never hide the error that caused it. */
export function tryRemove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // ignored on purpose
  }
}

/**
 * Replace an issue's ISSUE.md with `text`, and optionally move the issue folder to `destDir`
 * (a new full path), so the folder and its front matter never disagree.
 *
 * The new text is written to a temp file first, so a failed or partial write can only damage
 * the temp file. Then the folder is moved (if asked) and the temp file is renamed over ISSUE.md
 * (an atomic replace). If that last step fails, the folder is moved back. The original ISSUE.md
 * is untouched until the final rename. A crash between the two renames leaves a mismatch and a
 * temp file, which `validate` reports.
 *
 * `what` names the change in error messages, for example "the new status".
 */
export function commitIssue(
  root: string,
  issue: { dir: string; status?: string },
  text: string,
  opts: { destDir?: string; what?: string; stateHint?: string } = {},
): string {
  const what = opts.what ?? "the new status";
  const dest = opts.destDir ?? issue.dir;
  const moving = dest !== issue.dir;
  const name = tmpName();
  const tmp = join(issue.dir, name);
  try {
    writeFileSync(tmp, text, { flag: "wx" });
  } catch (err) {
    tryRemove(tmp);
    throw new YardhandError(`Could not write ${what} (${errCode(err)}). Nothing was changed.`);
  }
  if (moving) {
    try {
      mkdirSync(dirname(dest), { recursive: true });
      renameSync(issue.dir, dest);
    } catch (err) {
      tryRemove(tmp);
      throw new YardhandError(`Could not move ${rel(root, issue.dir)} (${errCode(err)}). Nothing was changed.`);
    }
  }
  try {
    renameSync(join(dest, name), join(dest, ISSUE_FILE));
  } catch (err) {
    if (moving) {
      try {
        renameSync(dest, issue.dir);
      } catch {
        throw new YardhandError(
          `${rel(root, dest)} was moved but its ${ISSUE_FILE} still has the old values, and it could not be moved back (${errCode(err)}). ${opts.stateHint ?? "Move it back by hand, or fix the fields."}`,
        );
      }
    }
    tryRemove(join(issue.dir, name));
    throw new YardhandError(`Could not update ${ISSUE_FILE} (${errCode(err)}). Nothing was changed.`);
  }
  return dest;
}
