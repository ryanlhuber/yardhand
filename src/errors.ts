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
