export class LoloError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoloError";
  }
}

/** No issues/lolo.json was found. Distinct from "found but unreadable", which must never be treated as "not set up". */
export class NotInitializedError extends LoloError {
  constructor(message: string) {
    super(message);
    this.name = "NotInitializedError";
  }
}
