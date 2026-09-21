export type ErrorCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "KIT_NOT_READY"
  | "COMPANY_UNREACHABLE"
  | "LLM_UNAVAILABLE"
  | "KIT_VALIDATION_FAILED"
  | "STALE_JOB"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  KIT_NOT_READY: 409,
  COMPANY_UNREACHABLE: 422,
  LLM_UNAVAILABLE: 502,
  KIT_VALIDATION_FAILED: 500,
  STALE_JOB: 500,
  INTERNAL_ERROR: 500,
};

/**
 * used across route handlers and the background generation job. the error
 * handler middleware turns this into a plain {error: {code, message}}
 * response, never a raw stack trace, so the frontend has a stable code to
 * check and a message it can show directly.
 */
export class AppError extends Error {
  code: ErrorCode;
  status: number;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}
