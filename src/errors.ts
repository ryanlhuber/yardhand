export class YardhandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YardhandError";
  }
}

/** No issues/yardhand.json was found. Distinct from "found but unreadable", which must never be treated as "not set up". */
export class NotInitializedError extends YardhandError {
  constructor(message: string) {
    super(message);
    this.name = "NotInitializedError";
  }
}

/** The file changed since the caller read it (a person or model edited it in the meantime). Nothing was written. */
export class ConflictError extends YardhandError {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
