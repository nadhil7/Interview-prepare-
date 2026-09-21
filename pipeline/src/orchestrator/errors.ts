export type PipelineErrorCode = "COMPANY_UNREACHABLE" | "KIT_VALIDATION_FAILED" | "INTERNAL_ERROR";

/**
 * Transport-agnostic failure from generateKit — no HTTP status, since this
 * is thrown from pipeline code shared by the backend (which maps it onto
 * its own AppError for a status code) and the CLI (which writes it straight
 * into the batch output's `error` field, matching Appendix B's shape).
 */
export class PipelineError extends Error {
  code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string) {
    super(message);
    this.code = code;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}
