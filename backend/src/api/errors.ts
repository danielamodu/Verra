/** Typed API errors → HTTP status mapping (no internal leakage). */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  UPSTREAM_ERROR: 502,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  toJSON(): { error: { code: ErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

export const notFound = (what: string) =>
  new ApiError("NOT_FOUND", `${what} not found`);
export const conflict = (message: string) =>
  new ApiError("CONFLICT", message);
export const unprocessable = (message: string, details?: unknown) =>
  new ApiError("UNPROCESSABLE", message, details);
