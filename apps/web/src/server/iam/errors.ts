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

/** Input that breaks a rule the user can fix. The message is shown as is. */
export class ValidationError extends Error {
  readonly status = 422;
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** The request clashes with existing data (duplicate number, room taken, no availability). */
export class ConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export function isDomainError(e: unknown): e is ForbiddenError | NotFoundError | ValidationError | ConflictError {
  return e instanceof ForbiddenError || e instanceof NotFoundError || e instanceof ValidationError || e instanceof ConflictError;
}

/** Postgres unique violation (23505) from a Drizzle-wrapped error. */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const c = (e as { cause?: { code?: string; constraint?: string } })?.cause ?? (e as { code?: string; constraint?: string });
  return c?.code === "23505" && (!constraint || c.constraint === constraint);
}
