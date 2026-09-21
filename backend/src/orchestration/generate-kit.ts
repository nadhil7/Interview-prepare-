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
 * how long a job can sit unfinished before we treat it as abandoned. for
 * example the process died while it was researching or generating and
 * nothing will ever finish it. this is set well above the 60 to 90
 * seconds a normal run takes, so it only catches jobs that are truly
 * stuck, not ones that are just slow.
 */
export const STALE_JOB_TIMEOUT_MS = 5 * 60 * 1000;
const NON_TERMINAL_STATUSES = ["pending", "researching", "generating", "checking"];

function isStaleNonTerminalJob(status: string, updatedAt: Date | undefined): boolean {
  if (!NON_TERMINAL_STATUSES.includes(status) || !updatedAt) return false;
  return Date.now() - updatedAt.getTime() > STALE_JOB_TIMEOUT_MS;
}

/**
 * finds every kit stuck in an unfinished status past the timeout and
 * marks it failed with a stale job error. this runs once when the server
 * starts, to pick up jobs left behind by a crash or restart, and again on
 * a timer, to catch a job that hangs without the whole process dying.
 * nothing here tries to pick a run back up partway through, since the
 * pipeline was not built for that. failing it cleanly and letting the
 * user try again is the safer choice.
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
 * handles a duplicate submission. the same user sending the same job
 * description, company url and day count gets back the existing kit
 * instead of a new one being generated, unless that existing kit's job is
 * stuck, in which case it gets reset to pending and treated as new, so
 * generation restarts on it rather than leaving the user stuck forever on
 * that exact input.
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
 * the backend's half of the job flow. it calls pipeline's shared
 * generateKit, the exact same function the cli's batch runner uses, so
 * there is no second copy of the crawl, extract, generate, cover and
 * schedule sequence anywhere. it runs as a background task, saving job
 * status and progress on every stage change so a poll endpoint shows real
 * progress without making the request wait on a minute or more of work.
 * any failure, a blocked url or a result that fails validation, lands the
 * job in a failed state with a plain code and message instead of an
 * unhandled error in the background.
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
