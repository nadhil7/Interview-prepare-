export type PipelineErrorCode = "COMPANY_UNREACHABLE" | "KIT_VALIDATION_FAILED" | "INTERNAL_ERROR";

/**
 * a failure from generateKit that does not carry any http status, since it
 * gets thrown from shared code used by both the backend, which maps it to
 * its own error type with a status code, and the cli, which writes it
 * straight into the batch output's error field.
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
