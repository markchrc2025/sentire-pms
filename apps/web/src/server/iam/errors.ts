export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to do this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}
