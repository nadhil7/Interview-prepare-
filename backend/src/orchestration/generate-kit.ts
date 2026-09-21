import crypto from "node:crypto";
import { generateKit as pipelineGenerateKit, PipelineError, type GeminiClientConfig } from "@aipk/pipeline";
import { Kit, type KitDocument } from "../models/Kit.js";
import { AppError } from "./errors.js";

export interface CreateKitInput {
  jd: string;
  companyUrl: string;
  days: number;
}

export function computeRequestHash(input: CreateKitInput): string {
  return crypto
    .createHash("sha256")
    .update(`${input.jd}\n${input.companyUrl}\n${input.days}`)
    .digest("hex");
}

export interface FindOrCreateResult {
  kit: KitDocument;
  isNew: boolean;
}

/**
 * How long a job can sit in a non-terminal status before it's considered
 * abandoned — e.g. the process died mid-"researching"/"generating" and
 * nothing is ever going to finish it. Generous relative to the ~60-90s a
 * healthy run takes, so it only catches genuinely stuck jobs, not slow ones.
 */
export const STALE_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const NON_TERMINAL_STATUSES = ["pending", "researching", "generating", "checking"];

function isStaleNonTerminalJob(status: string, updatedAt: Date | undefined): boolean {
  if (!NON_TERMINAL_STATUSES.includes(status) || !updatedAt) return false;
  return Date.now() - updatedAt.getTime() > STALE_JOB_TIMEOUT_MS;
}

/**
 * Sweeps every kit stuck in a non-terminal job status past the staleness
 * timeout and marks it "failed" with a STALE_JOB error. Run once at server
 * startup (recovers jobs orphaned by a crash/restart) and on an interval
 * (catches a job that hangs without the whole process dying). Nothing here
 * attempts to resume a partially-completed run — the pipeline isn't built
 * to pick up mid-crawl or mid-generation, so failing cleanly and letting
 * the user resubmit is the safe behavior.
 */
export async function sweepStaleJobs(timeoutMs: number = STALE_JOB_TIMEOUT_MS): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);
  const result = await Kit.updateMany(
    { "job.status": { $in: NON_TERMINAL_STATUSES }, updatedAt: { $lt: cutoff } },
    {
      "job.status": "failed",
      "job.error": {
        code: "STALE_JOB",
        message: `Job did not reach a terminal status within ${timeoutMs}ms (process likely crashed or restarted mid-run) and was marked failed.`,
      },
    },
  );
  return result.modifiedCount;
}

/**
 * Duplicate-submission handling: same user + same (jd, companyUrl, days)
 * returns the existing kit instead of regenerating — unless that existing
 * kit's job is stuck (stale non-terminal status), in which case it's reset
 * to "pending" and returned as if new, so the caller restarts generation on
 * it rather than the user being permanently stuck on that exact input.
 */
export async function findOrCreateKitJob(userId: string, input: CreateKitInput): Promise<FindOrCreateResult> {
  const requestHash = computeRequestHash(input);
  const existing = await Kit.findOne({ userId, requestHash });
  if (existing) {
    const updatedAt = (existing as unknown as { updatedAt?: Date }).updatedAt;
    if (isStaleNonTerminalJob(existing.job?.status ?? "", updatedAt)) {
      existing.job = { status: "pending", progress: 0, error: null };
      await existing.save();
      return { kit: existing, isNew: true };
    }
    return { kit: existing, isNew: false };
  }

  const kit = await Kit.create({
    userId,
    requestHash,
    job: { status: "pending", progress: 0, error: null },
    source: {
      company: "",
      company_url: input.companyUrl,
      role: "",
      location: "",
      jd_chars: input.jd.length,
      researched_at: "",
      pages_used: [],
    },
    role: { title: "", seniority: "", responsibilities: [], requirements: [] },
    schedule: { days_available: input.days, days: [] },
  });

  return { kit, isNew: true };
}

const PROGRESS_BY_STAGE: Record<"researching" | "generating" | "checking", number> = {
  researching: 5,
  generating: 25,
  checking: 70,
};

/**
 * The backend's half of the job state machine: calls pipeline's shared
 * generateKit (the exact same function the CLI's batch evaluator calls —
 * no parallel implementation of the crawl->extract->generate->coverage-
 * >schedule sequence) as a background task, persisting job.status/progress
 * on every stage transition so a poll endpoint reflects real progress
 * without blocking the request/response cycle on 60-90s+ of work. Any
 * failure — SSRF-rejected URL, final structure validation failing — lands
 * the job in "failed" with a structured {code,message} instead of an
 * unhandled background rejection.
 */
export async function runGenerationJob(
  kitId: string,
  input: CreateKitInput,
  geminiConfig: GeminiClientConfig,
  urlValidatorOptions: { blockPrivateNetworks: boolean },
): Promise<void> {
  try {
    const result = await pipelineGenerateKit(input, { geminiConfig, urlValidatorOptions }, async (stage, partial) => {
      await Kit.findByIdAndUpdate(kitId, {
        "job.status": stage,
        "job.progress": PROGRESS_BY_STAGE[stage],
        ...partial,
      });
    });

    await Kit.findByIdAndUpdate(kitId, {
      ...result.kit,
      research: { pages: result.researchPages, hiringProcessNotes: result.hiringProcessNotes },
      "job.status": "ready",
      "job.progress": 100,
      "job.error": null,
    });
  } catch (err) {
    const appError =
      err instanceof PipelineError
        ? new AppError(err.code, err.message)
        : err instanceof AppError
          ? err
          : new AppError("INTERNAL_ERROR", (err as Error).message || "unknown error");
    await Kit.findByIdAndUpdate(kitId, { "job.status": "failed", "job.error": appError.toJSON() });
  }
}
